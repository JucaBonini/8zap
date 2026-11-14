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
 * Retorna o caminho do arquivo unificado de destinos salvos do projeto
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoDestinosSalvos(projectId) {
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `destinos-${idSanitizado}.json`);
}

/**
 * Lê os destinos salvos/descobertos do projeto
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterDestinosSalvos(projectId) {
  const caminho = obterCaminhoDestinosSalvos(projectId);
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
 * Salva a lista de destinos do projeto no disco
 * @param {string} projectId
 * @param {Array<object>} destinos
 */
function salvarDestinosSalvos(projectId, destinos) {
  const caminho = obterCaminhoDestinosSalvos(projectId);
  try {
    fs.writeFileSync(caminho, JSON.stringify(destinos, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Registra um canal descoberto automaticamente em tempo de execução
 * @param {string} projectId
 * @param {object} canal - { jid, nome, tipo, dono, admin }
 */
function registrarCanalDescoberto(projectId, canal) {
  if (!canal || !canal.jid) return;
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  const salvos = obterDestinosSalvos(idSanitizado);
  const jidTrim = canal.jid.trim();

  const idx = salvos.findIndex(d => d.jid === jidTrim);
  const itemAtualizado = {
    jid: jidTrim,
    nome: canal.nome || canal.name || jidTrim,
    tipo: 'canal',
    dono: Boolean(canal.dono),
    admin: Boolean(canal.admin || canal.dono),
    manual: canal.manual !== undefined ? canal.manual : false,
    descobertoEm: new Date().toISOString()
  };

  if (idx >= 0) {
    salvos[idx] = { ...salvos[idx], ...itemAtualizado };
  } else {
    salvos.push(itemAtualizado);
  }

  salvarDestinosSalvos(idSanitizado, salvos);
  cacheDestinos.delete(idSanitizado);
}

/**
 * Obtém os destinos manuais cadastrados no arquivo de configuração do projeto
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterDestinosManuais(projectId) {
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  const caminhoConfig = path.join(diretorioData, `config-rss-${idSanitizado}.json`);
  const listaManuais = [];

  // 1. Lê do destinos unificado
  const salvos = obterDestinosSalvos(idSanitizado);
  salvos.forEach(d => {
    if (d.manual) listaManuais.push(d);
  });

  // 2. Lê do config-rss por compatibilidade
  if (fs.existsSync(caminhoConfig)) {
    try {
      const conteudo = fs.readFileSync(caminhoConfig, 'utf8');
      const config = JSON.parse(conteudo);
      if (Array.isArray(config.destinosManuais)) {
        config.destinosManuais.forEach(d => {
          if (!listaManuais.some(item => item.jid === d.jid)) {
            listaManuais.push({ ...d, manual: true });
          }
        });
      }
    } catch (_) {}
  }

  return listaManuais;
}

/**
 * Adiciona um novo destino manual na configuração do projeto
 * @param {string} projectId
 * @param {object} destino - { jid, nome, tipo, dono, admin }
 */
function adicionarDestinoManual(projectId, destino) {
  if (!destino || !destino.jid) {
    throw new Error('O JID do destino é obrigatório.');
  }

  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const jidTrim = destino.jid.trim();
  const isCanal = jidTrim.includes('@newsletter') || destino.tipo === 'canal';
  const tipoFinal = isCanal ? 'canal' : (jidTrim.includes('@g.us') ? 'grupo' : 'contato');

  const novoDestino = {
    jid: jidTrim,
    nome: destino.nome ? destino.nome.trim() : jidTrim,
    tipo: tipoFinal,
    dono: Boolean(destino.dono),
    admin: Boolean(destino.admin || destino.dono),
    manual: true
  };

  // 1. Salva no destinos unificado
  const salvos = obterDestinosSalvos(idSanitizado);
  const idxSalvo = salvos.findIndex(d => d.jid === jidTrim);
  if (idxSalvo >= 0) {
    salvos[idxSalvo] = { ...salvos[idxSalvo], ...novoDestino };
  } else {
    salvos.push(novoDestino);
  }
  salvarDestinosSalvos(idSanitizado, salvos);

  // 2. Salva no config-rss por compatibilidade retroativa
  const caminhoConfig = path.join(diretorioData, `config-rss-${idSanitizado}.json`);
  let config = {};
  if (fs.existsSync(caminhoConfig)) {
    try {
      config = JSON.parse(fs.readFileSync(caminhoConfig, 'utf8'));
    } catch (_) {}
  }
  const manuais = Array.isArray(config.destinosManuais) ? config.destinosManuais : [];
  const indexExistente = manuais.findIndex((d) => d.jid === jidTrim);
  if (indexExistente >= 0) {
    manuais[indexExistente] = novoDestino;
  } else {
    manuais.push(novoDestino);
  }
  config.destinosManuais = manuais;
  try {
    fs.writeFileSync(caminhoConfig, JSON.stringify(config, null, 2), 'utf8');
  } catch (_) {}

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
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  const agora = Date.now();

  // Verifica cache
  const emCache = cacheDestinos.get(idSanitizado);
  if (!forcarAtualizacao && emCache && (agora - emCache.timestamp < TEMPO_CACHE_MS)) {
    return emCache.destinos;
  }

  const destinosEncontrados = new Map();

  // 1. Carrega destinos salvos/descobertos e manuais
  const salvos = obterDestinosSalvos(idSanitizado);
  salvos.forEach((d) => {
    destinosEncontrados.set(d.jid, { ...d });
  });

  const manuais = obterDestinosManuais(idSanitizado);
  manuais.forEach((d) => {
    if (!destinosEncontrados.has(d.jid)) {
      destinosEncontrados.set(d.jid, { ...d, manual: true });
    }
  });

  // 2. Busca grupos e canais via Baileys se a sessão estiver conectada
  const statusSessao = sessionManager.obterStatusSessao(idSanitizado);

  if (statusSessao.status === 'connected') {
    try {
      // 2.1 Busca canais / newsletters primeiro (com prioridade para os canais onde o usuário é dono/admin)
      const canais = await buscarCanaisBaileys(idSanitizado);
      canais.forEach((c) => {
        const existente = destinosEncontrados.get(c.jid);
        destinosEncontrados.set(c.jid, {
          ...existente,
          ...c,
          manual: existente ? existente.manual : false
        });
      });

      // 2.2 Busca grupos do WhatsApp
      const grupos = await buscarGruposBaileys(idSanitizado);
      grupos.forEach((g) => {
        const existente = destinosEncontrados.get(g.jid);
        destinosEncontrados.set(g.jid, {
          ...existente,
          ...g,
          manual: existente ? existente.manual : false
        });
      });
    } catch (err) {
      logProjeto(idSanitizado, 'ERRO_LISTAGEM_DESTINOS', `Erro ao buscar destinos via Baileys: ${err.message}`, 'warn');
    }
  } else {
    logProjeto(idSanitizado, 'INFO', `Sessão não conectada. Exibindo apenas destinos em cache do disco.`, 'info');
  }

  // 3. Ordenação inteligente:
  // - Canais onde o usuário é DONO primeiro
  // - Canais onde o usuário é ADMIN
  // - Outros canais
  // - Grupos
  // - Contatos
  const listaFinal = Array.from(destinosEncontrados.values()).sort((a, b) => {
    const pontuacao = (d) => {
      if (d.tipo === 'canal') {
        if (d.dono) return 100;
        if (d.admin) return 90;
        return 80;
      }
      if (d.tipo === 'grupo') return 50;
      return 10;
    };
    const pDiff = pontuacao(b) - pontuacao(a);
    if (pDiff !== 0) return pDiff;
    return (a.nome || '').localeCompare(b.nome || '');
  });

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
 * Busca canais (newsletters) que o usuário segue ou administra via Baileys MEX / Cache
 * @param {string} projectId
 * @returns {Promise<Array<object>>}
 */
async function buscarCanaisBaileys(projectId) {
  const canaisEncontrados = [];
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    const { obterSocket } = require('./sessionManager');
    const sock = typeof obterSocket === 'function' ? obterSocket(projectId) : null;

    if (sock && typeof sock.query === 'function') {
      // Tenta consultar canais inscritos / administrados via query MEX oficial do WhatsApp
      const queryIds = ['6388546374527196', '6640625342674996', '6312712742135297'];
      for (const qId of queryIds) {
        try {
          const res = await sock.query({
            tag: 'iq',
            attrs: {
              id: typeof sock.generateMessageTag === 'function' ? sock.generateMessageTag() : `${Date.now()}-mex`,
              type: 'get',
              to: 's.whatsapp.net',
              xmlns: 'w:mex'
            },
            content: [
              {
                tag: 'query',
                attrs: { query_id: qId },
                content: Buffer.from(JSON.stringify({ variables: {} }), 'utf-8')
              }
            ]
          });

          // Procura nó 'result'
          const nodes = Array.isArray(res.content) ? res.content : [res.content];
          const resultNode = nodes.find(n => n && n.tag === 'result');
          if (resultNode && resultNode.content) {
            const parsed = JSON.parse(resultNode.content.toString());
            const list = parsed?.data?.xwa2_newsletter_subscribed || parsed?.data?.xwa2_newsletters || parsed?.data;
            if (Array.isArray(list) && list.length > 0) {
              list.forEach(item => {
                if (item && item.id) {
                  const role = item.viewer_metadata?.role || '';
                  const ehDono = role === 'OWNER';
                  const ehAdmin = role === 'ADMIN' || ehDono;
                  const badge = ehDono ? ' (Dono)' : ehAdmin ? ' (Admin)' : '';
                  const nome = (item.thread_metadata?.name?.text || item.name || item.id) + badge;

                  canaisEncontrados.push({
                    jid: item.id,
                    nome,
                    tipo: 'canal',
                    dono: ehDono,
                    admin: ehAdmin,
                    manual: false
                  });

                  // Já persiste como canal descoberto
                  registrarCanalDescoberto(idSanitizado, {
                    jid: item.id,
                    nome,
                    dono: ehDono,
                    admin: ehAdmin
                  });
                }
              });
              break; // Obteve sucesso, interrompe busca por outros query_ids
            }
          }
        } catch (_) {
          // Continua para o próximo query_id
        }
      }
    }

    // 2. Se sock.newsletterFollowedList existir em versões alternativas
    if (sock && typeof sock.newsletterFollowedList === 'function') {
      try {
        const canais = await sock.newsletterFollowedList();
        if (Array.isArray(canais)) {
          canais.forEach((c) => {
            const jid = c.id || c.jid;
            if (!canaisEncontrados.some(exist => exist.jid === jid)) {
              canaisEncontrados.push({
                jid,
                nome: c.name || c.thread_metadata?.name?.text || jid,
                tipo: 'canal',
                dono: c.viewer_metadata?.role === 'OWNER',
                admin: c.viewer_metadata?.role === 'ADMIN' || c.viewer_metadata?.role === 'OWNER',
                manual: false
              });
            }
          });
        }
      } catch (_) {}
    }
  } catch (err) {
    logProjeto(
      projectId,
      'AVISO_CANAIS',
      `Busca automática de canais via socket finalizada (${err.message}).`,
      'info'
    );
  }

  // 3. Mescla com os canais persistidos em disco
  const salvos = obterDestinosSalvos(idSanitizado);
  salvos.forEach(s => {
    if ((s.tipo === 'canal' || (s.jid && s.jid.includes('@newsletter'))) && !canaisEncontrados.some(c => c.jid === s.jid)) {
      canaisEncontrados.push(s);
    }
  });

  return canaisEncontrados;
}

/**
 * Resolve e descobre o JID e nome de um canal ou grupo a partir do link de convite ou JID
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

  // 1. Se já for um JID direto de canal (@newsletter)
  if (textoLimpo.includes('@newsletter')) {
    let nomeCanal = textoLimpo.split('@')[0];
    let ehDono = false;
    let ehAdmin = false;

    if (sock && typeof sock.newsletterMetadata === 'function') {
      try {
        const meta = await sock.newsletterMetadata('jid', textoLimpo);
        if (meta) {
          const role = meta.viewer_metadata?.role || '';
          ehDono = role === 'OWNER';
          ehAdmin = role === 'ADMIN' || ehDono;
          const badge = ehDono ? ' (Dono)' : ehAdmin ? ' (Admin)' : '';
          nomeCanal = (meta.name || meta.thread_metadata?.name?.text || nomeCanal) + badge;
        }
      } catch (_) {}
    }

    return {
      jid: textoLimpo,
      nome: `📢 ${nomeCanal}`,
      tipo: 'canal',
      dono: ehDono,
      admin: ehAdmin
    };
  }

  // 2. Se for link de Canal: whatsapp.com/channel/0029Va...
  const matchCanal = textoLimpo.match(/(?:whatsapp\.com\/channel\/|^0029)([a-zA-Z0-9_-]+)/i);
  if (matchCanal && matchCanal[1]) {
    const codigoConvite = matchCanal[0].startsWith('0029') ? matchCanal[0] : matchCanal[1];
    if (!sock) {
      throw new Error('A sessão do WhatsApp precisa estar conectada para verificar o link do canal.');
    }
    try {
      if (typeof sock.newsletterMetadata === 'function') {
        const metadata = await sock.newsletterMetadata('invite', codigoConvite);
        if (metadata && metadata.id) {
          const role = metadata.viewer_metadata?.role || '';
          const ehDono = role === 'OWNER';
          const ehAdmin = role === 'ADMIN' || ehDono;
          const badge = ehDono ? ' (Dono)' : ehAdmin ? ' (Admin)' : '';
          const nomeFinal = (metadata.name || metadata.thread_metadata?.name?.text || 'Canal WhatsApp') + badge;
          return {
            jid: metadata.id,
            nome: `📢 ${nomeFinal}`,
            tipo: 'canal',
            dono: ehDono,
            admin: ehAdmin
          };
        }
      }
    } catch (err) {
      throw new Error(`Não foi possível obter dados do canal pelo link: ${err.message}`);
    }
  }

  // 3. Se for JID de grupo (@g.us) ou contato (@s.whatsapp.net)
  if (textoLimpo.includes('@g.us') || textoLimpo.includes('@s.whatsapp.net')) {
    return {
      jid: textoLimpo,
      nome: textoLimpo.split('@')[0],
      tipo: textoLimpo.includes('@g.us') ? 'grupo' : 'contato'
    };
  }

  // 4. Se for link de Grupo: chat.whatsapp.com/ABC...
  const matchGrupo = textoLimpo.match(/(?:chat\.whatsapp\.com\/)([a-zA-Z0-9_-]+)/i);
  if (matchGrupo && matchGrupo[1]) {
    const codigoGrupo = matchGrupo[1];
    if (!sock) {
      throw new Error('A sessão do WhatsApp precisa estar conectada para verificar o link do grupo.');
    }
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
    'Formato não reconhecido. Cole o link do canal (https://whatsapp.com/channel/...), o link do grupo (https://chat.whatsapp.com/...) ou o JID (@newsletter / @g.us).'
  );
}

module.exports = {
  obterHistoricoDestinos,
  registrarUsoDestino,
  obterDestinosSalvos,
  salvarDestinosSalvos,
  registrarCanalDescoberto,
  obterDestinosManuais,
  adicionarDestinoManual,
  removerDestinoManual,
  listarDestinosDisponiveis,
  resolverDestinoPorLink
};
