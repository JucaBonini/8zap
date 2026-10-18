const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sessionManager = require('./sessionManager');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');

// Garante que a pasta data/ exista
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

let intervaloTimer = null;

/**
 * Fila de locks assíncronos por projeto para evitar condições de corrida em operações de arquivo
 * Map<string, Promise<void>>
 */
const locksProjetos = new Map();

/**
 * Executa uma operação assíncrona garantindo exclusão mútua (lock) por projeto
 * @param {string} projectId
 * @param {Function} operacao
 * @returns {Promise<any>}
 */
async function comLockProjeto(projectId, operacao) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const lockAnterior = locksProjetos.get(idSanitizado) || Promise.resolve();

  let resolverLockAtual;
  const novoLock = new Promise((resolve) => {
    resolverLockAtual = resolve;
  });

  // Enfileira o novo lock
  locksProjetos.set(idSanitizado, novoLock);

  try {
    // Aguarda o lock anterior terminar
    await lockAnterior;
    // Executa a operação protegida
    const resultado = await operacao();
    return resultado;
  } finally {
    resolverLockAtual();
    // Limpa o mapa se não houver novos locks aguardando
    if (locksProjetos.get(idSanitizado) === novoLock) {
      locksProjetos.delete(idSanitizado);
    }
  }
}

/**
 * Retorna o caminho do arquivo JSON da fila de um projeto
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoFila(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `fila-${idSanitizado}.json`);
}

/**
 * Lê a fila de postagens de um projeto (leitura direta síncrona sem lock)
 * @param {string} projectId
 * @returns {Array<object>}
 */
function lerArquivoFila(projectId) {
  const caminho = obterCaminhoFila(projectId);
  if (!fs.existsSync(caminho)) {
    return [];
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(projectId, 'ERRO_LEITURA_FILA', `Falha ao ler arquivo de fila: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Salva a lista de itens no arquivo JSON da fila do projeto de forma segura
 * @param {string} projectId
 * @param {Array<object>} itens
 */
function gravarArquivoFila(projectId, itens) {
  const caminho = obterCaminhoFila(projectId);
  try {
    fs.writeFileSync(caminho, JSON.stringify(itens, null, 2), 'utf8');
  } catch (err) {
    logProjeto(projectId, 'ERRO_GRAVACAO_FILA', `Falha ao salvar arquivo de fila: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Retorna a fila de postagens de um projeto (com lock)
 * @param {string} projectId
 * @returns {Promise<Array<object>>}
 */
async function obterFila(projectId) {
  return comLockProjeto(projectId, async () => {
    return lerArquivoFila(projectId);
  });
}

/**
 * Adiciona um novo item à fila do projeto (Thread-safe com Lock)
 * @param {string} projectId
 * @param {object} dadosItem - { tipo, to, texto, url, legenda, agendado_para }
 * @returns {Promise<object>}
 */
async function adicionarItemFila(projectId, dadosItem) {
  const { tipo = 'texto', to, texto, url, legenda, agendado_para, esteira = false } = dadosItem;

  if (!to) {
    throw new Error('O campo "to" (destinatário) é obrigatório.');
  }

  // Suporte a múltiplos destinatários (Array ou string separada por vírgula/ponto-e-vírgula/linha)
  let listaDestinatarios = [];
  if (Array.isArray(to)) {
    listaDestinatarios = to.map((d) => String(d).trim()).filter(Boolean);
  } else if (typeof to === 'string') {
    listaDestinatarios = to.split(/[,;\n]+/).map((d) => d.trim()).filter(Boolean);
  }

  if (listaDestinatarios.length === 0) {
    throw new Error('Nenhum destinatário válido informado.');
  }

  let dataAgendadaISO = null;
  const isEsteira = Boolean(esteira) || !agendado_para;

  if (agendado_para) {
    const dataAgendada = new Date(agendado_para);
    if (isNaN(dataAgendada.getTime())) {
      if (!isEsteira) {
        throw new Error('O campo "agendado_para" contém uma data/hora inválida.');
      }
    } else {
      dataAgendadaISO = dataAgendada.toISOString();
    }
  } else if (!isEsteira) {
    throw new Error('O campo "agendado_para" (data/hora ISO ou string válida) é obrigatório quando não estiver em modo Esteira.');
  }

  const tipoNormalizado = (tipo || 'texto').toLowerCase();
  if (!['texto', 'imagem', 'video', 'audio'].includes(tipoNormalizado)) {
    throw new Error('O "tipo" deve ser "texto", "imagem", "video" ou "audio".');
  }

  if (tipoNormalizado === 'texto' && (!texto || !texto.trim())) {
    throw new Error('O campo "texto" é obrigatório para mensagens de texto.');
  }

  if ((tipoNormalizado === 'imagem' || tipoNormalizado === 'video' || tipoNormalizado === 'audio') && !url) {
    throw new Error(`O campo "url" é obrigatório para mensagens do tipo ${tipoNormalizado}.`);
  }

  const novosItens = listaDestinatarios.map((dest) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    tipo: tipoNormalizado,
    to: dest,
    texto: texto || '',
    url: url || '',
    legenda: legenda || '',
    agendado_para: dataAgendadaISO,
    esteira: isEsteira,
    enviado: false,
    enviado_em: null,
    criado_em: new Date().toISOString(),
    erro: null
  }));

  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    novosItens.forEach((item) => filaAtual.push(item));
    gravarArquivoFila(projectId, filaAtual);

    novosItens.forEach((item) => {
      const modoDesc = item.esteira ? 'Modo Esteira da Grade' : `Data ${item.agendado_para}`;
      logProjeto(
        projectId,
        'AGENDAMENTO_CRIADO',
        `Post adicionado à fila [${modoDesc}] para ${item.to} (ID: ${item.id})`,
        'info'
      );
    });

    return novosItens.length === 1 ? novosItens[0] : novosItens;
  });
}

