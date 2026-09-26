const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { logProjeto } = require('./logger');

// Diretório base onde as credenciais das sessões são salvas
const diretorioSessoes = path.join(__dirname, '..', 'sessions');

// Garante que o diretório de sessões exista
if (!fs.existsSync(diretorioSessoes)) {
  fs.mkdirSync(diretorioSessoes, { recursive: true });
}

// Logger silencioso do Pino para evitar ruídos do Baileys no console
const loggerSilencioso = pino({ level: 'silent' });

/**
 * Estrutura do mapa de sessões em memória
 * {
 *   [projectId]: {
 *     sock: WASocket | null,
 *     status: 'conectando' | 'aguardando_qr' | 'connected' | 'desconectado' | 'reconectando',
 *     qrCodeBase64: string | null,
 *     rawQr: string | null,
 *     usuarioConectado: string | null,
 *     ultimaAtualizacao: string,
 *     tentativasReconexao: number,
 *     filaEnvio: Array<Function>,
 *     processandoFila: boolean,
 *     timerReconexao: NodeJS.Timeout | null,
 *     mensagensCache: Map<string, any>
 *   }
 * }
 */
const sessoes = new Map();

/**
 * Retorna o atraso de rate limiting configurado em milissegundos
 */
function obterDelayEnvio() {
  const delay = parseInt(process.env.DELAY_ENTRE_ENVIOS_MS, 10);
  return !isNaN(delay) && delay >= 1000 ? delay : 1500;
}

/**
 * Limpa e formata o destinatário para o formato de JID do WhatsApp
 * @param {string} to - Número de telefone ou ID de canal/grupo
 * @returns {string} - JID formatado
 */
function formatarJid(to) {
  if (!to || typeof to !== 'string') {
    throw new Error('Destinatário ("to") inválido ou não informado');
  }

  const destinatarioLimpo = to.trim();

  // Se já tiver sufixo oficial do WhatsApp (@s.whatsapp.net, @g.us, @newsletter, @broadcast)
  if (destinatarioLimpo.includes('@')) {
    return destinatarioLimpo;
  }

  // Remove caracteres especiais mantendo apenas números
  const apenasNumeros = destinatarioLimpo.replace(/\D/g, '');
  if (!apenasNumeros) {
    throw new Error('Número de telefone inválido após remoção de caracteres');
  }

  return `${apenasNumeros}@s.whatsapp.net`;
}

/**
 * Processa a fila de envios de uma sessão de forma serializada (Rate Limiting)
 * @param {string} projectId
 */
