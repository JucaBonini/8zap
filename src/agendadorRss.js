const fs = require('fs');
const path = require('path');
const rssFetcher = require('./rssFetcher');
const destinosManager = require('./destinos');
const sessionManager = require('./sessionManager');
const { logProjeto } = require('./logger');
const { comLockProjeto } = require('./agendador');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Cache em memória do controle diário por projeto
 * Map<string, { data: string, horariosDisparados: Set<string>, totalHoje: number }>
 */
const disparosDiariosCache = new Map();

/**
 * Timestamp da última sincronização automática dos feeds RSS
 */
let ultimaSincronizacaoRss = 0;

/**
 * Retorna a data atual no formato YYYY-MM-DD
 * @returns {string}
 */
function obterDataHojeFormatada() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Retorna a hora atual no formato HH:MM
 * @returns {string}
 */
function obterHoraAtualFormatada() {
  const agora = new Date();
  const horas = String(agora.getHours()).padStart(2, '0');
  const minutos = String(agora.getMinutes()).padStart(2, '0');
  return `${horas}:${minutos}`;
}

/**
 * Retorna o caminho do arquivo de controle diário do projeto
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoControleDiario(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `controle-diario-${idSanitizado}.json`);
}

/**
 * Salva o estado do controle diário no arquivo JSON com lock
 * @param {string} projectId
 * @param {{ data: string, horariosDisparados: Set<string>, totalHoje: number }} controle
 */
async function salvarControleDiario(projectId, controle) {
  const caminho = obterCaminhoControleDiario(projectId);
  const dadosParaSalvar = {
    data: controle.data,
    horariosDisparados: Array.from(controle.horariosDisparados || []),
    totalHoje: controle.totalHoje || 0
  };

  await comLockProjeto(projectId, async () => {
    try {
      fs.writeFileSync(caminho, JSON.stringify(dadosParaSalvar, null, 2), 'utf8');
    } catch (err) {
      logProjeto(projectId, 'ERRO_GRAVAR_CONTROLE_DIARIO', `Falha ao salvar controle diário: ${err.message}`, 'error');
    }
  });
}

/**
 * Obtém ou inicializa o controle diário de disparos para um projeto (persistido em disco)
 * @param {string} projectId
 * @returns {Promise<{ data: string, horariosDisparados: Set<string>, totalHoje: number }>}
 */
async function obterControleDiario(projectId) {
  const dataHoje = obterDataHojeFormatada();
  let controle = disparosDiariosCache.get(projectId);

  // Se já está no cache em memória e é do dia de hoje, retorna
  if (controle && controle.data === dataHoje) {
    return controle;
  }

  const caminho = obterCaminhoControleDiario(projectId);

  return comLockProjeto(projectId, async () => {
    let dadosArquivo = null;

    if (fs.existsSync(caminho)) {
      try {
        const conteudo = fs.readFileSync(caminho, 'utf8');
        dadosArquivo = JSON.parse(conteudo);
      } catch (err) {
        logProjeto(projectId, 'ERRO_LER_CONTROLE_DIARIO', `Falha ao ler arquivo de controle diário: ${err.message}`, 'error');
      }
    }

    // Se o arquivo existe e é da data de hoje, carrega o estado persistido
    if (dadosArquivo && dadosArquivo.data === dataHoje) {
      controle = {
        data: dataHoje,
        horariosDisparados: new Set(Array.isArray(dadosArquivo.horariosDisparados) ? dadosArquivo.horariosDisparados : []),
        totalHoje: typeof dadosArquivo.totalHoje === 'number' ? dadosArquivo.totalHoje : 0
      };
    } else {
      // Se virou o dia ou o arquivo não existe, reseta o contador e salva no disco
      controle = {
        data: dataHoje,
        horariosDisparados: new Set(),
        totalHoje: 0
      };

      try {
        fs.writeFileSync(
          caminho,
          JSON.stringify(
            {
              data: dataHoje,
              horariosDisparados: [],
              totalHoje: 0
            },
            null,
            2
          ),
          'utf8'
        );
      } catch (_) {}
    }

    disparosDiariosCache.set(projectId, controle);
    return controle;
  });
}

/**
 * Executa a sincronização periódica de feeds RSS de todos os projetos ativos
 */
