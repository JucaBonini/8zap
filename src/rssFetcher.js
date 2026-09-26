const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Parser = require('rss-parser');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure', 'enclosure']
    ]
  }
});

/**
 * Remove tags HTML e decodifica entidades básicas para texto limpo
 * @param {string} html
 * @returns {string}
 */
function limparHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tenta extrair a melhor URL de imagem do item do feed RSS
 * @param {object} item
 * @returns {string|null}
 */
function extrairImagem(item) {
  // 1. Enclosure (ex: podcast/foto anexada)
  if (item.enclosure && item.enclosure.url && (!item.enclosure.type || item.enclosure.type.startsWith('image/'))) {
    return item.enclosure.url;
  }

  // 2. Media content
  if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
    return item.mediaContent.$.url;
  }
  if (item.mediaThumbnail && item.mediaThumbnail.$ && item.mediaThumbnail.$.url) {
    return item.mediaThumbnail.$.url;
  }

  // 3. Procura tag <img> no conteúdo HTML
  const conteudo = item['content:encoded'] || item.content || item.summary || item.description || '';
  const matchImg = conteudo.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (matchImg && matchImg[1]) {
    return matchImg[1];
  }

  return null;
}

/**
 * Tenta extrair a imagem principal (og:image) diretamente do HTML da página da receita
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function extrairImagemDaPaginaHtml(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const html = await resp.text();

    // 1. og:image
    const matchOg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (matchOg && matchOg[1]) {
      return matchOg[1].trim();
    }

    // 2. twitter:image
    const matchTwitter = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (matchTwitter && matchTwitter[1]) {
      return matchTwitter[1].trim();
    }

    // 3. Primeira imagem do artigo
    const matchArticleImg = html.match(/<article[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
    if (matchArticleImg && matchArticleImg[1]) {
      return matchArticleImg[1].trim();
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Gera um hash estável MD5 a partir de uma string
 * @param {string} texto
 * @returns {string}
 */
function gerarHash(texto) {
  return crypto.createHash('md5').update(texto || '').digest('hex');
}

/**
 * Retorna o caminho do arquivo de configuração de RSS do projeto
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoConfigRss(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `config-rss-${idSanitizado}.json`);
}

/**
 * Retorna o caminho do pool de artigos do projeto
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoArtigos(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `artigos-${idSanitizado}.json`);
}

/**
 * Obtém a configuração de RSS do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigRss(projectId) {
  const caminho = obterCaminhoConfigRss(projectId);
  const configPadrao = {
    rssUrl: '',
    ativo: false,
    quantidadePorDia: 5,
    horarios: ['09:00', '12:00', '15:00', '18:00', '21:00'],
    destinosPermitidos: [],
    templateMensagem: '',
    destinosManuais: []
  };

  if (!fs.existsSync(caminho)) {
    return configPadrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const config = JSON.parse(conteudo);
    return { ...configPadrao, ...config };
  } catch (err) {
    logProjeto(projectId, 'ERRO_CONFIG_RSS', `Falha ao ler config RSS: ${err.message}`, 'error');
    return configPadrao;
  }
}

/**
 * Salva a configuração de RSS do projeto
 * @param {string} projectId
 * @param {object} novaConfig
 * @returns {object}
 */
function salvarConfigRss(projectId, novaConfig) {
  const configAtual = obterConfigRss(projectId);
  const configFinal = {
    ...configAtual,
    ...novaConfig,
    quantidadePorDia: parseInt(novaConfig.quantidadePorDia, 10) || configAtual.quantidadePorDia || 5,
    horarios: Array.isArray(novaConfig.horarios) ? novaConfig.horarios : configAtual.horarios,
    destinosPermitidos: Array.isArray(novaConfig.destinosPermitidos) ? novaConfig.destinosPermitidos : configAtual.destinosPermitidos,
    templateMensagem: typeof novaConfig.templateMensagem === 'string' ? novaConfig.templateMensagem : (configAtual.templateMensagem || ''),
    destinosManuais: Array.isArray(novaConfig.destinosManuais) ? novaConfig.destinosManuais : configAtual.destinosManuais
  };

  // Remove campos legados que não são mais usados
  delete configFinal.cooldownHorasPorDestino;

  const caminho = obterCaminhoConfigRss(projectId);
  fs.writeFileSync(caminho, JSON.stringify(configFinal, null, 2), 'utf8');
  logProjeto(projectId, 'CONFIG_RSS_ATUALIZADA', 'Configuração de RSS salva com sucesso.', 'info');
  return configFinal;
}

/**
 * Lê o pool de artigos salvos para o projeto
 * @param {string} projectId
 * @returns {Array<object>}
 */