async function processarFilaSessao(projectId) {
  const sessao = sessoes.get(projectId);
  if (!sessao || sessao.processandoFila) {
    return;
  }

  sessao.processandoFila = true;

  while (sessao.filaEnvio.length > 0) {
    const tarefa = sessao.filaEnvio.shift();
    try {
      await tarefa();
    } catch (err) {
      logProjeto(projectId, 'ERRO_FILA_ENVIO', `Erro ao processar item da fila: ${err.message}`, 'error');
    }

    // Aplica o intervalo mínimo entre envios para evitar banimento / flood
    const delay = obterDelayEnvio();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  sessao.processandoFila = false;
}

/**
 * Enfileira uma ação de envio de mensagem garantindo execução sequencial
 * @param {string} projectId
 * @param {Function} acaoEnvio
 * @returns {Promise<any>}
 */
function enfileirarEnvio(projectId, acaoEnvio) {
  return new Promise((resolve, reject) => {
    let sessao = sessoes.get(projectId);
    if (!sessao) {
      return reject(new Error(`Sessão do projeto "${projectId}" não foi encontrada`));
    }

    sessao.filaEnvio.push(async () => {
      try {
        const resultado = await acaoEnvio();
        resolve(resultado);
      } catch (err) {
        reject(err);
      }
    });

    processarFilaSessao(projectId);
  });
}

/**
 * Inicia ou retoma uma sessão do WhatsApp com Baileys
 * @param {string} projectId - Identificador único do projeto
 * @param {boolean} forcarReinicio - Se true, encerra socket anterior antes de criar novo
 * @returns {Promise<object>} - Estado atual da sessão
 */
async function iniciarSessao(projectId, forcarReinicio = false) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('O projectId é obrigatório e deve ser uma string');
  }

  // Sanitiza o projectId para evitar nomes de pasta inválidos
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');

  let sessao = sessoes.get(idSanitizado);

  // Prevenção de Socket Duplicado:
  // Se a sessão já estiver ativa, conectando ou aguardando QR (e não for forçado um restart), retorna o status atual
  if (sessao && sessao.sock && !forcarReinicio) {
    if (sessao.status === 'connected' || sessao.status === 'conectando' || sessao.status === 'aguardando_qr') {
      logProjeto(idSanitizado, 'INFO', `Sessão já em andamento com status "${sessao.status}". Evitando socket duplicado.`, 'info');
      return obterStatusSessao(idSanitizado);
    }
  }

  // Se houver um socket anterior pendente ou timer de reconexão ativo, limpa antes de criar novo
  if (sessao) {
    if (sessao.timerReconexao) {
      clearTimeout(sessao.timerReconexao);
      sessao.timerReconexao = null;
    }
    if (sessao.sock) {
      try {
        sessao.sock.ev.removeAllListeners();
        sessao.sock.end(undefined);
      } catch (_) {}
      sessao.sock = null;
    }
    if (!sessao.mensagensCache) {
      sessao.mensagensCache = new Map();
    }
  } else {
    sessao = {
      sock: null,
      status: 'conectando',
      qrCodeBase64: null,
      rawQr: null,
      usuarioConectado: null,
      ultimaAtualizacao: new Date().toISOString(),
      tentativasReconexao: 0,
      filaEnvio: [],
      processandoFila: false,
      timerReconexao: null,
      mensagensCache: new Map()
    };
    sessoes.set(idSanitizado, sessao);
  }

  logProjeto(idSanitizado, 'CONEXAO', 'Iniciando autenticação e socket do Baileys...', 'info');

  const pastaAuth = path.join(diretorioSessoes, idSanitizado);
  if (!fs.existsSync(pastaAuth)) {
    fs.mkdirSync(pastaAuth, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    logProjeto(idSanitizado, 'VERSAO_BAILEYS', `Utilizando versão ${version.join('.')} (Mais recente: ${isLatest})`, 'info');

    const sock = makeWASocket({
      version,
      logger: loggerSilencioso,
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.windows('Desktop'),
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      getMessage: async (key) => {
        if (sessao.mensagensCache && key && key.id) {
          return sessao.mensagensCache.get(key.id) || undefined;
        }
        return undefined;
      }
    });

    sessao.sock = sock;

    // Salva credenciais atualizadas
    sock.ev.on('creds.update', saveCreds);

    // Manipulação de eventos de conexão
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessao.rawQr = qr;
        sessao.status = 'aguardando_qr';
        sessao.ultimaAtualizacao = new Date().toISOString();

        try {
          sessao.qrCodeBase64 = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 6
          });
          logProjeto(idSanitizado, 'QR_CODE', 'Novo QR Code gerado. Aguardando leitura no aplicativo.', 'info');
        } catch (qrErr) {
          logProjeto(idSanitizado, 'ERRO_QR', `Falha ao converter QR Code para Base64: ${qrErr.message}`, 'error');
        }
      }

      if (connection === 'open') {
        sessao.status = 'connected';
        sessao.qrCodeBase64 = null;
        sessao.rawQr = null;
        sessao.tentativasReconexao = 0;
        sessao.usuarioConectado = sock.user ? sock.user.id : 'Conectado';
        sessao.ultimaAtualizacao = new Date().toISOString();

        logProjeto(
          idSanitizado,
          'CONECTADO',
          `Sessão conectada com sucesso! Usuário: ${sessao.usuarioConectado}`,
          'success'
        );
      }

      if (connection === 'close') {
        const codigoStatus = lastDisconnect?.error?.output?.statusCode;
        const motivoErro = lastDisconnect?.error?.message || 'Motivo desconhecido';
        const deslogado = codigoStatus === DisconnectReason.loggedOut || codigoStatus === 401;

        logProjeto(
          idSanitizado,
          'DESCONECTADO',
          `Conexão fechada. Código: ${codigoStatus || 'N/A'}. Motivo: ${motivoErro}`,
          deslogado ? 'warn' : 'info'
        );

        sessao.sock = null;
        sessao.qrCodeBase64 = null;
        sessao.rawQr = null;

        if (deslogado) {
          sessao.status = 'desconectado';
          sessao.usuarioConectado = null;
          sessao.ultimaAtualizacao = new Date().toISOString();
          logProjeto(idSanitizado, 'LOGOUT', 'Sessão deslogada pelo WhatsApp. Removendo credenciais locais...', 'warn');

          // Limpa credenciais locais quando o logout é solicitado
          try {
            if (fs.existsSync(pastaAuth)) {
              fs.rmSync(pastaAuth, { recursive: true, force: true });
            }
          } catch (cleanErr) {
            logProjeto(idSanitizado, 'ERRO_LIMPEZA', `Erro ao remover credenciais: ${cleanErr.message}`, 'error');
          }
        } else {
          sessao.status = 'reconectando';
          sessao.tentativasReconexao += 1;
          sessao.ultimaAtualizacao = new Date().toISOString();

          // Backoff exponencial real com teto máximo de 60s
          const delayReconexao = Math.min(
            2000 * Math.pow(1.5, sessao.tentativasReconexao),
            60000
          );

          logProjeto(
            idSanitizado,
            'RECONEXAO',
            `Tentativa de reconexão #${sessao.tentativasReconexao} agendada para daqui a ${(delayReconexao / 1000).toFixed(1)}s (Backoff Exponencial)...`,
            'warn'
          );

          if (sessao.timerReconexao) {
            clearTimeout(sessao.timerReconexao);
          }

          sessao.timerReconexao = setTimeout(() => {
            const atual = sessoes.get(idSanitizado);
            if (atual && (atual.status === 'reconectando' || atual.status === 'desconectado')) {
              iniciarSessao(idSanitizado, true).catch((e) => {
                logProjeto(idSanitizado, 'ERRO_RECONEXAO', `Falha ao tentar reconectar: ${e.message}`, 'error');
              });
            }
          }, delayReconexao);
        }
      }
    });

    return obterStatusSessao(idSanitizado);
  } catch (erro) {
    sessao.status = 'desconectado';
    sessao.ultimaAtualizacao = new Date().toISOString();
    logProjeto(idSanitizado, 'ERRO_INICIALIZACAO', `Erro ao iniciar sessão: ${erro.message}`, 'error');
    throw erro;
  }
}