async function sincronizarFeedsRssPeriodicos() {
  const intervaloMinutos = parseInt(process.env.INTERVALO_RSS_MINUTOS, 10) || 30;
  const intervaloMs = intervaloMinutos * 60 * 1000;
  const agora = Date.now();

  if (agora - ultimaSincronizacaoRss < intervaloMs) {
    return;
  }

  ultimaSincronizacaoRss = agora;

  if (!fs.existsSync(diretorioData)) return;

  const arquivos = fs.readdirSync(diretorioData);
  const configsRss = arquivos.filter((arq) => arq.startsWith('config-rss-') && arq.endsWith('.json'));

  for (const arq of configsRss) {
    const projectId = arq.replace(/^config-rss-/, '').replace(/\.json$/, '');
    try {
      const config = rssFetcher.obterConfigRss(projectId);
      if (config.ativo && config.rssUrl) {
        await rssFetcher.buscarNovosArtigos(projectId);
      }
    } catch (err) {
      logProjeto(projectId, 'ERRO_SYNC_RSS', `Erro ao sincronizar feed em segundo plano: ${err.message}`, 'error');
    }
  }
}

/**
 * Executa uma verificação do agendador de RSS dentro do ciclo principal do agendador
 */
async function verificarEDispararRss() {
  try {
    // 1. Executa sincronização periódica dos feeds se necessário
    await sincronizarFeedsRssPeriodicos();

    if (!fs.existsSync(diretorioData)) return;

    const arquivos = fs.readdirSync(diretorioData);
    const configsRss = arquivos.filter((arq) => arq.startsWith('config-rss-') && arq.endsWith('.json'));

    const horaAtual = obterHoraAtualFormatada();

    for (const arq of configsRss) {
      const projectId = arq.replace(/^config-rss-/, '').replace(/\.json$/, '');
      const config = rssFetcher.obterConfigRss(projectId);

      // Pula se RSS estiver desativado ou sem URL
      if (!config.ativo || !config.rssUrl) {
        continue;
      }

      // Verifica se a sessão do WhatsApp está conectada
      const statusSessao = sessionManager.obterStatusSessao(projectId);
      if (statusSessao.status !== 'connected') {
        continue;
      }

      // Checa se o horário atual bate com a lista configurada de horários
      const horariosConfigurados = Array.isArray(config.horarios) ? config.horarios : [];
      if (!horariosConfigurados.includes(horaAtual)) {
        continue;
      }

      const controle = await obterControleDiario(projectId);

      // Evita disparar duas vezes no mesmo horário hoje
      if (controle.horariosDisparados.has(horaAtual)) {
        continue;
      }

      // Verifica se atingiu a quantidade diária máxima
      if (controle.totalHoje >= config.quantidadePorDia) {
        logProjeto(
          projectId,
          'RSS_LIMITE_DIARIO',
          `Limite diário de ${config.quantidadePorDia} posts de RSS atingido hoje. Pulando horário ${horaAtual}.`,
          'info'
        );
        controle.horariosDisparados.add(horaAtual);
        await salvarControleDiario(projectId, controle);
        continue;
      }

      // Processa o disparo do artigo
      await processarDisparoArtigoRss(projectId, config, horaAtual);
    }
  } catch (err) {
    console.error('[AgendadorRss] Erro no ciclo de verificação:', err.message);
  }
}

/**
 * Executa a seleção, montagem e disparo de um artigo RSS
 * @param {string} projectId
 * @param {object} config
 * @param {string} horarioAtual
 */
