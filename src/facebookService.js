const fs = require('fs');
const path = require('path');

const META_GRAPH_VERSION = 'v21.0';
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/**
 * Normaliza erros retornados pela API do Facebook para mensagens claras em português
 * @param {object} erroJson
 * @param {number} statusHttp
 * @returns {string}
 */
function formatarErroFacebook(erroJson, statusHttp) {
  const detalhe = erroJson?.error || {};
  const msg = detalhe.message || 'Erro desconhecido na Meta Graph API';
  const code = detalhe.code ? ` (Código: ${detalhe.code})` : '';
  const subcode = detalhe.error_subcode ? ` [Subcódigo: ${detalhe.error_subcode}]` : '';

  if (detalhe.code === 190) {
    return 'Token de acesso do Facebook inválido ou expirado. Gere um novo Page Access Token no Meta for Developers.';
  }
  if (detalhe.code === 200 || detalhe.code === 10) {
    return 'Permissão insuficiente. O token precisa da permissão "pages_manage_posts" e "pages_read_engagement".';
  }
  if (detalhe.code === 100) {
    return `Parâmetro inválido na requisição: ${msg}${code}${subcode}`;
  }

  return `${msg}${code}${subcode} [HTTP ${statusHttp}]`;
}

/**
 * Valida a conexão com a Página do Facebook e retorna informações básicas
 * @param {string} pageId
 * @param {string} pageAccessToken
 * @returns {Promise<object>}
 */
async function verificarConexaoPagina(pageId, pageAccessToken) {
  if (!pageId || !pageAccessToken) {
    throw new Error('Page ID e Page Access Token são obrigatórios para validar a conexão.');
  }

  const idLimpo = String(pageId).trim();
  const tokenLimpo = String(pageAccessToken).trim();

  const url = `${META_GRAPH_URL}/${idLimpo}?fields=id,name,link,picture.type(large),fan_count,is_published&access_token=${encodeURIComponent(tokenLimpo)}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(formatarErroFacebook(data, res.status));
    }

    return {
      sucesso: true,
      id: data.id,
      nome: data.name,
      link: data.link || `https://facebook.com/${data.id}`,
      foto: data.picture?.data?.url || null,
      seguidores: data.fan_count || 0,
      publicada: Boolean(data.is_published)
    };
  } catch (err) {
    throw new Error(`Falha ao conectar à Página do Facebook: ${err.message}`);
  }
}

/**
 * Publica uma foto na Página do Facebook com legenda e comentário opcional
 * @param {object} params
 * @param {string} params.pageId
 * @param {string} params.pageAccessToken
 * @param {string} [params.imagemUrl] - URL HTTP ou caminho relativo (/uploads/...)
 * @param {string} [params.caminhoArquivoLocal] - Caminho absoluto no disco
 * @param {string} params.legenda - Texto do post nativo
 * @param {string} [params.linkComentario] - Link ou texto para o 1º comentário
 * @returns {Promise<object>}
 */