/**
 * Obtém o status completo de uma sessão específica
 * @param {string} projectId
 * @returns {object}
 */
function obterStatusSessao(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessao = sessoes.get(idSanitizado);
  const pastaExiste = fs.existsSync(path.join(diretorioSessoes, idSanitizado));

  if (!sessao) {
    return {
      projectId: idSanitizado,
      status: pastaExiste ? 'desconectado' : 'nao_iniciado',
      temCredenciaisSalvas: pastaExiste,
      usuarioConectado: null,
      ultimaAtualizacao: null
    };
  }

  return {
    projectId: idSanitizado,
    status: sessao.status,
    temCredenciaisSalvas: pastaExiste,
    usuarioConectado: sessao.usuarioConectado,
    ultimaAtualizacao: sessao.ultimaAtualizacao,
    itensNaFilaEnvio: sessao.filaEnvio.length
  };
}

/**
 * Retorna o QR Code em base64 e status da sessão
 * @param {string} projectId
 * @returns {object} { qr: string|null, status: string }
 */
function obterQrCode(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessao = sessoes.get(idSanitizado);

  if (!sessao) {
    return {
      projectId: idSanitizado,
      status: 'nao_iniciado',
      qr: null
    };
  }

  if (sessao.status === 'connected') {
    return {
      projectId: idSanitizado,
      status: 'connected',
      qr: null
    };
  }

  return {
    projectId: idSanitizado,
    status: sessao.status,
    qr: sessao.qrCodeBase64
  };
}