/**
 * Remove um item da fila de um projeto (Thread-safe com Lock)
 * @param {string} projectId
 * @param {string} idItem
 * @returns {Promise<object>}
 */
async function removerItemFila(projectId, idItem) {
  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    const index = filaAtual.findIndex((item) => item.id === idItem);

    if (index === -1) {
      throw new Error(`Item com ID "${idItem}" não encontrado na fila.`);
    }

    const itemRemovido = filaAtual.splice(index, 1)[0];
    gravarArquivoFila(projectId, filaAtual);

    logProjeto(projectId, 'AGENDAMENTO_REMOVIDO', `Item removido da fila: ID ${idItem}`, 'info');
    return itemRemovido;
  });
}

/**
 * Edita um item da fila de um projeto (Thread-safe com Lock)
 * @param {string} projectId
 * @param {string} idItem
 * @param {object} novosDados
 * @returns {Promise<object>}
 */
async function editarItemFila(projectId, idItem, novosDados) {
  const { tipo, to, texto, url, legenda, agendado_para } = novosDados;

  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    const item = filaAtual.find((i) => i.id === idItem);

    if (!item) {
      throw new Error(`Item com ID "${idItem}" não encontrado na fila.`);
    }

    if (to !== undefined && to.trim()) item.to = to.trim();
    if (tipo !== undefined) {
      const tipoNormalizado = (tipo || 'texto').toLowerCase();
      if (!['texto', 'imagem', 'video', 'audio'].includes(tipoNormalizado)) {
        throw new Error('O "tipo" deve ser "texto", "imagem", "video" ou "audio".');
      }
      item.tipo = tipoNormalizado;
    }
    if (texto !== undefined) item.texto = texto;
    if (url !== undefined) item.url = url;
    if (legenda !== undefined) item.legenda = legenda;
    if (agendado_para !== undefined) {
      const dataAgendada = new Date(agendado_para);
      if (isNaN(dataAgendada.getTime())) {
        throw new Error('O campo "agendado_para" contém uma data/hora inválida.');
      }
      item.agendado_para = dataAgendada.toISOString();
    }

    // Limpa status de erro prévio ao editar para permitir novo disparo
    item.erro = null;
    item.atualizado_em = new Date().toISOString();

    gravarArquivoFila(projectId, filaAtual);

    logProjeto(projectId, 'AGENDAMENTO_EDITADO', `Item atualizado na fila: ID ${idItem}`, 'info');
    return item;
  });
}

/**
 * Força o reenvio imediato de um item da fila
 * @param {string} projectId
 * @param {string} idItem
 * @returns {Promise<object>}
 */
