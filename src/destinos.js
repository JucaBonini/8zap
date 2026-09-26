const fs = require('fs');
const path = require('path');
const sessionManager = require('./sessionManager');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Cache em memória dos destinos por projeto
 * Map<string, { timestamp: number, destinos: Array<object> }>
 */
const cacheDestinos = new Map();
const TEMPO_CACHE_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Retorna o caminho do arquivo de histórico de uso dos destinos
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoDestinosUso(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `destinos-uso-${idSanitizado}.json`);
}

/**
 * Lê o histórico de uso dos destinos de um projeto
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterHistoricoDestinos(projectId) {
  const caminho = obterCaminhoDestinosUso(projectId);
  if (!fs.existsSync(caminho)) {
    return [];
  }
  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(projectId, 'ERRO_HISTORICO_DESTINOS', `Falha ao ler histórico de destinos: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Salva o histórico de uso de destinos
 * @param {string} projectId
 * @param {Array<object>} historico
 */
function salvarHistoricoDestinos(projectId, historico) {
  const caminho = obterCaminhoDestinosUso(projectId);
  fs.writeFileSync(caminho, JSON.stringify(historico, null, 2), 'utf8');
}

/**
 * Registra o disparo de um post para um destino específico
 * @param {string} projectId
 * @param {object} dadosUso - { jid, nome, tipo, artigoId, tituloArtigo }
 */
function registrarUsoDestino(projectId, dadosUso) {
  const historico = obterHistoricoDestinos(projectId);
  const novoRegistro = {
    jid: dadosUso.jid,
    nome: dadosUso.nome || dadosUso.jid,
    tipo: dadosUso.tipo || 'destino',
    artigoId: dadosUso.artigoId || null,
    tituloArtigo: dadosUso.tituloArtigo || null,
    usado_em: new Date().toISOString()
  };

  historico.push(novoRegistro);
  // Mantém os últimos 500 registros
  const historicoPodado = historico.slice(-500);
  salvarHistoricoDestinos(projectId, historicoPodado);

  logProjeto(
    projectId,
    'DESTINO_UTILIZADO',
    `Post enviado para destino "${novoRegistro.nome}" (${novoRegistro.jid}).`,
    'info'
  );
}

/**
 * Obtém os destinos manuais cadastrados no arquivo de configuração do projeto
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterDestinosManuais(projectId) {
  const caminhoConfig = path.join(diretorioData, `config-rss-${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  if (!fs.existsSync(caminhoConfig)) {
    return [];
  }
  try {
    const conteudo = fs.readFileSync(caminhoConfig, 'utf8');
    const config = JSON.parse(conteudo);
    return Array.isArray(config.destinosManuais) ? config.destinosManuais : [];
  } catch (_) {
    return [];
  }
}

/**
 * Adiciona um novo destino manual na configuração do projeto
 * @param {string} projectId
 * @param {object} destino - { jid, nome, tipo }
 */
function adicionarDestinoManual(projectId, destino) {
  if (!destino || !destino.jid) {
    throw new Error('O JID do destino é obrigatório.');
  }

  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const caminhoConfig = path.join(diretorioData, `config-rss-${idSanitizado}.json`);
  
  let config = {};
  if (fs.existsSync(caminhoConfig)) {
    try {
      config = JSON.parse(fs.readFileSync(caminhoConfig, 'utf8'));
    } catch (_) {}
  }

  const manuais = Array.isArray(config.destinosManuais) ? config.destinosManuais : [];
  const indexExistente = manuais.findIndex((d) => d.jid === destino.jid.trim());

  const novoDestino = {
    jid: destino.jid.trim(),
    nome: destino.nome ? destino.nome.trim() : destino.jid.trim(),
    tipo: destino.tipo || (destino.jid.includes('@newsletter') ? 'canal' : destino.jid.includes('@g.us') ? 'grupo' : 'contato')
  };

  if (indexExistente >= 0) {
    manuais[indexExistente] = novoDestino;
  } else {
    manuais.push(novoDestino);
  }

  config.destinosManuais = manuais;
  fs.writeFileSync(caminhoConfig, JSON.stringify(config, null, 2), 'utf8');

  // Invalida cache de destinos para refletir imediatamente
  cacheDestinos.delete(idSanitizado);

  return novoDestino;
}