/**
 * Lista todas as sessões conhecidas (em memória e no disco)
 * @returns {object[]}
 */
function listarSessoes() {
  const projetos = new Set();

  // 1. Coleta projetos com pastas salvas em disco
  if (fs.existsSync(diretorioSessoes)) {
    const pastas = fs.readdirSync(diretorioSessoes, { withFileTypes: true });
    pastas.forEach((item) => {
      if (item.isDirectory()) {
        projetos.add(item.name);
      }
    });
  }

  // 2. Coleta projetos em memória
  for (const id of sessoes.keys()) {
    projetos.add(id);
  }

  // 3. Monta o status de cada um
  const resultado = [];
  for (const id of projetos) {
    resultado.push(obterStatusSessao(id));
  }

  return resultado;
}

/**
 * Envia uma mensagem pelo WhatsApp através de uma sessão conectada
 * @param {string} projectId - Identificador do projeto
 * @param {object} dadosMensagem - { to, type, texto, url, legenda }
 * @returns {Promise<object>}
 */
async function enviarMensagem(projectId, dadosMensagem) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessao = sessoes.get(idSanitizado);

  if (!sessao || sessao.status !== 'connected' || !sessao.sock) {
    throw new Error(
      `Sessão "${idSanitizado}" não está conectada ao WhatsApp (Status atual: ${sessao ? sessao.status : 'não iniciada'})`
    );
  }

  const { to, type = 'texto', texto, url, legenda } = dadosMensagem;
  const jid = formatarJid(to);

  return enfileirarEnvio(idSanitizado, async () => {
    let payload = null;
    const tipoNormalizado = (type || 'texto').toLowerCase();

    if (tipoNormalizado === 'texto') {
      if (!texto || typeof texto !== 'string' || !texto.trim()) {
        throw new Error('O campo "texto" é obrigatório para mensagens do tipo texto');
      }
      payload = { text: texto };
    } else if (tipoNormalizado === 'imagem') {
      if (!url) {
        throw new Error('O campo "url" é obrigatório para mensagens do tipo imagem');
      }
      payload = {
        image: { url: url },
        caption: legenda || texto || ''
      };
    } else if (tipoNormalizado === 'video') {
      if (!url) {
        throw new Error('O campo "url" é obrigatório para mensagens do tipo video');
      }
      payload = {
        video: { url: url },
        caption: legenda || texto || ''
      };
    } else {
      throw new Error(`Tipo de mensagem não suportado: "${type}". Use "texto", "imagem" ou "video".`);
    }

    // Para grupos (@g.us), sincroniza a metadata e SenderKeys para garantir entrega aos participantes
    if (jid.endsWith('@g.us')) {
      try {
        await sessao.sock.groupMetadata(jid);
      } catch (metaErr) {
        logProjeto(idSanitizado, 'AVISO_GRUPO_META', `Não foi possível atualizar metadata do grupo antes do envio: ${metaErr.message}`, 'info');
      }
    }

    logProjeto(
      idSanitizado,
      'ENVIO_MENSAGEM',
      `Enviando [${tipoNormalizado}] para ${jid}...`,
      'info'
    );

    const resultado = await sessao.sock.sendMessage(jid, payload);

    // Salva mensagem no cache para responder a solicitações de retry de decodificação
    if (resultado && resultado.key && resultado.key.id) {
      if (!sessao.mensagensCache) sessao.mensagensCache = new Map();
      sessao.mensagensCache.set(resultado.key.id, resultado.message);
    }

    logProjeto(
      idSanitizado,
      'ENVIO_SUCESSO',
      `Mensagem enviada com sucesso para ${jid} (ID: ${resultado?.key?.id || 'N/A'})`,
      'success'
    );

    return {
      sucesso: true,
      mensagemId: resultado?.key?.id,
      destinatario: jid,
      tipo: tipoNormalizado,
      enviadoEm: new Date().toISOString()
    };
  });
}

