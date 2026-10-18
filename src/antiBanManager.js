const fs = require('fs');
const path = require('path');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

function sanitizarProjeto(projectId) {
  return (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function obterCaminhoConfig(projectId) {
  return path.join(diretorioData, `config-antiban-${sanitizarProjeto(projectId)}.json`);
}

function obterCaminhoBlacklist(projectId) {
  return path.join(diretorioData, `blacklist-${sanitizarProjeto(projectId)}.json`);
}

const CONFIG_PADRAO = {
  ativo: true,
  digitacaoAtiva: true,
  tempoMinDigitacaoMs: 2500,
  tempoMaxDigitacaoMs: 5000,
  jitterAtivo: true,
  jitterPercentual: 30,
  optOutAtivo: true,
  palavrasChaveOptOut: [
    'sair',
    'parar',
    'cancelar',
    'nao quero',
    'não quero',
    'remover',
    'descadastrar',
    'stop'
  ],
  respostaOptOut: 'Prontinho! Seu número foi descadastrado com sucesso e você não receberá mais nossas mensagens. Caso queira voltar no futuro, basta nos mandar um Oi aqui. Tenha um ótimo dia! 🙏',
  responderConfirmacaoOptOut: true
};

/**
 * Retorna as configurações de Anti-Ban do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigAntiBan(projectId) {
  const caminho = obterCaminhoConfig(projectId);
  try {
    if (fs.existsSync(caminho)) {
      const conteudo = fs.readFileSync(caminho, 'utf-8');
      const dados = JSON.parse(conteudo);
      return { ...CONFIG_PADRAO, ...dados };
    }
  } catch (err) {
    logProjeto(sanitizarProjeto(projectId), 'ERRO_CONFIG_ANTIBAN', `Falha ao ler config: ${err.message}`, 'error');
  }
  return { ...CONFIG_PADRAO };
}

/**
 * Salva as configurações de Anti-Ban do projeto
 * @param {string} projectId
 * @param {object} novasConfigs
 * @returns {object}
 */
function salvarConfigAntiBan(projectId, novasConfigs) {
  const atual = obterConfigAntiBan(projectId);
  const atualizado = { ...atual, ...novasConfigs };
  const caminho = obterCaminhoConfig(projectId);
  fs.writeFileSync(caminho, JSON.stringify(atualizado, null, 2), 'utf-8');
  return atualizado;
}

/**
 * Retorna a lista negra (Blacklist) de contatos descadastrados
 * @param {string} projectId
 * @returns {Array<{ jid: string, telefone: string, dataAdicao: string, motivo: string, origem: string }>}
 */
function obterBlacklist(projectId) {
  const caminho = obterCaminhoBlacklist(projectId);
  try {
    if (fs.existsSync(caminho)) {
      const conteudo = fs.readFileSync(caminho, 'utf-8');
      const dados = JSON.parse(conteudo);
      return Array.isArray(dados) ? dados : [];
    }
  } catch (err) {
    logProjeto(sanitizarProjeto(projectId), 'ERRO_BLACKLIST', `Falha ao ler blacklist: ${err.message}`, 'error');
  }
  return [];
}

/**
 * Salva a lista negra (Blacklist)
 * @param {string} projectId
 * @param {Array} lista
 */
function salvarBlacklist(projectId, lista) {
  const caminho = obterCaminhoBlacklist(projectId);
  fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf-8');
}

/**
 * Verifica se um JID ou telefone está na Blacklist
 * @param {string} projectId
 * @param {string} jidOuTelefone
 * @returns {boolean}
 */
function estaNaBlacklist(projectId, jidOuTelefone) {
  if (!jidOuTelefone) return false;
  const config = obterConfigAntiBan(projectId);
  if (!config.ativo || !config.optOutAtivo) return false;

  const alvoLimpo = String(jidOuTelefone).trim().toLowerCase();
  const apenasDigitos = alvoLimpo.replace(/\D/g, '');

  const blacklist = obterBlacklist(projectId);
  return blacklist.some((item) => {
    if (item.jid && item.jid.toLowerCase() === alvoLimpo) return true;
    if (item.telefone && apenasDigitos && item.telefone.replace(/\D/g, '') === apenasDigitos) return true;
    return false;
  });
}

/**
 * Adiciona um contato à Blacklist
 * @param {string} projectId
 * @param {string} jid
 * @param {string} [motivo]
 * @param {string} [origem]
 * @returns {boolean}
 */
function adicionarNaBlacklist(projectId, jid, motivo = 'Opt-out automático', origem = 'mensagem_recebida') {
  if (!jid) return false;
  const idSanitizado = sanitizarProjeto(projectId);
  const jidLimpo = jid.trim();
  const telefone = jidLimpo.replace(/@.*$/, '').replace(/\D/g, '');

  const blacklist = obterBlacklist(projectId);
  const jaExiste = blacklist.some((i) => i.jid === jidLimpo || (telefone && i.telefone === telefone));

  if (jaExiste) {
    return false;
  }

  const novoItem = {
    jid: jidLimpo,
    telefone: telefone || jidLimpo,
    dataAdicao: new Date().toISOString(),
    motivo: motivo || 'Opt-out automático',
    origem: origem || 'manual'
  };

  blacklist.unshift(novoItem);
  salvarBlacklist(projectId, blacklist);

  logProjeto(
    idSanitizado,
    'ANTIBAN_BLACKLIST_ADD',
    `Contato ${novoItem.telefone} adicionado à Blacklist. Motivo: ${novoItem.motivo}`,
    'warn'
  );

  return true;
}

/**
 * Remove um contato da Blacklist
 * @param {string} projectId
 * @param {string} jidOuTelefone
 * @returns {boolean}
 */
function removerDaBlacklist(projectId, jidOuTelefone) {
  if (!jidOuTelefone) return false;
  const idSanitizado = sanitizarProjeto(projectId);
  const alvo = String(jidOuTelefone).trim().toLowerCase();
  const apenasDigitos = alvo.replace(/\D/g, '');

  const blacklist = obterBlacklist(projectId);
  const novaLista = blacklist.filter((item) => {
    if (item.jid && item.jid.toLowerCase() === alvo) return false;
    if (item.telefone && apenasDigitos && item.telefone.replace(/\D/g, '') === apenasDigitos) return false;
    return true;
  });

  if (novaLista.length !== blacklist.length) {
    salvarBlacklist(projectId, novaLista);
    logProjeto(
      idSanitizado,
      'ANTIBAN_BLACKLIST_REM',
      `Contato ${jidOuTelefone} removido da Blacklist.`,
      'info'
    );
    return true;
  }
  return false;
}

/**
 * Calcula o tempo de simulação de digitação baseado no tamanho do texto
 * @param {string} texto
 * @param {string} projectId
 * @returns {number} milissegundos
 */
function calcularTempoDigitacao(texto, projectId) {
  const config = obterConfigAntiBan(projectId);
  const min = Math.max(1000, Number(config.tempoMinDigitacaoMs) || 2500);
  const max = Math.max(min + 1000, Number(config.tempoMaxDigitacaoMs) || 5000);

  // Escala proporcional: textos maiores recebem mais tempo de digitação
  const tamanho = texto ? String(texto).length : 0;
  let tempoProporcional = min + Math.min(2500, Math.floor(tamanho * 12));

  // Adiciona pequena variação aleatória de jitter
  const variacao = Math.floor(Math.random() * 800) - 400;
  const tempoFinal = Math.min(max, Math.max(min, tempoProporcional + variacao));

  return tempoFinal;
}

/**
 * Aplica variação orgânica (Jitter) em um intervalo base em milissegundos
 * @param {number} delayBaseMs
 * @param {string} projectId
 * @returns {number}
 */
function aplicarJitterIntervalo(delayBaseMs, projectId) {
  const config = obterConfigAntiBan(projectId);
  if (!config.ativo || !config.jitterAtivo) {
    return delayBaseMs;
  }

  const percentual = Math.min(60, Math.max(5, Number(config.jitterPercentual) || 30)) / 100;
  const variacaoMax = Math.floor(delayBaseMs * percentual);
  const delta = Math.floor(Math.random() * (variacaoMax * 2 + 1)) - variacaoMax;
  const delayFinal = Math.max(1000, delayBaseMs + delta);

  return delayFinal;
}

/**
 * Simula presença humanizada ("digitando..." ou "gravando áudio...")
 * @param {string} projectId
 * @param {object} sock - Instância Baileys WASocket
 * @param {string} jid - Destinatário
 * @param {string} tipo - 'texto' | 'imagem' | 'video' | 'audio'
 * @param {string} [textoParaCalcular]
 */
async function simularPresencaHumanizada(projectId, sock, jid, tipo, textoParaCalcular = '') {
  try {
    if (!sock || !jid) return;

    // Regra Crítica: Canais (@newsletter) não possuem status de digitação!
    if (jid.endsWith('@newsletter')) {
      return;
    }

    const config = obterConfigAntiBan(projectId);
    if (!config.ativo || !config.digitacaoAtiva) {
      return;
    }

    const presenca = tipo === 'audio' ? 'recording' : 'composing';
    const tempoMs = tipo === 'audio' ? 3500 : calcularTempoDigitacao(textoParaCalcular, projectId);

    // Envia sinal de presença (digitando/gravando)
    await sock.sendPresenceUpdate(presenca, jid);

    // Aguarda o tempo humanizado
    await new Promise((resolve) => setTimeout(resolve, tempoMs));

    // Pausa a presença
    await sock.sendPresenceUpdate('paused', jid);
  } catch (errPresenca) {
    // Fail-safe: Nunca falha o envio por causa de presença
    logProjeto(
      sanitizarProjeto(projectId),
      'ANTIBAN_PRESENCA_AVISO',
      `Não foi possível atualizar presença para ${jid}: ${errPresenca.message}`,
      'info'
    );
  }
}

/**
 * Verifica se o texto recebido de um contato corresponde a uma palavra-chave de Opt-out
 * @param {string} texto
 * @param {object} config
 * @returns {string|null} Palavra-chave detectada ou null
 */
function verificarPalavraOptOut(texto, config) {
  if (!texto || typeof texto !== 'string') return null;

  const textoLimpo = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const palavrasChave = config.palavrasChaveOptOut || CONFIG_PADRAO.palavrasChaveOptOut;

  for (const item of palavrasChave) {
    const itemLimpo = item
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    // 1. Mensagem exata igual à palavra (ex: "sair", "parar")
    if (textoLimpo === itemLimpo) {
      return item;
    }

    // 2. Mensagem que começa ou contém a expressão como palavra isolada
    const regex = new RegExp(`(^|\\b|\\s)${itemLimpo}(\\b|\\s|[!.,?]|$)(.*)`, 'i');
    if (regex.test(textoLimpo)) {
      return item;
    }
  }

  return null;
}

/**
 * Processa mensagens recebidas pelo WhatsApp para detectar pedidos de Opt-out
 * @param {string} projectId
 * @param {object} sock - Instância Baileys WASocket
 * @param {object} upsert - Evento Baileys 'messages.upsert'
 */
async function processarMensagensRecebidas(projectId, sock, upsert) {
  try {
    if (!upsert || !Array.isArray(upsert.messages)) return;

    const config = obterConfigAntiBan(projectId);
    if (!config.ativo || !config.optOutAtivo) return;

    const idSanitizado = sanitizarProjeto(projectId);

    for (const msg of upsert.messages) {
      // Ignora mensagens enviadas por nós mesmos
      if (msg.key && msg.key.fromMe) continue;

      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) continue;

      // Regra de Segurança Anti-Ban:
      // O Opt-out automático se aplica APENAS a conversas privadas (@s.whatsapp.net).
      // NUNCA descadastra em grupos (@g.us), canais (@newsletter) ou status broadcast.
      if (!remoteJid.endsWith('@s.whatsapp.net')) {
        continue;
      }

      // Extrai o conteúdo em texto da mensagem recebida
      const conteudoMensagem = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ''
      ).trim();

      if (!conteudoMensagem) continue;

      const palavraDetectada = verificarPalavraOptOut(conteudoMensagem, config);

      if (palavraDetectada) {
        logProjeto(
          idSanitizado,
          'ANTIBAN_OPTOUT_RECEBIDO',
          `Pedido de descadastro recebido de ${remoteJid} com a palavra "${palavraDetectada}".`,
          'warn'
        );

        // Adiciona à Blacklist
        const adicionou = adicionarNaBlacklist(
          idSanitizado,
          remoteJid,
          `Opt-out automático (palavra: "${palavraDetectada}")`,
          'mensagem_recebida'
        );

        // Se configurado, envia mensagem amigável confirmando a remoção
        if (config.responderConfirmacaoOptOut && sock && config.respostaOptOut) {
          try {
            await sock.sendMessage(remoteJid, {
              text: config.respostaOptOut
            });
            logProjeto(
              idSanitizado,
              'ANTIBAN_CONFIRMACAO_ENVIADA',
              `Confirmação de descadastro enviada para ${remoteJid}.`,
              'info'
            );
          } catch (errResp) {
            logProjeto(
              idSanitizado,
              'ANTIBAN_ERRO_RESPOSTA',
              `Não foi possível responder a confirmação de descadastro para ${remoteJid}: ${errResp.message}`,
              'error'
            );
          }
        }
      }
    }
  } catch (errProcessamento) {
    // Fail-safe global: Não interrompe o fluxo de mensagens do Baileys
    logProjeto(
      sanitizarProjeto(projectId),
      'ANTIBAN_ERRO_PROCESSAMENTO',
      `Erro no processador de mensagens Anti-Ban: ${errProcessamento.message}`,
      'error'
    );
  }
}

module.exports = {
  obterConfigAntiBan,
  salvarConfigAntiBan,
  obterBlacklist,
  salvarBlacklist,
  estaNaBlacklist,
  adicionarNaBlacklist,
  removerDaBlacklist,
  calcularTempoDigitacao,
  aplicarJitterIntervalo,
  simularPresencaHumanizada,
  processarMensagensRecebidas
};