async function reenviarItemFila(projectId, idItem) {
  const fila = await obterFila(projectId);
  const item = fila.find((i) => i.id === idItem);

  if (!item) {
    throw new Error(`Item com ID "${idItem}" não encontrado na fila.`);
  }

  const statusSessao = sessionManager.obterStatusSessao(projectId);
  if (statusSessao.status !== 'connected') {
    throw new Error(`Sessão do WhatsApp não está conectada (Status atual: "${statusSessao.status}").`);
  }

  logProjeto(
    projectId,
    'AGENDADOR_REENVIANDO',
    `Reenviando post ID: ${item.id} para ${item.to}...`,
    'info'
  );

  try {
    const textoEnvio = item.texto ? reacaoGatilhos.aplicarGatilhoReacao(item.texto, { categoria: 'manual', projectId }) : '';
    const legendaEnvio = item.legenda ? reacaoGatilhos.aplicarGatilhoReacao(item.legenda, { categoria: 'manual', projectId }) : '';

    await sessionManager.enviarMensagem(projectId, {
      to: item.to,
      type: item.tipo,
      texto: textoEnvio,
      url: item.url,
      legenda: legendaEnvio
    });

    await atualizarStatusItem(projectId, item.id, {
      enviado: true,
      enviado_em: new Date().toISOString(),
      erro: null
    });

    logProjeto(
      projectId,
      'AGENDADOR_SUCESSO',
      `Post ID ${item.id} reenviado com sucesso!`,
      'success'
    );

    return {
      sucesso: true,
      mensagem: 'Post reenviado com sucesso!'
    };
  } catch (err) {
    await atualizarStatusItem(projectId, item.id, {
      erro: err.message,
      tentativas: (item.tentativas || 0) + 1
    });

    logProjeto(
      projectId,
      'AGENDADOR_ERRO',
      `Falha ao reenviar post agendado ID ${item.id}: ${err.message}`,
      'error'
    );

    throw err;
  }
}

/**
 * Atualiza o status de um item específico na fila com garantia de lock atômico
 * @param {string} projectId
 * @param {string} idItem
 * @param {object} atualizacoes
 */
async function atualizarStatusItem(projectId, idItem, atualizacoes) {
  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    const item = filaAtual.find((i) => i.id === idItem);
    if (item) {
      Object.assign(item, atualizacoes);
      gravarArquivoFila(projectId, filaAtual);
    }
  });
}

/**
 * Executa um ciclo completo de checagem e disparo das filas de todos os projetos
 */
