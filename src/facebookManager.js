const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const facebookService = require('./facebookService');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Retorna a hora atual formatada HH:MM no fuso de Brasília
 * @returns {string}
 */
function obterHoraAtualFormatada(fuso = process.env.TIMEZONE || 'America/Sao_Paulo') {
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const hora = partes.find((p) => p.type === 'hour').value.padStart(2, '0');
    const min = partes.find((p) => p.type === 'minute').value.padStart(2, '0');
    return `${hora}:${min}`;
  } catch (_) {
    const agora = new Date();
    return `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  }
}

/**
 * Retorna a data atual YYYY-MM-DD no fuso de Brasília
 * @returns {string}
 */
function obterDataHojeFormatada(fuso = process.env.TIMEZONE || 'America/Sao_Paulo') {
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const ano = partes.find((p) => p.type === 'year').value;
    const mes = partes.find((p) => p.type === 'month').value;
    const dia = partes.find((p) => p.type === 'day').value;
    return `${ano}-${mes}-${dia}`;
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

function obterCaminhoConfigFacebook(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `config-facebook-${idSanitizado}.json`);
}

function obterCaminhoFilaFacebook(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `fila-facebook-${idSanitizado}.json`);
}

function obterCaminhoControleDiario(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `controle-facebook-${idSanitizado}.json`);
}

/**
 * Retorna as configurações do Facebook do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigFacebook(projectId) {
  const caminho = obterCaminhoConfigFacebook(projectId);
  const padrao = {
    ativo: false,
    pageId: '',
    pageAccessToken: '',
    nomePagina: '',
    fotoPagina: '',
    horarios: ['08:30', '11:45', '15:30', '19:45'],
    autoPrimeiroComentario: true,
    templateComentario: '👉 Veja a receita completa com o modo de preparo passo a passo no nosso site:\n{link}'
  };

  if (!fs.existsSync(caminho)) {
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return {
      ativo: Boolean(dados.ativo),
      pageId: dados.pageId || '',
      pageAccessToken: dados.pageAccessToken || '',
      nomePagina: dados.nomePagina || '',
      fotoPagina: dados.fotoPagina || '',
      horarios: Array.isArray(dados.horarios) ? dados.horarios : padrao.horarios,
      autoPrimeiroComentario: dados.autoPrimeiroComentario !== false,
      templateComentario: dados.templateComentario || padrao.templateComentario
    };
  } catch (err) {
    return padrao;
  }
}

/**
 * Salva as configurações do Facebook do projeto
 * @param {string} projectId
 * @param {object} dados
 * @returns {object}
 */
function salvarConfigFacebook(projectId, dados) {
  const caminho = obterCaminhoConfigFacebook(projectId);
  const configAtual = obterConfigFacebook(projectId);

  const horariosNormalizados = Array.isArray(dados.horarios)
    ? dados.horarios
        .map((h) => (typeof h === 'string' ? h.trim() : h.hora ? h.hora.trim() : ''))
        .filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h))
    : configAtual.horarios;

  const novaConfig = {
    ativo: dados.ativo !== undefined ? Boolean(dados.ativo) : configAtual.ativo,
    pageId: dados.pageId !== undefined ? String(dados.pageId).trim() : configAtual.pageId,
    pageAccessToken: dados.pageAccessToken !== undefined ? String(dados.pageAccessToken).trim() : configAtual.pageAccessToken,
    nomePagina: dados.nomePagina !== undefined ? String(dados.nomePagina).trim() : configAtual.nomePagina,
    fotoPagina: dados.fotoPagina !== undefined ? String(dados.fotoPagina).trim() : configAtual.fotoPagina,
    horarios: horariosNormalizados,
    autoPrimeiroComentario: dados.autoPrimeiroComentario !== undefined ? Boolean(dados.autoPrimeiroComentario) : configAtual.autoPrimeiroComentario,
    templateComentario: dados.templateComentario !== undefined ? String(dados.templateComentario) : configAtual.templateComentario
  };

  fs.writeFileSync(caminho, JSON.stringify(novaConfig, null, 2), 'utf8');
  logProjeto(projectId, 'FB_CONFIG_SALVA', 'Configurações da Página do Facebook atualizadas.', 'info');
  return novaConfig;
}

/**
 * Lê a fila de postagens do Facebook de um projeto
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterFilaFacebook(projectId) {
  const caminho = obterCaminhoFilaFacebook(projectId);
  if (!fs.existsSync(caminho)) {
    return [];
  }
  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(projectId, 'FB_ERRO_LEITURA_FILA', `Falha ao ler fila do Facebook: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Grava a fila de postagens do Facebook
 * @param {string} projectId
 * @param {Array<object>} itens
 */
function salvarFilaFacebook(projectId, itens) {
  const caminho = obterCaminhoFilaFacebook(projectId);
  fs.writeFileSync(caminho, JSON.stringify(itens, null, 2), 'utf8');
}

/**
 * Adiciona um post à Esteira do Facebook
 * @param {string} projectId
 * @param {object} dadosItem - { tipo, texto, imagemUrl, caminhoArquivo, linkComentario, origem, origemId, titulo }
 * @returns {object}
 */
function adicionarItemFilaFacebook(projectId, dadosItem) {
  const fila = obterFilaFacebook(projectId);

  const novoItem = {
    id: `fb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    origem: dadosItem.origem || 'manual',
    origemId: dadosItem.origemId || null,
    titulo: dadosItem.titulo || '',
    tipo: dadosItem.tipo === 'imagem' ? 'imagem' : 'texto',
    texto: dadosItem.texto || '',
    imagemUrl: dadosItem.imagemUrl || '',
    caminhoArquivo: dadosItem.caminhoArquivo || '',
    linkComentario: dadosItem.linkComentario || '',
    esteira: true,
    enviado: false,
    enviado_em: null,
    fbPostId: null,
    fbPostUrl: null,
    criado_em: new Date().toISOString(),
    erro: null
  };

  fila.push(novoItem);
  salvarFilaFacebook(projectId, fila);

  logProjeto(
    projectId,
    'FB_ITEM_ENFILEIRADO',
    `Post "${novoItem.titulo || novoItem.id}" adicionado à Esteira do Facebook.`,
    'info'
  );

  return novoItem;
}

/**
 * Remove um item da fila do Facebook
 * @param {string} projectId
 * @param {string} itemId
 * @returns {boolean}
 */
function removerItemFilaFacebook(projectId, itemId) {
  const fila = obterFilaFacebook(projectId);
  const filtrada = fila.filter((i) => i.id !== itemId);
  salvarFilaFacebook(projectId, filtrada);
  return true;
}

/**
 * Remove todos os itens que já foram enviados da fila do Facebook
 * @param {string} projectId
 * @returns {number} quantidade removida
 */
function limparEnviadosFacebook(projectId) {
  const fila = obterFilaFacebook(projectId);
  const pendentes = fila.filter((i) => !i.enviado);
  const removidos = fila.length - pendentes.length;
  salvarFilaFacebook(projectId, pendentes);
  return removidos;
}

/**
 * Converte e adiciona uma Receita da Mary à Esteira do Facebook
 * Formata o texto nativo com ingredientes e segredinho da Mary e anexa o link da receita no comentário
 * @param {string} projectId
 * @param {string} receitaId
 * @returns {Promise<object>}
 */
async function adicionarReceitaAFilaFacebook(projectId, receitaId) {
  const receitasManager = require('./receitasManager');
  const lista = receitasManager.obterReceitas(projectId);
  const receita = lista.find((r) => r.id === receitaId);

  if (!receita) {
    throw new Error(`Receita com ID "${receitaId}" não encontrada.`);
  }

  // Prepara o texto adaptado para o Facebook: limpo, com título chamativo e chamada para o 1º comentário
  let textoFacebook = (receita.texto || '').trim();

  // Remove marcações de formatação específicas de WhatsApp caso existam (*negrito* -> mantém limpo ou com destaque)
  // No Facebook, emojis e quebras de linha dão o melhor resultado
  if (!textoFacebook.includes('primeiro comentário') && receita.linkOriginal) {
    textoFacebook += '\n\n👉 Deixei o link com o passo a passo completo e tempo de forno no PRIMEIRO COMENTÁRIO para você salvar!';
  }

  const temImagem = Boolean(receita.imagemUrl || receita.imagemCaminhoFisico);

  const itemFila = {
    origem: 'receitas',
    origemId: receita.id,
    titulo: receita.titulo || 'Receita da Mary',
    tipo: temImagem ? 'imagem' : 'texto',
    texto: textoFacebook,
    imagemUrl: receita.imagemUrl || '',
    caminhoArquivo: receita.imagemCaminhoFisico || '',
    linkComentario: receita.linkOriginal || ''
  };

  const itemCriado = adicionarItemFilaFacebook(projectId, itemFila);
  logProjeto(
    projectId,
    'FB_RECEITA_ENFILEIRADA',
    `Receita "${receita.titulo}" adicionada com sucesso à Esteira do Facebook!`,
    'success'
  );

  return itemCriado;
}

/**
 * Dispara o próximo post pendente na Esteira do Facebook (FIFO)
 * @param {string} projectId
 * @returns {Promise<object>}
 */
async function dispararProximoItemEsteiraFacebook(projectId) {
  const config = obterConfigFacebook(projectId);

  if (!config.pageId || !config.pageAccessToken) {
    throw new Error('Página do Facebook não configurada. Preencha o Page ID e o Page Access Token.');
  }

  const fila = obterFilaFacebook(projectId);
  // Pega o primeiro item pendente (FIFO)
  const item = fila.find((i) => !i.enviado);

  if (!item) {
    logProjeto(
      projectId,
      'FB_ESTEIRA_VAZIA',
      'Horário da Esteira do Facebook atingido, mas não há posts pendentes na fila.',
      'warn'
    );
    return {
      sucesso: false,
      motivo: 'esteira_vazia',
      mensagem: 'A Esteira do Facebook está vazia. Adicione novas receitas ou posts manuais.'
    };
  }

  logProjeto(
    projectId,
    'FB_DISPARANDO_ESTEIRA',
    `Disparando post da Esteira Facebook: "${item.titulo || item.id}"...`,
    'info'
  );

  // Prepara o texto do primeiro comentário se houver link
  let comentarioFinal = null;
  if (config.autoPrimeiroComentario && item.linkComentario && item.linkComentario.trim()) {
    const template = config.templateComentario || '👉 Veja a receita completa no nosso site:\n{link}';
    comentarioFinal = template.replace('{link}', item.linkComentario.trim());
  }

  try {
    let resultadoEnvio;

    if (item.tipo === 'imagem' && (item.imagemUrl || item.caminhoArquivo)) {
      resultadoEnvio = await facebookService.publicarFotoNaPagina({
        pageId: config.pageId,
        pageAccessToken: config.pageAccessToken,
        imagemUrl: item.imagemUrl,
        caminhoArquivoLocal: item.caminhoArquivo,
        legenda: item.texto,
        linkComentario: comentarioFinal
      });
    } else {
      resultadoEnvio = await facebookService.publicarTextoNaPagina({
        pageId: config.pageId,
        pageAccessToken: config.pageAccessToken,
        texto: item.texto,
        linkComentario: comentarioFinal
      });
    }

    item.enviado = true;
    item.enviado_em = new Date().toISOString();
    item.fbPostId = resultadoEnvio.postId;
    item.fbPostUrl = resultadoEnvio.postUrl;
    item.erro = null;

    salvarFilaFacebook(projectId, fila);

    logProjeto(
      projectId,
      'FB_POST_PUBLICADO',
      `Post publicado com sucesso na Página do Facebook! Link: ${resultadoEnvio.postUrl}`,
      'success'
    );

    return {
      sucesso: true,
      item,
      resultado: resultadoEnvio
    };
  } catch (err) {
    item.erro = err.message;
    salvarFilaFacebook(projectId, fila);

    logProjeto(
      projectId,
      'FB_ERRO_DISPARO',
      `Erro ao disparar post da Esteira para o Facebook: ${err.message}`,
      'error'
    );

    throw err;
  }
}

/**
 * Lê o controle de horários disparados hoje para o Facebook
 * @param {string} projectId
 * @returns {object} { data: string, disparados: Array<string> }
 */
function obterControleDiario(projectId) {
  const caminho = obterCaminhoControleDiario(projectId);
  const dataHoje = obterDataHojeFormatada();

  if (!fs.existsSync(caminho)) {
    return { data: dataHoje, disparados: [] };
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    if (dados.data === dataHoje && Array.isArray(dados.disparados)) {
      return dados;
    }
  } catch (_) {}

  return { data: dataHoje, disparados: [] };
}

function salvarControleDiario(projectId, controle) {
  const caminho = obterCaminhoControleDiario(projectId);
  fs.writeFileSync(caminho, JSON.stringify(controle, null, 2), 'utf8');
}

/**
 * Ciclo do agendador para verificar e disparar slots programados da Esteira do Facebook
 * Chamado a cada minuto pelo loop central do agendador
 */
async function verificarEDispararFacebook() {
  if (!fs.existsSync(diretorioData)) return;

  const horaAtual = obterHoraAtualFormatada();
  const dataHoje = obterDataHojeFormatada();

  const arquivos = fs.readdirSync(diretorioData);
  const configsFb = arquivos.filter((arq) => arq.startsWith('config-facebook-') && arq.endsWith('.json'));

  for (const arq of configsFb) {
    const projectId = arq.replace(/^config-facebook-/, '').replace(/\.json$/, '');

    try {
      const config = obterConfigFacebook(projectId);

      // Pula se a esteira do Facebook estiver desativada ou sem credenciais
      if (!config.ativo || !config.pageId || !config.pageAccessToken) {
        continue;
      }

      const horarios = Array.isArray(config.horarios) ? config.horarios : [];
      if (!horarios.includes(horaAtual)) {
        continue;
      }

      const controle = obterControleDiario(projectId);
      if (controle.disparados.includes(horaAtual)) {
        continue; // Já disparou neste horário hoje
      }

      logProjeto(
        projectId,
        'FB_HORARIO_ATINGIDO',
        `Horário da Esteira do Facebook atingido (${horaAtual}). Buscando próximo post...`,
        'info'
      );

      // Marca o horário como acionado
      controle.disparados.push(horaAtual);
      salvarControleDiario(projectId, controle);

      await dispararProximoItemEsteiraFacebook(projectId);
    } catch (err) {
      console.error(`[FacebookManager] Erro no ciclo de disparo do projeto ${projectId}:`, err.message);
    }
  }
}

module.exports = {
  obterConfigFacebook,
  salvarConfigFacebook,
  obterFilaFacebook,
  adicionarItemFilaFacebook,
  removerItemFilaFacebook,
  limparEnviadosFacebook,
  adicionarReceitaAFilaFacebook,
  dispararProximoItemEsteiraFacebook,
  verificarEDispararFacebook
};