async function processarDisparoArtigoRss(projectId, config, horarioAtual) {
  logProjeto(projectId, 'RSS_DISPARO_INICIO', `Iniciando disparo programado para o horário ${horarioAtual}...`, 'info');

  const controle = await obterControleDiario(projectId);

  try {
    // 1. Obtém um artigo aleatório não usado
    const artigo = await rssFetcher.obterArtigoAleatorioNaoUsado(projectId);
    if (!artigo) {
      logProjeto(projectId, 'RSS_PULADO', `Nenhum artigo disponível no momento para o horário ${horarioAtual}.`, 'warn');
      controle.horariosDisparados.add(horarioAtual);
      await salvarControleDiario(projectId, controle);
      return;
    }

    // 2. Obtém a lista de destinos disponíveis
    const todosDestinos = await destinosManager.listarDestinosDisponiveis(projectId);
    if (!todosDestinos || todosDestinos.length === 0) {
      logProjeto(projectId, 'RSS_SEM_DESTINOS', 'Nenhum grupo ou canal disponível para envio. Cadastre destinos no painel.', 'warn');
      controle.horariosDisparados.add(horarioAtual);
      await salvarControleDiario(projectId, controle);
      return;
    }

    // 3. Lê o histórico e filtra destinos elegíveis (cooldown e lista permitida)
    const historicoUso = destinosManager.obterHistoricoDestinos(projectId);
    const destinosElegiveis = destinosManager.filtrarDestinosElegiveis(
      todosDestinos,
      historicoUso,
      config.cooldownHorasPorDestino || 24,
      config.destinosPermitidos || []
    );

    if (destinosElegiveis.length === 0) {
      logProjeto(
        projectId,
        'RSS_COOLDOWN',
        `Todos os ${todosDestinos.length} destinos estão em período de cooldown (${config.cooldownHorasPorDestino || 24}h) ou bloqueados por permissões. Post pulado.`,
        'warn'
      );
      controle.horariosDisparados.add(horarioAtual);
      await salvarControleDiario(projectId, controle);
      return;
    }

    // 4. Sorteia um destino aleatório dentre os elegíveis
    const indiceDestino = Math.floor(Math.random() * destinosElegiveis.length);
    const destinoEscolhido = destinosElegiveis[indiceDestino];

    // 5. Tenta obter a imagem oficial da receita caso não tenha vindo no feed RSS
    let imagemParaEnvio = artigo.imagem;
    if (!imagemParaEnvio && artigo.link) {
      try {
        imagemParaEnvio = await rssFetcher.extrairImagemDaPaginaHtml(artigo.link);
      } catch (_) {}
    }

    // Monta a mensagem profissional com Título, Resumo, Chamada para Ação (CTA) e Link
    const textoMensagem = `🍲 *${artigo.titulo}*\n\n${artigo.resumo}\n\n👉 *Toque no link abaixo para ver os ingredientes e o modo de preparo completo:*\n🔗 ${artigo.link}`;

    logProjeto(
      projectId,
      'RSS_ENVIANDO',
      `Sorteado destino "${destinoEscolhido.nome}" (${destinoEscolhido.jid}) para o artigo "${artigo.titulo}" [Imagem: ${imagemParaEnvio ? 'Sim' : 'Não'}].`,
      'info'
    );

    // 6. Envia através do sessionManager (respeitando a fila e o rate limiting existente)
    try {
      if (imagemParaEnvio) {
        await sessionManager.enviarMensagem(projectId, {
          to: destinoEscolhido.jid,
          type: 'imagem',
          url: imagemParaEnvio,
          legenda: textoMensagem
        });
      } else {
        await sessionManager.enviarMensagem(projectId, {
          to: destinoEscolhido.jid,
          type: 'texto',
          texto: textoMensagem
        });
      }
    } catch (envioImgErr) {
      if (imagemParaEnvio) {
        logProjeto(projectId, 'FALLBACK_TEXTO', `Falha ao carregar imagem remota (${envioImgErr.message}). Enviando como texto formatado...`, 'warn');
        await sessionManager.enviarMensagem(projectId, {
          to: destinoEscolhido.jid,
          type: 'texto',
          texto: textoMensagem
        });
      } else {
        throw envioImgErr;
      }
    }

    // 7. Marca o artigo como usado
    rssFetcher.marcarArtigoComoUsado(projectId, artigo.id);

    // 8. Registra o uso do destino
    destinosManager.registrarUsoDestino(projectId, {
      jid: destinoEscolhido.jid,
      nome: destinoEscolhido.nome,
      tipo: destinoEscolhido.tipo,
      artigoId: artigo.id,
      tituloArtigo: artigo.titulo
    });

    // 9. Atualiza e persiste o controle diário
    controle.horariosDisparados.add(horarioAtual);
    controle.totalHoje += 1;
    await salvarControleDiario(projectId, controle);

    logProjeto(
      projectId,
      'RSS_SUCESSO',
      `Artigo postado com sucesso no destino "${destinoEscolhido.nome}"! (${controle.totalHoje}/${config.quantidadePorDia} hoje)`,
      'success'
    );

    return {
      sucesso: true,
      artigo,
      destino: destinoEscolhido,
      horario: horarioAtual
    };
  } catch (erroDisparo) {
    logProjeto(
      projectId,
      'RSS_ERRO_DISPARO',
      `Falha no disparo de RSS para o horário ${horarioAtual}: ${erroDisparo.message}`,
      'error'
    );
    throw erroDisparo;
  }
}

/**
 * Força o disparo manual imediato de um artigo RSS para testes
 * @param {string} projectId
 * @param {boolean} ignorarCooldown
 * @returns {Promise<object>}
 */
async function dispararArtigoManual(projectId, ignorarCooldown = true) {
  const config = rssFetcher.obterConfigRss(projectId);
  const horaAtual = obterHoraAtualFormatada();

  const configParaTeste = {
    ...config,
    cooldownHorasPorDestino: ignorarCooldown ? 0 : config.cooldownHorasPorDestino
  };

  return processarDisparoArtigoRss(projectId, configParaTeste, `MANUAL_${horaAtual}`);
}

module.exports = {
  verificarEDispararRss,
  sincronizarFeedsRssPeriodicos,
  obterControleDiario,
  salvarControleDiario,
  dispararArtigoManual
};
