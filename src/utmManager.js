const fs = require('fs');
const path = require('path');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

function obterCaminhoConfigUtm(projectId) {
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `config-utm-${idSanitizado}.json`);
}

function obterCaminhoCliquesPonte(projectId) {
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `cliques-ponte-${idSanitizado}.json`);
}

/**
 * Retorna as configurações de UTM do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigUtm(projectId = 'Receitas') {
  const caminho = obterCaminhoConfigUtm(projectId);
  const padrao = {
    ativoGlobal: true,
    canais: {
      facebook: {
        nome: 'Página Facebook (1º Comentário)',
        ativo: true,
        source: 'facebook',
        medium: 'comment',
        campaign: 'fanpage-mary',
        content: 'receita-detalhada'
      },
      whatsapp_canal: {
        nome: 'Canal do WhatsApp (Newsletter)',
        ativo: true,
        source: 'whatsapp',
        medium: 'canal',
        campaign: 'receitas-vip',
        content: 'disparo-diario'
      },
      whatsapp_grupo: {
        nome: 'Grupos do WhatsApp',
        ativo: true,
        source: 'whatsapp',
        medium: 'grupos',
        campaign: 'disparo-grupos',
        content: 'receita-grupo'
      },
      rss: {
        nome: 'Feed RSS (Artigos Automáticos)',
        ativo: true,
        source: 'rss',
        medium: 'feed-auto',
        campaign: 'rss-receitas',
        content: 'artigo-site'
      }
    },
    linkPonte: {
      ativo: true,
      slug: 'canal-whatsapp',
      destino: 'https://whatsapp.com/channel/0029Va5fCv1FXUuaQxDdVg0H',
      titulo: 'Canal Oficial de Receitas no WhatsApp'
    }
  };

  if (!fs.existsSync(caminho)) {
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return {
      ativoGlobal: dados.ativoGlobal !== false,
      canais: {
        facebook: { ...padrao.canais.facebook, ...(dados.canais?.facebook || {}) },
        whatsapp_canal: { ...padrao.canais.whatsapp_canal, ...(dados.canais?.whatsapp_canal || {}) },
        whatsapp_grupo: { ...padrao.canais.whatsapp_grupo, ...(dados.canais?.whatsapp_grupo || {}) },
        rss: { ...padrao.canais.rss, ...(dados.canais?.rss || {}) }
      },
      linkPonte: {
        ...padrao.linkPonte,
        ...(dados.linkPonte || {})
      }
    };
  } catch (_) {
    return padrao;
  }
}

/**
 * Salva as configurações de UTM
 * @param {string} projectId
 * @param {object} dados
 * @returns {object}
 */
function salvarConfigUtm(projectId = 'Receitas', dados) {
  const caminho = obterCaminhoConfigUtm(projectId);
  const atual = obterConfigUtm(projectId);

  const mesclado = {
    ativoGlobal: dados.ativoGlobal !== false,
    canais: {
      facebook: {
        ...atual.canais.facebook,
        ativo: Boolean(dados.canais?.facebook?.ativo),
        source: (dados.canais?.facebook?.source || 'facebook').trim().toLowerCase(),
        medium: (dados.canais?.facebook?.medium || 'comment').trim().toLowerCase(),
        campaign: (dados.canais?.facebook?.campaign || 'fanpage-mary').trim().toLowerCase(),
        content: (dados.canais?.facebook?.content || '').trim().toLowerCase()
      },
      whatsapp_canal: {
        ...atual.canais.whatsapp_canal,
        ativo: Boolean(dados.canais?.whatsapp_canal?.ativo),
        source: (dados.canais?.whatsapp_canal?.source || 'whatsapp').trim().toLowerCase(),
        medium: (dados.canais?.whatsapp_canal?.medium || 'canal').trim().toLowerCase(),
        campaign: (dados.canais?.whatsapp_canal?.campaign || 'receitas-vip').trim().toLowerCase(),
        content: (dados.canais?.whatsapp_canal?.content || '').trim().toLowerCase()
      },
      whatsapp_grupo: {
        ...atual.canais.whatsapp_grupo,
        ativo: Boolean(dados.canais?.whatsapp_grupo?.ativo),
        source: (dados.canais?.whatsapp_grupo?.source || 'whatsapp').trim().toLowerCase(),
        medium: (dados.canais?.whatsapp_grupo?.medium || 'grupos').trim().toLowerCase(),
        campaign: (dados.canais?.whatsapp_grupo?.campaign || 'disparo-grupos').trim().toLowerCase(),
        content: (dados.canais?.whatsapp_grupo?.content || '').trim().toLowerCase()
      },
      rss: {
        ...atual.canais.rss,
        ativo: Boolean(dados.canais?.rss?.ativo),
        source: (dados.canais?.rss?.source || 'rss').trim().toLowerCase(),
        medium: (dados.canais?.rss?.medium || 'feed-auto').trim().toLowerCase(),
        campaign: (dados.canais?.rss?.campaign || 'rss-receitas').trim().toLowerCase(),
        content: (dados.canais?.rss?.content || '').trim().toLowerCase()
      }
    },
    linkPonte: {
      ...atual.linkPonte,
      ativo: dados.linkPonte?.ativo !== false,
      slug: (dados.linkPonte?.slug || 'canal-whatsapp').trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''),
      destino: (dados.linkPonte?.destino || 'https://whatsapp.com/channel/0029Va5fCv1FXUuaQxDdVg0H').trim(),
      titulo: (dados.linkPonte?.titulo || 'Canal Oficial de Receitas no WhatsApp').trim()
    }
  };

  fs.writeFileSync(caminho, JSON.stringify(mesclado, null, 2), 'utf8');
  logProjeto(projectId, 'UTM_CONFIG_SALVA', 'Configurações de UTM e métricas salvas com sucesso.', 'info');
  return mesclado;
}