/**
 * Remove um destino manual da configuração
 * @param {string} projectId
 * @param {string} jid
 */
function removerDestinoManual(projectId, jid) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const caminhoConfig = path.join(diretorioData, `config-rss-${idSanitizado}.json`);
  if (!fs.existsSync(caminhoConfig)) return;

  try {
    const config = JSON.parse(fs.readFileSync(caminhoConfig, 'utf8'));
    if (Array.isArray(config.destinosManuais)) {
      config.destinosManuais = config.destinosManuais.filter((d) => d.jid !== jid);
      fs.writeFileSync(caminhoConfig, JSON.stringify(config, null, 2), 'utf8');
      cacheDestinos.delete(idSanitizado);
    }
  } catch (_) {}
}

/**
 * Lista todos os grupos e canais disponíveis para envio
 * @param {string} projectId
 * @param {boolean} forcarAtualizacao - Se true, ignora o cache em memória
 * @returns {Promise<Array<object>>}
 */
async function listarDestinosDisponiveis(projectId, forcarAtualizacao = false) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const agora = Date.now();

  // Verifica cache
  const emCache = cacheDestinos.get(idSanitizado);
  if (!forcarAtualizacao && emCache && (agora - emCache.timestamp < TEMPO_CACHE_MS)) {
    return emCache.destinos;
  }

  const destinosEncontrados = new Map();

  // 1. Carrega destinos manuais salvos
  const manuais = obterDestinosManuais(idSanitizado);
  manuais.forEach((d) => {
    destinosEncontrados.set(d.jid, { ...d, manual: true });
  });

  // 2. Busca grupos e canais via Baileys se a sessão estiver conectada
  const statusSessao = sessionManager.obterStatusSessao(idSanitizado);

  if (statusSessao.status === 'connected') {
    try {
      const grupos = await buscarGruposBaileys(idSanitizado);
      grupos.forEach((g) => {
        destinosEncontrados.set(g.jid, g);
      });

      // Tenta buscar canais/newsletters se o método existir na versão
      const canais = await buscarCanaisBaileys(idSanitizado);
      canais.forEach((c) => {
        destinosEncontrados.set(c.jid, c);
      });
    } catch (err) {
      logProjeto(idSanitizado, 'ERRO_LISTAGEM_DESTINOS', `Erro ao buscar destinos via Baileys: ${err.message}`, 'warn');
    }
  } else {
    logProjeto(idSanitizado, 'INFO', `Sessão não conectada. Exibindo apenas destinos manuais em cache.`, 'info');
  }

  const listaFinal = Array.from(destinosEncontrados.values());
  cacheDestinos.set(idSanitizado, {
    timestamp: agora,
    destinos: listaFinal
  });

  return listaFinal;
}

/**
 * Busca grupos participantes via socket Baileys
 * @param {string} projectId
 * @returns {Promise<Array<object>>}
 */
async function buscarGruposBaileys(projectId) {
  try {
    const { obterSocket } = require('./sessionManager');
    if (typeof obterSocket === 'function') {
      const sock = obterSocket(projectId);
      if (sock && sock.groupFetchAllParticipating) {
        const gruposObj = await sock.groupFetchAllParticipating();
        const lista = [];
        for (const [jid, info] of Object.entries(gruposObj)) {
          lista.push({
            jid,
            nome: info.subject || jid,
            tipo: 'grupo',
            participantes: Object.keys(info.participants || {}).length,
            manual: false
          });
        }
        return lista;
      }
    }
  } catch (err) {
    logProjeto(projectId, 'ERRO_GRUPOS', `Não foi possível listar grupos automaticamente: ${err.message}`, 'warn');
  }
  return [];
}

/**
 * Busca canais (newsletters) se disponível na versão atual do Baileys
 * @param {string} projectId
 * @returns {Promise<Array<object>>}
 */