async function executarCicloAgendador() {
  try {
    if (!fs.existsSync(diretorioData)) {
      return;
    }

    const arquivos = fs.readdirSync(diretorioData);
    const arquivosFila = arquivos.filter((arq) => arq.startsWith('fila-') && arq.endsWith('.json'));

    const agora = new Date();

    for (const arq of arquivosFila) {
      const projectId = arq.replace(/^fila-/, '').replace(/\.json$/, '');
      
      // Lê snapshot atual da fila
      const fila = await obterFila(projectId);

      for (const item of fila) {
        // Verifica se ainda não foi enviado e se a hora de envio já chegou (ignora itens da esteira que são disparados pela grade)
        if (!item.enviado && item.agendado_para && !item.esteira) {
          const dataAgendada = new Date(item.agendado_para);

          if (dataAgendada <= agora) {
            // Verifica o status da sessão
            const statusSessao = sessionManager.obterStatusSessao(projectId);

            if (statusSessao.status !== 'connected') {
              logProjeto(
                projectId,
                'AGENDADOR_PENDENTE',
                `Item ${item.id} pronto para envio, porém a sessão está com status "${statusSessao.status}". Aguardando conexão.`,
                'warn'
              );
              continue;
            }

            // Executa o disparo através do sessionManager
            try {
              logProjeto(
                projectId,
                'AGENDADOR_DISPARANDO',
                `Disparando post agendado ID: ${item.id} para ${item.to}...`,
                'info'
              );

              const reacaoGatilhos = require('./reacaoGatilhos');
              const textoEnvio = item.texto ? reacaoGatilhos.aplicarGatilhoReacao(item.texto, { categoria: 'manual', projectId }) : '';
              const legendaEnvio = item.legenda ? reacaoGatilhos.aplicarGatilhoReacao(item.legenda, { categoria: 'manual', projectId }) : '';

              const resEnvio = await sessionManager.enviarMensagem(projectId, {
                to: item.to,
                type: item.tipo,
                texto: textoEnvio,
                url: item.url,
                legenda: legendaEnvio
              });

              if (resEnvio && resEnvio.bloqueadoBlacklist) {
                await atualizarStatusItem(projectId, item.id, {
                  enviado: false,
                  enviado_em: null,
                  erro: 'Cancelado: Destinatário na Blacklist (Opt-out)'
                });
                continue;
              }

              // Atualização com lock atômico sem risco de sobrescrever adições concorrentes
              await atualizarStatusItem(projectId, item.id, {
                enviado: true,
                enviado_em: new Date().toISOString(),
                erro: null
              });

              logProjeto(
                projectId,
                'AGENDADOR_SUCESSO',
                `Post agendado ID ${item.id} enviado com sucesso!`,
                'success'
              );

              // Espelhamento automático simultâneo para o Facebook
              try {
                const facebookManager = require('./facebookManager');
                facebookManager.publicarEspelhamentoAutomatico(projectId, {
                  origem: 'manual',
                  origemId: item.id,
                  titulo: (item.texto || item.legenda || 'Post Manual').slice(0, 45),
                  tipo: item.tipo === 'imagem' ? 'imagem' : 'texto',
                  texto: item.texto || item.legenda || '',
                  imagemUrl: (item.url && item.url.startsWith('http')) ? item.url : '',
                  caminhoArquivo: (item.url && !item.url.startsWith('http')) ? item.url : '',
                  linkComentario: ''
                }).catch((err) => {
                  console.error('[Facebook Espelhamento Manual Agendado Erro]:', err.message);
                });
              } catch (_) {}
            } catch (envioErr) {
              await atualizarStatusItem(projectId, item.id, {
                erro: envioErr.message,
                tentativas: (item.tentativas || 0) + 1
              });

              logProjeto(
                projectId,
                'AGENDADOR_ERRO',
                `Falha ao disparar post agendado ID ${item.id}: ${envioErr.message}`,
                'error'
              );
            }
          }
        }
      }
    }

    // 2. Executa a checagem e disparo do módulo de RSS Automático
    try {
      const agendadorRss = require('./agendadorRss');
      await agendadorRss.verificarEDispararRss();
    } catch (rssErr) {
      console.error('[Agendador] Erro no módulo de RSS:', rssErr.message);
    }

    // 3. Executa a checagem e disparo do módulo de Campanhas (Shopee / Imagens / Dicas)
    try {
      const agendadorCampanhas = require('./agendadorCampanhas');
      await agendadorCampanhas.verificarEDispararCampanhas();
    } catch (campErr) {
      console.error('[Agendador] Erro no módulo de Campanhas:', campErr.message);
    }

    // 4. Executa a checagem e disparo da Grade Diária Mestra
    try {
      const gradeManager = require('./gradeManager');
      await gradeManager.verificarEDispararGrade();
    } catch (gradeErr) {
      console.error('[Agendador] Erro no módulo da Grade Diária:', gradeErr.message);
    }

    // 5. Executa a checagem e disparo da Esteira da Página do Facebook
    try {
      const facebookManager = require('./facebookManager');
      await facebookManager.verificarEDispararFacebook();
    } catch (fbErr) {
      console.error('[Agendador] Erro no módulo do Facebook:', fbErr.message);
    }
  } catch (cicloErr) {
    console.error('[Agendador] Erro no ciclo de verificação:', cicloErr.message);
  }
}

/**
 * Pega o próximo post da esteira manual que ainda não foi enviado e dispara
 * @param {string} projectId
 * @param {Array<string>} [destinosSobrescritos]
 * @returns {Promise<object>}
 */