/**
 * Anexa parâmetros de UTM a uma URL preservando parâmetros existentes
 * @param {string} urlOriginal
 * @param {string} canal - 'facebook' | 'whatsapp_canal' | 'whatsapp_grupo' | 'rss'
 * @param {string} projectId
 * @param {object} [paramsCustom]
 * @returns {string}
 */
function anexarUtm(urlOriginal, canal, projectId = 'Receitas', paramsCustom = {}) {
  if (!urlOriginal || typeof urlOriginal !== 'string') {
    return urlOriginal;
  }

  const urlLimpa = urlOriginal.trim();
  if (!urlLimpa.startsWith('http://') && !urlLimpa.startsWith('https://')) {
    return urlOriginal;
  }

  try {
    const urlObj = new URL(urlLimpa);

    // Não anexa UTMs em domínios de redes sociais (ex: whatsapp.com, instagram.com, facebook.com)
    const host = urlObj.hostname.toLowerCase();
    if (host.includes('whatsapp.com') || host.includes('facebook.com') || host.includes('instagram.com') || host.includes('t.me')) {
      return urlOriginal;
    }

    const config = obterConfigUtm(projectId);
    if (!config.ativoGlobal) {
      return urlOriginal;
    }

    const configCanal = config.canais?.[canal];
    if (!configCanal || !configCanal.ativo) {
      return urlOriginal;
    }

    const source = paramsCustom.source || configCanal.source;
    const medium = paramsCustom.medium || configCanal.medium;
    const campaign = paramsCustom.campaign || configCanal.campaign;
    const content = paramsCustom.content || configCanal.content;

    if (source) urlObj.searchParams.set('utm_source', source);
    if (medium) urlObj.searchParams.set('utm_medium', medium);
    if (campaign) urlObj.searchParams.set('utm_campaign', campaign);
    if (content) urlObj.searchParams.set('utm_content', content);

    return urlObj.toString();
  } catch (_) {
    return urlOriginal;
  }
}

/**
 * Registra um clique no Link Ponte de redirecionamento
 * @param {string} projectId
 * @param {object} infoReq
 */
function registrarCliquePonte(projectId = 'Receitas', infoReq = {}) {
  const caminho = obterCaminhoCliquesPonte(projectId);
  let dados = { totalCliques: 0, ultimosCliques: [] };

  if (fs.existsSync(caminho)) {
    try {
      dados = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (!Array.isArray(dados.ultimosCliques)) dados.ultimosCliques = [];
    } catch (_) {}
  }

  dados.totalCliques = (Number(dados.totalCliques) || 0) + 1;
  dados.ultimoCliqueEm = new Date().toISOString();

  const registro = {
    dataHora: new Date().toISOString(),
    ip: infoReq.ip || 'desconhecido',
    origemReferer: infoReq.referer || 'direto',
    userAgent: infoReq.userAgent || ''
  };

  dados.ultimosCliques.unshift(registro);
  // Mantém apenas os últimos 50 cliques no histórico
  if (dados.ultimosCliques.length > 50) {
    dados.ultimosCliques = dados.ultimosCliques.slice(0, 50);
  }

  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf8');
  return dados;
}

/**
 * Retorna estatísticas de cliques do Link Ponte
 * @param {string} projectId
 * @returns {object}
 */
function obterEstatisticasPonte(projectId = 'Receitas') {
  const caminho = obterCaminhoCliquesPonte(projectId);
  if (!fs.existsSync(caminho)) {
    return { totalCliques: 0, ultimosCliques: [], ultimoCliqueEm: null };
  }
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (_) {
    return { totalCliques: 0, ultimosCliques: [], ultimoCliqueEm: null };
  }
}

module.exports = {
  obterConfigUtm,
  salvarConfigUtm,
  anexarUtm,
  registrarCliquePonte,
  obterEstatisticasPonte
};
