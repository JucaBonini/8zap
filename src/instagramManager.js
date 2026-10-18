const fs = require('fs');
const path = require('path');
const instagramService = require('./instagramService');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

function obterCaminhoConfigInstagram(projectId) {
  const idSanitizado = (projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `config-instagram-${idSanitizado}.json`);
}

function obterCaminhoHistoricoInstagram(projectId) {
  const idSanitizado = (projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `fila-instagram-${idSanitizado}.json`);
}

/**
 * Retorna as configurações do Instagram do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigInstagram(projectId) {
  const caminho = obterCaminhoConfigInstagram(projectId);
  const padrao = {
    ativo: false,
    igUserId: '',
    pageId: '',
    accessToken: '',
    username: '',
    nome: '',
    foto: '',
    postarAutomaticoReceitas: true,
    postarAutomaticoRss: true,
    postarAutomaticoCampanhas: false,
    adicionarHashtags: true,
    hashtags: '#receitas #receita #culinaria #gastronomia #delicia #comidadeverdade #receitafacil',
    totalEnviados: 0
  };

  if (!fs.existsSync(caminho)) {
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return {
      ativo: Boolean(dados.ativo),
      igUserId: dados.igUserId || '',
      pageId: dados.pageId || '',
      accessToken: dados.accessToken || '',
      username: dados.username || '',
      nome: dados.nome || '',
      foto: dados.foto || '',
      postarAutomaticoReceitas: dados.postarAutomaticoReceitas ?? true,
      postarAutomaticoRss: dados.postarAutomaticoRss ?? true,
      postarAutomaticoCampanhas: dados.postarAutomaticoCampanhas ?? false,
      adicionarHashtags: dados.adicionarHashtags ?? true,
      hashtags: dados.hashtags || padrao.hashtags,
      totalEnviados: Number(dados.totalEnviados || 0)
    };
  } catch (_) {
    return padrao;
  }
}

/**
 * Salva as configurações do Instagram do projeto
 * @param {string} projectId
 * @param {object} novosDados
 * @returns {object}
 */
function salvarConfigInstagram(projectId, novosDados) {
  const caminho = obterCaminhoConfigInstagram(projectId);
  const atual = obterConfigInstagram(projectId);

  const mesclado = {
    ...atual,
    ...novosDados,
    ativo: novosDados.ativo !== undefined ? Boolean(novosDados.ativo) : atual.ativo,
    postarAutomaticoReceitas: novosDados.postarAutomaticoReceitas !== undefined ? Boolean(novosDados.postarAutomaticoReceitas) : atual.postarAutomaticoReceitas,
    postarAutomaticoRss: novosDados.postarAutomaticoRss !== undefined ? Boolean(novosDados.postarAutomaticoRss) : atual.postarAutomaticoRss,
    postarAutomaticoCampanhas: novosDados.postarAutomaticoCampanhas !== undefined ? Boolean(novosDados.postarAutomaticoCampanhas) : atual.postarAutomaticoCampanhas,
    adicionarHashtags: novosDados.adicionarHashtags !== undefined ? Boolean(novosDados.adicionarHashtags) : atual.adicionarHashtags,
    atualizadoEm: new Date().toISOString()
  };

  fs.writeFileSync(caminho, JSON.stringify(mesclado, null, 2), 'utf8');
  return mesclado;
}

/**
 * Retorna o histórico de posts enviados para o Instagram
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterHistoricoInstagram(projectId) {
  const caminho = obterCaminhoHistoricoInstagram(projectId);
  if (!fs.existsSync(caminho)) return [];

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (_) {
    return [];
  }
}

/**
 * Registra um post no histórico do Instagram
 * @param {string} projectId
 * @param {object} item
 */
function registrarHistoricoInstagram(projectId, item) {
  const caminho = obterCaminhoHistoricoInstagram(projectId);
  const historico = obterHistoricoInstagram(projectId);

  historico.unshift({
    id: item.id || `ig_${Date.now()}`,
    titulo: item.titulo || 'Post do Instagram',
    tipo: item.tipo || 'foto',
    mediaUrl: item.mediaUrl || '',
    legenda: item.legenda || '',
    postUrl: item.postUrl || '',
    mediaId: item.mediaId || '',
    origem: item.origem || 'manual',
    sucesso: Boolean(item.sucesso),
    erro: item.erro || null,
    enviadoEm: new Date().toISOString()
  });

  // Mantém os últimos 100 registros
  const limitado = historico.slice(0, 100);
  fs.writeFileSync(caminho, JSON.stringify(limitado, null, 2), 'utf8');

  // Atualiza contador de enviados com sucesso
  if (item.sucesso) {
    const config = obterConfigInstagram(projectId);
    config.totalEnviados = (config.totalEnviados || 0) + 1;
    salvarConfigInstagram(projectId, { totalEnviados: config.totalEnviados });
  }
}

/**
 * Limpa o histórico de posts do Instagram do projeto
 * @param {string} projectId
 * @returns {number}
 */
function limparHistoricoInstagram(projectId) {
  const caminho = obterCaminhoHistoricoInstagram(projectId);
  const total = obterHistoricoInstagram(projectId).length;
  fs.writeFileSync(caminho, JSON.stringify([], null, 2), 'utf8');
  return total;
}

/**
 * Formata o texto para publicação no Instagram (adiciona hashtags e limpa caracteres redundantes)
 * @param {string} texto
 * @param {object} config
 * @returns {string}
 */