async function dispararProximoItemEsteira(projectId, destinosSobrescritos = null) {
  const statusSessao = sessionManager.obterStatusSessao(projectId);
  if (statusSessao.status !== 'connected') {
    throw new Error(`Sessão do WhatsApp não está conectada (Status atual: "${statusSessao.status}").`);
  }

  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    // Prioriza itens marcados explicitamente como esteira ou sem data fixa, depois qualquer não enviado
    const item = filaAtual.find((i) => !i.enviado && (i.esteira || !i.agendado_para)) || filaAtual.find((i) => !i.enviado);

    if (!item) {
      logProjeto(
        projectId,
        'ESTEIRA_VAZIA',
        'Horário da Esteira Manual atingido, mas não há posts pendentes na fila.',
        'warn'
      );
      return {
        sucesso: false,
        motivo: 'esteira_vazia',
        mensagem: 'A Esteira Manual está vazia. Adicione novos posts para disparar neste horário.'
      };
    }

    let alvos = [];
    if (Array.isArray(destinosSobrescritos) && destinosSobrescritos.length > 0) {
      alvos = destinosSobrescritos;
    } else if (item.to) {
      alvos = item.to.split(/[,;\n]+/).map((d) => d.trim()).filter(Boolean);
    }

    if (alvos.length === 0) {
      throw new Error(`Item ${item.id} não possui destinatários válidos.`);
    }

    logProjeto(
      projectId,
      'ESTEIRA_DISPARANDO',
      `Disparando post da esteira (ID: ${item.id}) para ${alvos.length} destino(s)...`,
      'info'
    );

    let sucessoPeloMenosUm = false;
    let ultimoErro = null;

    const reacaoGatilhos = require('./reacaoGatilhos');
    const textoEnvio = item.texto ? reacaoGatilhos.aplicarGatilhoReacao(item.texto, { categoria: 'manual', projectId }) : '';
    const legendaEnvio = item.legenda ? reacaoGatilhos.aplicarGatilhoReacao(item.legenda, { categoria: 'manual', projectId }) : '';

    for (const destino of alvos) {
      try {
        await sessionManager.enviarMensagem(projectId, {
          to: destino,
          type: item.tipo,
          texto: textoEnvio,
          url: item.url,
          legenda: legendaEnvio
        });
        sucessoPeloMenosUm = true;
      } catch (errEnvio) {
        ultimoErro = errEnvio.message;
        logProjeto(
          projectId,
          'ESTEIRA_ERRO_DESTINO',
          `Erro ao enviar post da esteira para ${destino}: ${errEnvio.message}`,
          'error'
        );
      }
    }

    if (sucessoPeloMenosUm) {
      item.enviado = true;
      item.enviado_em = new Date().toISOString();
      item.erro = null;
      gravarArquivoFila(projectId, filaAtual);

      logProjeto(
        projectId,
        'ESTEIRA_SUCESSO',
        `Post da esteira ID ${item.id} enviado com sucesso!`,
        'success'
      );

      // Espelhamento automático simultâneo para o Facebook
      try {
        const facebookManager = require('./facebookManager');
        facebookManager.publicarEspelhamentoAutomatico(projectId, {
          origem: 'manual',
          origemId: item.id,
          titulo: (item.texto || item.legenda || 'Post da Esteira').slice(0, 45),
          tipo: item.tipo === 'imagem' ? 'imagem' : 'texto',
          texto: item.texto || item.legenda || '',
          imagemUrl: (item.url && item.url.startsWith('http')) ? item.url : '',
          caminhoArquivo: (item.url && !item.url.startsWith('http')) ? item.url : '',
          linkComentario: ''
        }).catch((err) => {
          console.error('[Facebook Espelhamento Esteira Manual Erro]:', err.message);
        });
      } catch (_) {}

      return {
        sucesso: true,
        item,
        destinos: alvos
      };
    } else {
      item.erro = ultimoErro || 'Falha ao entregar para todos os destinos';
      item.tentativas = (item.tentativas || 0) + 1;
      gravarArquivoFila(projectId, filaAtual);
      throw new Error(item.erro);
    }
  });
}

/**
 * Inicia o loop periódico do agendador
 */
function iniciarAgendador() {
  const intervaloSegundos = parseInt(process.env.INTERVALO_AGENDADOR_SEGUNDOS, 10) || 20;
  // Limita o intervalo entre 5s e 20s para garantir que os slots da Grade e Facebook nunca percam o minuto exato
  const intervaloMs = Math.min(Math.max(intervaloSegundos, 5), 20) * 1000;
  const fuso = process.env.TIMEZONE || 'America/Sao_Paulo';

  console.log(`[Agendador] Iniciando serviço de postagens agendadas (Checagem a cada ${intervaloMs / 1000}s | Fuso: ${fuso})...`);

  // Executa uma primeira vez logo na inicialização
  executarCicloAgendador();

  // Mantém o loop periódico
  if (intervaloTimer) {
    clearInterval(intervaloTimer);
  }
  intervaloTimer = setInterval(executarCicloAgendador, intervaloMs);
}

/**
 * Para o loop do agendador
 */
function pararAgendador() {
  if (intervaloTimer) {
    clearInterval(intervaloTimer);
    intervaloTimer = null;
  }
}

module.exports = {
  comLockProjeto,
  obterFila,
  adicionarItemFila,
  editarItemFila,
  reenviarItemFila,
  removerItemFila,
  atualizarStatusItem,
  dispararProximoItemEsteira,
  executarCicloAgendador,
  iniciarAgendador,
  pararAgendador
};