async function publicarFotoNaPagina({
  pageId,
  pageAccessToken,
  imagemUrl,
  caminhoArquivoLocal,
  legenda,
  linkComentario
}) {
  const idLimpo = String(pageId).trim();
  const tokenLimpo = String(pageAccessToken).trim();
  const legendaLimpa = (legenda || '').trim();

  const form = new FormData();
  form.append('access_token', tokenLimpo);
  if (legendaLimpa) {
    form.append('caption', legendaLimpa);
  }

  // Identifica se temos arquivo local no disco
  let arquivoParaUpload = null;
  let nomeArquivo = 'foto.jpg';

  if (caminhoArquivoLocal && fs.existsSync(caminhoArquivoLocal)) {
    arquivoParaUpload = caminhoArquivoLocal;
    nomeArquivo = path.basename(caminhoArquivoLocal);
  } else if (imagemUrl) {
    if (imagemUrl.startsWith('/uploads/') || imagemUrl.startsWith('uploads/')) {
      const relativo = imagemUrl.replace(/^\/?uploads\//, '');
      const absoluto = path.join(__dirname, '..', 'public', 'uploads', relativo);
      if (fs.existsSync(absoluto)) {
        arquivoParaUpload = absoluto;
        nomeArquivo = path.basename(absoluto);
      }
    }
  }

  if (arquivoParaUpload) {
    const buffer = fs.readFileSync(arquivoParaUpload);
    const ext = path.extname(nomeArquivo).toLowerCase();
    let mime = 'image/jpeg';
    if (ext === '.png') mime = 'image/png';
    else if (ext === '.webp') mime = 'image/webp';
    else if (ext === '.gif') mime = 'image/gif';

    form.append('source', new Blob([buffer], { type: mime }), nomeArquivo);
  } else if (imagemUrl && (imagemUrl.startsWith('http://') || imagemUrl.startsWith('https://'))) {
    form.append('url', imagemUrl);
  } else {
    throw new Error('Nenhuma imagem válida (arquivo local ou URL pública) foi informada para o post.');
  }

  const resFoto = await fetch(`${META_GRAPH_URL}/${idLimpo}/photos`, {
    method: 'POST',
    body: form
  });

  const dataFoto = await resFoto.json().catch(() => ({}));
  if (!resFoto.ok) {
    throw new Error(formatarErroFacebook(dataFoto, resFoto.status));
  }

  const photoId = dataFoto.id;
  const postId = dataFoto.post_id || dataFoto.id;
  let commentId = null;

  // Se houver texto para o primeiro comentário (ex: link da receita)
  if (linkComentario && linkComentario.trim()) {
    try {
      const resComentario = await fetch(`${META_GRAPH_URL}/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: tokenLimpo,
          message: linkComentario.trim()
        })
      });

      const dataComentario = await resComentario.json().catch(() => ({}));
      if (resComentario.ok && dataComentario.id) {
        commentId = dataComentario.id;
      }
    } catch (errComentario) {
      console.warn('[FacebookService] Erro ao postar 1º comentário:', errComentario.message);
    }
  }

  return {
    sucesso: true,
    photoId,
    postId,
    commentId,
    postUrl: `https://facebook.com/${postId}`
  };
}

/**
 * Publica um post somente de texto na Página do Facebook
 * @param {object} params
 * @param {string} params.pageId
 * @param {string} params.pageAccessToken
 * @param {string} params.texto
 * @param {string} [params.linkComentario]
 * @returns {Promise<object>}
 */
async function publicarTextoNaPagina({ pageId, pageAccessToken, texto, linkComentario }) {
  const idLimpo = String(pageId).trim();
  const tokenLimpo = String(pageAccessToken).trim();
  const textoLimpo = (texto || '').trim();

  if (!textoLimpo) {
    throw new Error('O texto do post não pode estar vazio.');
  }

  const res = await fetch(`${META_GRAPH_URL}/${idLimpo}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: tokenLimpo,
      message: textoLimpo
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatarErroFacebook(data, res.status));
  }

  const postId = data.id;
  let commentId = null;

  if (linkComentario && linkComentario.trim()) {
    try {
      const resComentario = await fetch(`${META_GRAPH_URL}/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: tokenLimpo,
          message: linkComentario.trim()
        })
      });

      const dataComentario = await resComentario.json().catch(() => ({}));
      if (resComentario.ok && dataComentario.id) {
        commentId = dataComentario.id;
      }
    } catch (errComentario) {
      console.warn('[FacebookService] Erro ao postar 1º comentário:', errComentario.message);
    }
  }

  return {
    sucesso: true,
    postId,
    commentId,
    postUrl: `https://facebook.com/${postId}`
  };
}

module.exports = {
  verificarConexaoPagina,
  publicarFotoNaPagina,
  publicarTextoNaPagina
};
