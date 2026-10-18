const META_GRAPH_VERSION = 'v21.0';
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/**
 * Normaliza erros retornados pela API do Instagram/Meta para mensagens claras em português
 * @param {object} erroJson
 * @param {number} statusHttp
 * @returns {string}
 */
function formatarErroInstagram(erroJson, statusHttp) {
  const detalhe = erroJson?.error || {};
  const msg = detalhe.message || 'Erro desconhecido na Meta Graph API (Instagram)';
  const code = detalhe.code ? ` (Código: ${detalhe.code})` : '';
  const subcode = detalhe.error_subcode ? ` [Subcódigo: ${detalhe.error_subcode}]` : '';

  if (detalhe.code === 190) {
    return 'Token de acesso da Meta/Instagram inválido ou expirado. Gere um novo token no Meta for Developers.';
  }
  if (detalhe.code === 200 || detalhe.code === 10) {
    return 'Permissão insuficiente no token. É necessário ter as permissões: instagram_basic, instagram_content_publish e pages_show_list.';
  }
  if (detalhe.code === 24) {
    return 'ID da conta do Instagram inválido ou a conta não é Comercial/Criador de Conteúdo vinculada.';
  }
  if (detalhe.code === 100 && (detalhe.error_subcode === 2207001 || msg.includes('aspect_ratio') || msg.includes('dimension'))) {
    return 'A imagem não cumpre os requisitos de proporção do Instagram (proporção permitida entre 4:5 vertical e 1.91:1 horizontal).';
  }
  if (detalhe.code === 100 && (msg.includes('image_url') || msg.includes('download') || msg.includes('URL'))) {
    return `O Instagram não conseguiu acessar a imagem via URL pública. Certifique-se de que o link é acessível pela internet: ${msg}`;
  }

  return `${msg}${code}${subcode} [HTTP ${statusHttp || 500}]`;
}

/**
 * Normaliza uma URL de mídia (foto/vídeo) para que seja pública e acessível pela Meta
 * @param {string} mediaUrl
 * @param {string} [baseUrl]
 * @returns {string}
 */
function normalizarUrlPublica(mediaUrl, baseUrl = process.env.PUBLIC_URL || 'https://8zap.online') {
  if (!mediaUrl) return '';
  const urlLimpa = String(mediaUrl).trim();

  // Já é URL completa pública
  if (urlLimpa.startsWith('http://') || urlLimpa.startsWith('https://')) {
    return urlLimpa;
  }

  const base = (baseUrl || 'https://8zap.online').replace(/\/+$/, '');
  const caminho = urlLimpa.startsWith('/') ? urlLimpa : `/${urlLimpa}`;
  return `${base}${caminho}`;
}

/**
 * Detecta contas do Instagram Business vinculadas ao Token ou a uma Página do Facebook
 * @param {object} params
 * @param {string} params.accessToken
 * @param {string} [params.pageId]
 * @returns {Promise<Array<object>>}
 */