function lerPoolArtigos(projectId) {
  const caminho = obterCaminhoArtigos(projectId);
  if (!fs.existsSync(caminho)) {
    return [];
  }
  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(projectId, 'ERRO_POOL_ARTIGOS', `Falha ao ler pool de artigos: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Salva o pool de artigos no disco
 * @param {string} projectId
 * @param {Array<object>} artigos
 */
function salvarPoolArtigos(projectId, artigos) {
  const caminho = obterCaminhoArtigos(projectId);
  fs.writeFileSync(caminho, JSON.stringify(artigos, null, 2), 'utf8');
}

/**
 * Busca novos artigos do feed RSS configurado e alimenta o pool
 * @param {string} projectId
 * @returns {Promise<object>}
 */
async function buscarNovosArtigos(projectId) {
  const config = obterConfigRss(projectId);

  if (!config.rssUrl || typeof config.rssUrl !== 'string' || !config.rssUrl.trim()) {
    return { novos: 0, total: 0, aviso: 'Nenhuma URL de RSS configurada para este projeto.' };
  }

  logProjeto(projectId, 'RSS_FETCH', `Buscando artigos do feed: ${config.rssUrl}...`, 'info');

  try {
    const feed = await parser.parseURL(config.rssUrl.trim());
    const artigosAtuais = lerPoolArtigos(projectId);
    const idsExistentes = new Set(artigosAtuais.map((a) => a.id));

    let novosAdicionados = 0;

    for (const item of feed.items || []) {
      const link = item.link || item.guid || '';
      if (!link) continue;

      const id = gerarHash(link);

      if (!idsExistentes.has(id)) {
        const textoBruto = item['content:encoded'] || item.content || item.summary || item.description || '';
        const textoLimpo = limparHtml(textoBruto);
        const resumo = textoLimpo.length > 300 ? textoLimpo.substring(0, 300) + '...' : textoLimpo;
        const imagem = extrairImagem(item);

        const novoArtigo = {
          id,
          titulo: item.title ? item.title.trim() : 'Sem título',
          link: link.trim(),
          resumo,
          imagem,
          publicado_em: item.pubDate || item.isoDate || new Date().toISOString(),
          usado: false,
          usado_em: null
        };

        artigosAtuais.push(novoArtigo);
        idsExistentes.add(id);
        novosAdicionados++;
      }
    }

    if (novosAdicionados > 0) {
      salvarPoolArtigos(projectId, artigosAtuais);
      logProjeto(
        projectId,
        'RSS_NOVOS_ARTIGOS',
        `${novosAdicionados} novos artigo(s) adicionado(s) ao pool. Total no pool: ${artigosAtuais.length}.`,
        'success'
      );
    } else {
      logProjeto(projectId, 'RSS_FETCH', `Nenhum artigo novo encontrado. Pool atual: ${artigosAtuais.length} artigos.`, 'info');
    }

    return {
      novos: novosAdicionados,
      total: artigosAtuais.length,
      disponiveis: artigosAtuais.filter((a) => !a.usado).length
    };
  } catch (err) {
    logProjeto(projectId, 'ERRO_BUSCA_RSS', `Falha ao buscar feed RSS (${config.rssUrl}): ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Obtém um artigo aleatório que ainda não foi usado
 * Se não houver, força uma busca no feed antes de desistir
 * @param {string} projectId
 * @returns {Promise<object|null>}
 */
async function obterArtigoAleatorioNaoUsado(projectId) {
  let pool = lerPoolArtigos(projectId);
  let disponiveis = pool.filter((a) => !a.usado);

  // Se não houver artigos disponíveis, tenta buscar novos no feed agora
  if (disponiveis.length === 0) {
    logProjeto(projectId, 'RSS_POOL_VAZIO', 'Nenhum artigo não usado no pool. Tentando buscar novos no feed...', 'warn');
    try {
      await buscarNovosArtigos(projectId);
      pool = lerPoolArtigos(projectId);
      disponiveis = pool.filter((a) => !a.usado);
    } catch (e) {
      logProjeto(projectId, 'ERRO_BUSCA_RSS', `Erro ao buscar novos artigos: ${e.message}`, 'error');
    }
  }

  if (disponiveis.length === 0) {
    logProjeto(
      projectId,
      'RSS_SEM_ARTIGO',
      'Nenhum artigo novo disponível no feed RSS. Nenhuma postagem reciclada foi disparada.',
      'warn'
    );
    return null;
  }

  // Sorteia um artigo aleatório dentre os disponíveis
  const indiceAleatorio = Math.floor(Math.random() * disponiveis.length);
  return disponiveis[indiceAleatorio];
}

/**
 * Marca um artigo como usado após o envio com sucesso
 * @param {string} projectId
 * @param {string} idArtigo
 */
function marcarArtigoComoUsado(projectId, idArtigo) {
  const pool = lerPoolArtigos(projectId);
  const artigo = pool.find((a) => a.id === idArtigo);
  if (artigo) {
    artigo.usado = true;
    artigo.usado_em = new Date().toISOString();
    salvarPoolArtigos(projectId, pool);
    logProjeto(projectId, 'ARTIGO_MARCADO_USADO', `Artigo "${artigo.titulo}" marcado como usado.`, 'info');
  }
}

/**
 * Retorna estatísticas gerais do pool de artigos
 * @param {string} projectId
 * @returns {object}
 */
function obterEstatisticasArtigos(projectId) {
  const pool = lerPoolArtigos(projectId);
  const usados = pool.filter((a) => a.usado).length;
  const disponiveis = pool.filter((a) => !a.usado).length;

  return {
    total: pool.length,
    usados,
    disponiveis,
    artigos: pool.slice(-30).reverse() // últimos 30 artigos
  };
}

module.exports = {
  obterConfigRss,
  salvarConfigRss,
  buscarNovosArtigos,
  obterArtigoAleatorioNaoUsado,
  marcarArtigoComoUsado,
  obterEstatisticasArtigos,
  extrairImagemDaPaginaHtml
};