async function buscarCanaisBaileys(projectId) {
  try {
    const { obterSocket } = require('./sessionManager');
    if (typeof obterSocket === 'function') {
      const sock = obterSocket(projectId);
      // Tenta métodos de canal conhecidos
      if (sock && typeof sock.newsletterFollowedList === 'function') {
        const canais = await sock.newsletterFollowedList();
        if (Array.isArray(canais)) {
          return canais.map((c) => ({
            jid: c.id || c.jid,
            nome: c.name || c.thread_metadata?.name?.text || c.id,
            tipo: 'canal',
            manual: false
          }));
        }
      }
    }
  } catch (err) {
    logProjeto(
      projectId,
      'AVISO_CANAIS',
      `Não foi possível listar canais automaticamente na versão do Baileys (${err.message}). Cadastre canais manualmente.`,
      'info'
    );
  }
  return [];
}

/**
 * Resolve e descobre o JID e nome de um canal ou grupo a partir do link de convite
 * @param {string} projectId
 * @param {string} linkOuCodigo
 * @returns {Promise<object>}
 */
async function resolverDestinoPorLink(projectId, linkOuCodigo) {
  if (!linkOuCodigo || typeof linkOuCodigo !== 'string') {
    throw new Error('Link ou código do canal/grupo não informado.');
  }

  const textoLimpo = linkOuCodigo.trim();
  const { obterSocket } = require('./sessionManager');
  const sock = obterSocket(projectId);

  if (!sock) {
    throw new Error('A sessão do WhatsApp precisa estar conectada para resolver links de canais/grupos.');
  }

  // 1. Se já for um JID direto
  if (textoLimpo.includes('@newsletter') || textoLimpo.includes('@g.us') || textoLimpo.includes('@s.whatsapp.net')) {
    return {
      jid: textoLimpo,
      nome: textoLimpo.split('@')[0],
      tipo: textoLimpo.includes('@newsletter') ? 'canal' : textoLimpo.includes('@g.us') ? 'grupo' : 'contato'
    };
  }

  // 2. Se for link de Canal: whatsapp.com/channel/0029Va...
  const matchCanal = textoLimpo.match(/(?:whatsapp\.com\/channel\/|^0029)([a-zA-Z0-9_-]+)/i);
  if (matchCanal && matchCanal[1]) {
    const codigoConvite = matchCanal[0].startsWith('0029') ? matchCanal[0] : matchCanal[1];
    try {
      if (typeof sock.newsletterMetadata === 'function') {
        const metadata = await sock.newsletterMetadata('invite', codigoConvite);
        if (metadata && metadata.id) {
          return {
            jid: metadata.id,
            nome: metadata.name || metadata.thread_metadata?.name?.text || 'Canal WhatsApp',
            tipo: 'canal'
          };
        }
      }
    } catch (err) {
      throw new Error(`Não foi possível obter dados do canal pelo link: ${err.message}`);
    }
  }

  // 3. Se for link de Grupo: chat.whatsapp.com/ABC...
  const matchGrupo = textoLimpo.match(/(?:chat\.whatsapp\.com\/)([a-zA-Z0-9_-]+)/i);
  if (matchGrupo && matchGrupo[1]) {
    const codigoGrupo = matchGrupo[1];
    try {
      if (typeof sock.groupGetInviteInfo === 'function') {
        const info = await sock.groupGetInviteInfo(codigoGrupo);
        if (info && info.id) {
          return {
            jid: info.id.includes('@g.us') ? info.id : `${info.id}@g.us`,
            nome: info.subject || 'Grupo WhatsApp',
            tipo: 'grupo'
          };
        }
      }
    } catch (err) {
      throw new Error(`Não foi possível obter dados do grupo pelo link de convite: ${err.message}`);
    }
  }

  // Se não reconheceu o padrão de link
  throw new Error(
    'Formato não reconhecido. Cole o link completo do canal (https://whatsapp.com/channel/...) ou grupo (https://chat.whatsapp.com/...) ou o JID direto (@newsletter / @g.us).'
  );
}

module.exports = {
  obterHistoricoDestinos,
  registrarUsoDestino,
  obterDestinosManuais,
  adicionarDestinoManual,
  removerDestinoManual,
  listarDestinosDisponiveis,
  resolverDestinoPorLink
};