function prepararLegendaInstagram(texto = '', config = {}) {
  let legenda = (texto || '').trim();

  // Limpa asteriscos exagerados de markdown do WhatsApp caso deseje
  legenda = legenda.replace(/\*+/g, '');

  if (config.adicionarHashtags && config.hashtags && config.hashtags.trim()) {
    legenda += `\n\n.\n.\n${config.hashtags.trim()}`;
  }

  return legenda;
}

/**
 * Publica automaticamente no Instagram como espelhamento de Receita, RSS ou Fila
 * @param {string} projectId
 * @param {object} dados - { titulo, tipo, texto, imagemUrl, caminhoArquivo, mediaUrl, origem }
 * @returns {Promise<object>}
 */
async function publicarEspelhamentoInstagram(projectId, dados = {}) {
  const config = obterConfigInstagram(projectId);

  if (!config.ativo || !config.igUserId || !config.accessToken) {
    return { publicado: false, motivo: 'instagram_inativo_ou_sem_credenciais' };
  }

  // Verifica filtros por origem
  const origem = dados.origem || 'receita';
  if (origem === 'receita' && !config.postarAutomaticoReceitas) {
    return { publicado: false, motivo: 'post_automatico_receitas_desativado' };
  }
  if (origem === 'rss' && !config.postarAutomaticoRss) {
    return { publicado: false, motivo: 'post_automatico_rss_desativado' };
  }
  if (origem === 'campanha' && !config.postarAutomaticoCampanhas) {
    return { publicado: false, motivo: 'post_automatico_campanhas_desativado' };
  }

  // O Instagram EXIGE imagem ou vídeo
  const mediaUrl = dados.mediaUrl || dados.imagemUrl || dados.videoUrl || dados.caminhoArquivo;
  if (!mediaUrl) {
    logProjeto(
      projectId,
      'IG_POST_IGNORADO',
      `Publicação no Instagram ignorada para "${dados.titulo || 'Post'}": O Instagram exige imagem ou vídeo.`,
      'warn'
    );
    return { publicado: false, motivo: 'sem_imagem_ou_video' };
  }

  logProjeto(
    projectId,
    'IG_ESPELHAMENTO_INICIO',
    `📸 Publicando simultaneamente no Instagram: "${dados.titulo || 'Post'}"...`,
    'info'
  );

  const legendaFinal = prepararLegendaInstagram(dados.texto || dados.titulo || '', config);

  try {
    const resultado = await instagramService.publicarNoInstagram({
      igUserId: config.igUserId,
      accessToken: config.accessToken,
      mediaUrl,
      legenda: legendaFinal,
      tipo: dados.tipo
    });

    logProjeto(
      projectId,
      'IG_POST_SUCESSO',
      `✅ Post publicado com sucesso no Instagram! Link: ${resultado.postUrl || resultado.permalink}`,
      'info'
    );

    registrarHistoricoInstagram(projectId, {
      titulo: dados.titulo || 'Post Espelhado',
      tipo: dados.tipo || 'foto',
      mediaUrl,
      legenda: legendaFinal,
      postUrl: resultado.postUrl || resultado.permalink,
      mediaId: resultado.mediaId,
      origem,
      sucesso: true
    });

    return {
      publicado: true,
      sucesso: true,
      postUrl: resultado.postUrl || resultado.permalink,
      mediaId: resultado.mediaId
    };
  } catch (err) {
    console.error(`[InstagramManager] Erro ao publicar no Instagram (${projectId}):`, err.message);

    logProjeto(
      projectId,
      'IG_POST_ERRO',
      `❌ Falha ao publicar no Instagram: ${err.message}`,
      'erro'
    );

    registrarHistoricoInstagram(projectId, {
      titulo: dados.titulo || 'Post Espelhado',
      tipo: dados.tipo || 'foto',
      mediaUrl,
      legenda: legendaFinal,
      origem,
      sucesso: false,
      erro: err.message
    });

    return { publicado: false, sucesso: false, erro: err.message };
  }
}

/**
 * Publica um post manual avulso no Instagram
 * @param {string} projectId
 * @param {object} params
 * @returns {Promise<object>}
 */
async function publicarPostManual(projectId, { mediaUrl, legenda = '', titulo = 'Post Manual', tipo }) {
  const config = obterConfigInstagram(projectId);

  if (!config.ativo || !config.igUserId || !config.accessToken) {
    throw new Error('Configure e ative a conta do Instagram antes de publicar.');
  }

  if (!mediaUrl) {
    throw new Error('O Instagram exige uma foto ou vídeo para publicação.');
  }

  const legendaFinal = prepararLegendaInstagram(legenda, config);

  const resultado = await instagramService.publicarNoInstagram({
    igUserId: config.igUserId,
    accessToken: config.accessToken,
    mediaUrl,
    legenda: legendaFinal,
    tipo
  });

  registrarHistoricoInstagram(projectId, {
    titulo,
    tipo: tipo || 'foto',
    mediaUrl,
    legenda: legendaFinal,
    postUrl: resultado.postUrl || resultado.permalink,
    mediaId: resultado.mediaId,
    origem: 'manual',
    sucesso: true
  });

  return resultado;
}

module.exports = {
  obterConfigInstagram,
  salvarConfigInstagram,
  obterHistoricoInstagram,
  limparHistoricoInstagram,
  publicarEspelhamentoInstagram,
  publicarPostManual
};