async function detectarContasInstagram({ accessToken, pageId }) {
  if (!accessToken) {
    throw new Error('Token de acesso da Meta é obrigatório para detectar contas.');
  }

  const tokenLimpo = String(accessToken).trim();
  const contasEncontradas = [];

  // Se o pageId foi fornecido diretamente
  if (pageId && String(pageId).trim()) {
    const idLimpo = String(pageId).trim();
    try {
      const url = `${META_GRAPH_URL}/${idLimpo}?fields=name,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(tokenLimpo)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.instagram_business_account) {
        contasEncontradas.push({
          pageId: data.id,
          pageNome: data.name,
          igUserId: data.instagram_business_account.id,
          username: data.instagram_business_account.username || '',
          nome: data.instagram_business_account.name || '',
          foto: data.instagram_business_account.profile_picture_url || ''
        });
        return contasEncontradas;
      }
    } catch (_) {}
  }

  // Tenta listar todas as páginas associadas ao token para descobrir contas do Instagram
  try {
    const urlPages = `${META_GRAPH_URL}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(tokenLimpo)}`;
    const resPages = await fetch(urlPages);
    const dataPages = await resPages.json().catch(() => ({}));

    if (!resPages.ok) {
      throw new Error(formatarErroInstagram(dataPages, resPages.status));
    }

    const paginas = Array.isArray(dataPages.data) ? dataPages.data : [];
    for (const pag of paginas) {
      if (pag.instagram_business_account) {
        contasEncontradas.push({
          pageId: pag.id,
          pageNome: pag.name,
          pageAccessToken: pag.access_token || tokenLimpo,
          igUserId: pag.instagram_business_account.id,
          username: pag.instagram_business_account.username || '',
          nome: pag.instagram_business_account.name || '',
          foto: pag.instagram_business_account.profile_picture_url || ''
        });
      }
    }
  } catch (err) {
    throw new Error(`Falha ao buscar contas do Instagram vinculadas: ${err.message}`);
  }

  return contasEncontradas;
}

/**
 * Valida a conexão com uma conta do Instagram Business e obtém dados do perfil
 * @param {string} igUserId
 * @param {string} accessToken
 * @returns {Promise<object>}
 */
async function verificarContaInstagram(igUserId, accessToken) {
  if (!igUserId || !accessToken) {
    throw new Error('ID da conta do Instagram e Access Token são obrigatórios.');
  }

  const idLimpo = String(igUserId).trim();
  const tokenLimpo = String(accessToken).trim();

  const url = `${META_GRAPH_URL}/${idLimpo}?fields=id,username,name,profile_picture_url,followers_count,media_count&access_token=${encodeURIComponent(tokenLimpo)}`;

  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(formatarErroInstagram(data, res.status));
    }

    return {
      sucesso: true,
      igUserId: data.id,
      username: data.username || '',
      nome: data.name || data.username || 'Instagram Business',
      foto: data.profile_picture_url || '',
      seguidores: data.followers_count || 0,
      totalPosts: data.media_count || 0
    };
  } catch (err) {
    throw new Error(`Falha ao conectar à conta do Instagram: ${err.message}`);
  }
}

/**
 * Publica uma foto no feed do Instagram Business
 * @param {object} params
 * @param {string} params.igUserId
 * @param {string} params.accessToken
 * @param {string} params.imagemUrl
 * @param {string} [params.legenda]
 * @param {string} [params.baseUrl]
 * @returns {Promise<object>}
 */
async function publicarFotoInstagram({ igUserId, accessToken, imagemUrl, legenda = '', baseUrl }) {
  if (!igUserId || !accessToken) {
    throw new Error('ID da Conta do Instagram e Access Token são obrigatórios.');
  }

  const urlPublica = normalizarUrlPublica(imagemUrl, baseUrl);
  if (!urlPublica) {
    throw new Error('O Instagram exige uma URL válida de imagem pública para publicação.');
  }

  const idLimpo = String(igUserId).trim();
  const tokenLimpo = String(accessToken).trim();
  const legendaLimpa = (legenda || '').trim();

  // Etapa 1: Criar container de mídia no Instagram
  const endpointContainer = `${META_GRAPH_URL}/${idLimpo}/media`;
  const corpoContainer = new URLSearchParams({
    image_url: urlPublica,
    access_token: tokenLimpo
  });
  if (legendaLimpa) {
    corpoContainer.append('caption', legendaLimpa);
  }

  const resContainer = await fetch(endpointContainer, {
    method: 'POST',
    body: corpoContainer
  });
  const dataContainer = await resContainer.json().catch(() => ({}));

  if (!resContainer.ok || !dataContainer.id) {
    throw new Error(formatarErroInstagram(dataContainer, resContainer.status));
  }

  const creationId = dataContainer.id;

  // Etapa 2: Publicar container criado
  const endpointPublish = `${META_GRAPH_URL}/${idLimpo}/media_publish`;
  const corpoPublish = new URLSearchParams({
    creation_id: creationId,
    access_token: tokenLimpo
  });

  const resPublish = await fetch(endpointPublish, {
    method: 'POST',
    body: corpoPublish
  });
  const dataPublish = await resPublish.json().catch(() => ({}));

  if (!resPublish.ok || !dataPublish.id) {
    throw new Error(formatarErroInstagram(dataPublish, resPublish.status));
  }

  const mediaId = dataPublish.id;

  // Etapa 3: Buscar permalink público do post (se disponível)
  let permalink = null;
  try {
    const resMedia = await fetch(`${META_GRAPH_URL}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(tokenLimpo)}`);
    const dataMedia = await resMedia.json().catch(() => ({}));
    if (resMedia.ok && dataMedia.permalink) {
      permalink = dataMedia.permalink;
    }
  } catch (_) {}

  return {
    sucesso: true,
    mediaId,
    creationId,
    permalink: permalink || `https://www.instagram.com/`,
    postUrl: permalink || `https://www.instagram.com/`
  };
}