/**
 * Encerra ou desloga uma sessão
 * @param {string} projectId
 * @param {boolean} apagarCredenciais - Se true, remove as credenciais do disco
 */
async function encerrarSessao(projectId, apagarCredenciais = false) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessao = sessoes.get(idSanitizado);

  if (sessao) {
    if (sessao.timerReconexao) {
      clearTimeout(sessao.timerReconexao);
      sessao.timerReconexao = null;
    }

    if (sessao.sock) {
      try {
        sessao.sock.ev.removeAllListeners();
        sessao.sock.end(undefined);
      } catch (e) {
        // Ignora erro ao fechar socket
      }
    }

    sessao.sock = null;
    sessao.status = 'desconectado';
    sessao.qrCodeBase64 = null;
    sessao.rawQr = null;
    sessao.usuarioConectado = null;
    sessao.ultimaAtualizacao = new Date().toISOString();
  }

  if (apagarCredenciais) {
    const pastaAuth = path.join(diretorioSessoes, idSanitizado);
    if (fs.existsSync(pastaAuth)) {
      try {
        fs.rmSync(pastaAuth, { recursive: true, force: true });
        logProjeto(idSanitizado, 'SESSAO_REMOVIDA', 'Credenciais da sessão excluídas.', 'info');
      } catch (err) {
        logProjeto(idSanitizado, 'ERRO_EXCLUSAO', `Erro ao remover credenciais: ${err.message}`, 'error');
      }
    }
    sessoes.delete(idSanitizado);
  }

  return { sucesso: true, projectId: idSanitizado, status: 'desconectado' };
}

/**
 * Encerra todas as sessões ativas (usado no Graceful Shutdown)
 */
async function encerrarTodasSessoes() {
  console.log('[SessionManager] Encerrando todas as sessões ativas com segurança...');
  for (const [projectId] of sessoes.entries()) {
    try {
      await encerrarSessao(projectId, false);
    } catch (_) {}
  }
}

/**
 * Restaura automaticamente todas as sessões que já possuem credenciais salvas em disco
 */
async function restaurarSessoesSalvas() {
  if (!fs.existsSync(diretorioSessoes)) {
    return;
  }

  try {
    const itens = fs.readdirSync(diretorioSessoes, { withFileTypes: true });
    const pastasProjetos = itens.filter((i) => i.isDirectory()).map((i) => i.name);

    if (pastasProjetos.length === 0) {
      console.log('[SessionManager] Nenhuma sessão salva previamente para restaurar.');
      return;
    }

    console.log(`[SessionManager] Restaurando ${pastasProjetos.length} sessão(ões) salva(s)...`);

    for (const projectId of pastasProjetos) {
      try {
        await iniciarSessao(projectId);
      } catch (err) {
        console.error(`[SessionManager] Falha ao auto-iniciar sessão ${projectId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[SessionManager] Erro ao restaurar sessões salvas:', err.message);
  }
}

/**
 * Obtém o socket ativo do Baileys para uma sessão específica (se conectada)
 * @param {string} projectId
 * @returns {WASocket|null}
 */
function obterSocket(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessao = sessoes.get(idSanitizado);
  return sessao ? sessao.sock : null;
}

module.exports = {
  iniciarSessao,
  obterStatusSessao,
  obterQrCode,
  listarSessoes,
  enviarMensagem,
  obterSocket,
  encerrarSessao,
  encerrarTodasSessoes,
  restaurarSessoesSalvas
};