/**
 * Publica um vídeo (Reels) no Instagram Business
 * @param {object} params
 * @param {string} params.igUserId
 * @param {string} params.accessToken
 * @param {string} params.videoUrl
 * @param {string} [params.legenda]
 * @param {string} [params.baseUrl]
 * @returns {Promise<object>}
 */
async function publicarReelsInstagram({ igUserId, accessToken, videoUrl, legenda = '', baseUrl }) {
  if (!igUserId || !accessToken) {
    throw new Error('ID da Conta do Instagram e Access Token são obrigatórios.');
  }

  const urlPublica = normalizarUrlPublica(videoUrl, baseUrl);
  if (!urlPublica) {
    throw new Error('O Instagram exige uma URL válida de vídeo público para publicação de Reels.');
  }

  const idLimpo = String(igUserId).trim();
  const tokenLimpo = String(accessToken).trim();
  const legendaLimpa = (legenda || '').trim();

  // Etapa 1: Criar container de Reels
  const endpointContainer = `${META_GRAPH_URL}/${idLimpo}/media`;
  const corpoContainer = new URLSearchParams({
    media_type: 'REELS',
    video_url: urlPublica,
    access_token: tokenLimpo
  });
  if (legendaLimpa) {
    corpoContainer.append('caption', legendaLimpa);
  }

  const resContainer = await fetch(endpointContainer, {
    method: 'POST',
    body: corpoContainer
  });
  const dataContainer = await resContainer.json().catch(() => ({}));

  if (!resContainer.ok || !dataContainer.id) {
    throw new Error(formatarErroInstagram(dataContainer, resContainer.status));
  }

  const creationId = dataContainer.id;

  // Etapa 2: Aguardar o processamento do vídeo pela Meta (polling)
  let pronto = false;
  let tentativas = 0;
  const maxTentativas = 15; // até ~45 segundos

  while (!pronto && tentativas < maxTentativas) {
    tentativas++;
    await new Promise((r) => setTimeout(r, 3000));

    try {
      const resStatus = await fetch(`${META_GRAPH_URL}/${creationId}?fields=status_code&access_token=${encodeURIComponent(tokenLimpo)}`);
      const dataStatus = await resStatus.json().catch(() => ({}));

      if (dataStatus.status_code === 'FINISHED') {
        pronto = true;
        break;
      }
      if (dataStatus.status_code === 'ERROR' || dataStatus.status_code === 'EXPIRED') {
        throw new Error('Falha no processamento do vídeo no Instagram. Verifique formato MP4 e codec compatível.');
      }
    } catch (e) {
      if (tentativas >= maxTentativas) throw e;
    }
  }

  // Etapa 3: Publicar o container
  const endpointPublish = `${META_GRAPH_URL}/${idLimpo}/media_publish`;
  const corpoPublish = new URLSearchParams({
    creation_id: creationId,
    access_token: tokenLimpo
  });

  const resPublish = await fetch(endpointPublish, {
    method: 'POST',
    body: corpoPublish
  });
  const dataPublish = await resPublish.json().catch(() => ({}));

  if (!resPublish.ok || !dataPublish.id) {
    throw new Error(formatarErroInstagram(dataPublish, resPublish.status));
  }

  const mediaId = dataPublish.id;

  let permalink = null;
  try {
    const resMedia = await fetch(`${META_GRAPH_URL}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(tokenLimpo)}`);
    const dataMedia = await resMedia.json().catch(() => ({}));
    if (resMedia.ok && dataMedia.permalink) {
      permalink = dataMedia.permalink;
    }
  } catch (_) {}

  return {
    sucesso: true,
    mediaId,
    creationId,
    permalink: permalink || `https://www.instagram.com/`,
    postUrl: permalink || `https://www.instagram.com/`
  };
}

/**
 * Publicador inteligente: detecta se a mídia é vídeo ou imagem e despacha para a função correta
 * @param {object} params
 * @returns {Promise<object>}
 */
async function publicarNoInstagram(params) {
  const { mediaUrl, tipo } = params;
  const urlMin = (mediaUrl || '').toLowerCase();

  const isVideo = tipo === 'video' || urlMin.endsWith('.mp4') || urlMin.endsWith('.mov') || urlMin.endsWith('.webm');

  if (isVideo) {
    return await publicarReelsInstagram({ ...params, videoUrl: mediaUrl });
  }

  return await publicarFotoInstagram({ ...params, imagemUrl: mediaUrl });
}

module.exports = {
  detectarContasInstagram,
  verificarContaInstagram,
  publicarFotoInstagram,
  publicarReelsInstagram,
  publicarNoInstagram,
  normalizarUrlPublica,
  formatarErroInstagram
};
