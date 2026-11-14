const fs = require('fs');
const path = require('path');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

function sanitizarProjeto(projectId) {
  return (projectId || 'Universal').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function obterCaminhoGatilhos(projectId) {
  return path.join(diretorioData, `gatilhos-${sanitizarProjeto(projectId)}.json`);
}

function obterCaminhoLeads(projectId) {
  return path.join(diretorioData, `leads-${sanitizarProjeto(projectId)}.json`);
}

function obterCaminhoHistoricoGatilhos(projectId) {
  return path.join(diretorioData, `historico-gatilhos-${sanitizarProjeto(projectId)}.json`);
}

/**
 * Normaliza strings removendo acentos e pontuações excessivas para comparação confiável
 */
function normalizarTexto(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Retorna a lista de gatilhos configurados da instância
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterGatilhos(projectId) {
  const caminho = obterCaminhoGatilhos(projectId);
  if (!fs.existsSync(caminho)) {
    // Template padrão de exemplo para novas instâncias universais
    const gatilhosPadrao = [
      {
        id: 'gat_exemplo_dossie',
        ativo: true,
        nome: 'Entrega do Dossiê / Material Gratuito',
        palavrasChave: ['dossie', 'dossiê', 'quero meu dossie', 'quero meu dossiê', 'dossie cabala', 'material'],
        tipoCorrespondencia: 'contem',
        respostaTexto: 'Olá! Que alegria receber seu contato. Segue em anexo o seu material solicitado com muito carinho! 🙏✨\n\nQualquer dúvida sobre a aplicação prática, é só me chamar por aqui!',
        anexoTipo: 'nenhum',
        anexoUrl: '',
        anexoNomeArquivo: 'Material-Exclusivo.pdf',
        debounceMinutos: 10,
        totalDisparos: 0,
        criadoEm: new Date().toISOString()
      }
    ];
    try {
      fs.writeFileSync(caminho, JSON.stringify(gatilhosPadrao, null, 2), 'utf8');
      return gatilhosPadrao;
    } catch (_) {
      return [];
    }
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(sanitizarProjeto(projectId), 'ERRO_LER_GATILHOS', `Falha ao ler gatilhos: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Salva a lista completa de gatilhos
 * @param {string} projectId
 * @param {Array<object>} lista
 */
function salvarListaGatilhos(projectId, lista) {
  const caminho = obterCaminhoGatilhos(projectId);
  fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf8');
}

/**
 * Salva ou atualiza um gatilho específico
 * @param {string} projectId
 * @param {object} dadosGatilho
 * @returns {object}
 */
function salvarGatilho(projectId, dadosGatilho) {
  const lista = obterGatilhos(projectId);
  const idGatilho = dadosGatilho.id || `gat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let palavrasChave = [];
  if (Array.isArray(dadosGatilho.palavrasChave)) {
    palavrasChave = dadosGatilho.palavrasChave.map(p => String(p).trim()).filter(Boolean);
  } else if (typeof dadosGatilho.palavrasChave === 'string') {
    palavrasChave = dadosGatilho.palavrasChave.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean);
  }

  const gatilhoFormatado = {
    id: idGatilho,
    ativo: dadosGatilho.ativo !== undefined ? Boolean(dadosGatilho.ativo) : true,
    nome: dadosGatilho.nome ? String(dadosGatilho.nome).trim() : 'Novo Gatilho',
    palavrasChave,
    tipoCorrespondencia: ['contem', 'exata', 'comeca_com'].includes(dadosGatilho.tipoCorrespondencia)
      ? dadosGatilho.tipoCorrespondencia
      : 'contem',
    respostaTexto: dadosGatilho.respostaTexto ? String(dadosGatilho.respostaTexto).trim() : '',
    anexoTipo: ['documento', 'imagem', 'video', 'audio', 'nenhum'].includes(dadosGatilho.anexoTipo)
      ? dadosGatilho.anexoTipo
      : 'nenhum',
    anexoUrl: dadosGatilho.anexoUrl ? String(dadosGatilho.anexoUrl).trim() : '',
    anexoNomeArquivo: dadosGatilho.anexoNomeArquivo ? String(dadosGatilho.anexoNomeArquivo).trim() : '',
    debounceMinutos: Math.max(1, parseInt(dadosGatilho.debounceMinutos, 10) || 10),
    totalDisparos: parseInt(dadosGatilho.totalDisparos, 10) || 0,
    criadoEm: dadosGatilho.criadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };

  const index = lista.findIndex(g => g.id === idGatilho);
  if (index >= 0) {
    gatilhoFormatado.totalDisparos = lista[index].totalDisparos || 0;
    lista[index] = gatilhoFormatado;
  } else {
    lista.unshift(gatilhoFormatado);
  }

  salvarListaGatilhos(projectId, lista);
  logProjeto(sanitizarProjeto(projectId), 'GATILHO_SALVO', `Gatilho "${gatilhoFormatado.nome}" salvo com sucesso.`, 'info');
  return gatilhoFormatado;
}

/**
 * Remove um gatilho da lista
 * @param {string} projectId
 * @param {string} gatilhoId
 * @returns {boolean}
 */
function removerGatilho(projectId, gatilhoId) {
  const lista = obterGatilhos(projectId);
  const novaLista = lista.filter(g => g.id !== gatilhoId);
  if (novaLista.length !== lista.length) {
    salvarListaGatilhos(projectId, novaLista);
    logProjeto(sanitizarProjeto(projectId), 'GATILHO_REMOVIDO', `Gatilho ${gatilhoId} removido.`, 'info');
    return true;
  }
  return false;
}

/**
 * Alterna status ativo/inativo de um gatilho
 * @param {string} projectId
 * @param {string} gatilhoId
 * @param {boolean} ativo
 * @returns {object|null}
 */
function alternarGatilho(projectId, gatilhoId, ativo) {
  const lista = obterGatilhos(projectId);
  const gatilho = lista.find(g => g.id === gatilhoId);
  if (gatilho) {
    gatilho.ativo = Boolean(ativo);
    gatilho.atualizadoEm = new Date().toISOString();
    salvarListaGatilhos(projectId, lista);
    return gatilho;
  }
  return null;
}

/**
 * Retorna o histórico de debounces de disparos por contato
 * @param {string} projectId
 * @returns {object} { [jid_gatilhoId]: timestampMs }
 */
function obterHistoricoGatilhos(projectId) {
  const caminho = obterCaminhoHistoricoGatilhos(projectId);
  if (!fs.existsSync(caminho)) return {};
  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    return JSON.parse(conteudo) || {};
  } catch (_) {
    return {};
  }
}

/**
 * Salva o histórico de debounces de disparos
 * @param {string} projectId
 * @param {object} historico
 */
function salvarHistoricoGatilhos(projectId, historico) {
  const caminho = obterCaminhoHistoricoGatilhos(projectId);
  try {
    fs.writeFileSync(caminho, JSON.stringify(historico, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Retorna todos os leads capturados da instância
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterLeads(projectId) {
  const caminho = obterCaminhoLeads(projectId);
  if (!fs.existsSync(caminho)) return [];
  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(sanitizarProjeto(projectId), 'ERRO_LER_LEADS', `Falha ao ler leads: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Salva a lista de leads
 * @param {string} projectId
 * @param {Array<object>} lista
 */
function salvarLeads(projectId, lista) {
  const caminho = obterCaminhoLeads(projectId);
  fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf8');
}

/**
 * Registra ou atualiza um lead que enviou mensagem para a instância
 * @param {string} projectId
 * @param {object} params - { remoteJid, pushName, texto, gatilhoNome }
 * @returns {object} Lead atualizado
 */
function registrarLead(projectId, { remoteJid, pushName = '', texto = '', gatilhoNome = '' }) {
  if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) return null;

  const idSanitizado = sanitizarProjeto(projectId);
  const jidLimpo = remoteJid.trim();
  const telefone = jidLimpo.replace(/@.*$/, '').replace(/\D/g, '');
  const lista = obterLeads(projectId);

  const agora = new Date().toISOString();
  let lead = lista.find(l => l.jid === jidLimpo || l.telefone === telefone);

  if (lead) {
    lead.ultimoContato = agora;
    lead.totalMensagens = (lead.totalMensagens || 1) + 1;
    if (pushName && (!lead.nome || lead.nome === 'Contato WhatsApp')) {
      lead.nome = pushName;
    }
    if (texto) {
      lead.ultimaMensagem = texto.slice(0, 150);
    }
    if (gatilhoNome) {
      lead.ultimoGatilho = gatilhoNome;
      if (!Array.isArray(lead.gatilhosAcionados)) lead.gatilhosAcionados = [];
      if (!lead.gatilhosAcionados.includes(gatilhoNome)) {
        lead.gatilhosAcionados.push(gatilhoNome);
      }
    }
  } else {
    lead = {
      jid: jidLimpo,
      telefone,
      nome: pushName || 'Contato WhatsApp',
      primeiroContato: agora,
      ultimoContato: agora,
      totalMensagens: 1,
      ultimaMensagem: texto ? texto.slice(0, 150) : '',
      ultimoGatilho: gatilhoNome || '',
      gatilhosAcionados: gatilhoNome ? [gatilhoNome] : [],
      origem: 'whatsapp_inbound'
    };
    lista.unshift(lead);
  }

  salvarLeads(projectId, lista);
  return lead;
}

/**
 * Remove um lead
 * @param {string} projectId
 * @param {string} jid
 * @returns {boolean}
 */
function removerLead(projectId, jid) {
  const lista = obterLeads(projectId);
  const novaLista = lista.filter(l => l.jid !== jid && l.telefone !== jid);
  if (novaLista.length !== lista.length) {
    salvarLeads(projectId, novaLista);
    return true;
  }
  return false;
}

/**
 * Limpa todos os leads da instância
 * @param {string} projectId
 */
function limparTodosLeads(projectId) {
  salvarLeads(projectId, []);
}

/**
 * Exporta a base de leads da instância para formato CSV (compatível com Excel / CRM)
 * @param {string} projectId
 * @returns {string} Conteúdo em CSV com BOM UTF-8
 */
function exportarLeadsCsv(projectId) {
  const leads = obterLeads(projectId);
  const cabecalho = ['Telefone', 'Nome', 'Primeiro Contato', 'Último Contato', 'Total Mensagens', 'Última Mensagem', 'Último Gatilho'];

  const linhas = leads.map(l => {
    return [
      `"${l.telefone || ''}"`,
      `"${(l.nome || '').replace(/"/g, '""')}"`,
      `"${l.primeiroContato || ''}"`,
      `"${l.ultimoContato || ''}"`,
      l.totalMensagens || 1,
      `"${(l.ultimaMensagem || '').replace(/"/g, '""')}"`,
      `"${(l.ultimoGatilho || '').replace(/"/g, '""')}"`
    ].join(';');
  });

  // BOM UTF-8 (\uFEFF) para garantir acentuação correta no Excel brasileiro
  return '\uFEFF' + [cabecalho.join(';'), ...linhas].join('\r\n');
}

/**
 * Avalia se o texto recebido dá match com um gatilho
 * @param {string} textoMensagem
 * @param {object} gatilho
 * @returns {boolean}
 */
function verificarCorrespondenciaGatilho(textoMensagem, gatilho) {
  if (!gatilho || !gatilho.ativo || !Array.isArray(gatilho.palavrasChave) || gatilho.palavrasChave.length === 0) {
    return false;
  }

  const textoNorm = normalizarTexto(textoMensagem);
  if (!textoNorm) return false;

  for (const item of gatilho.palavrasChave) {
    const itemNorm = normalizarTexto(item);
    if (!itemNorm) continue;

    if (gatilho.tipoCorrespondencia === 'exata') {
      if (textoNorm === itemNorm) return true;
    } else if (gatilho.tipoCorrespondencia === 'comeca_com') {
      if (textoNorm.startsWith(itemNorm)) return true;
    } else {
      // 'contem' (padrão): mensagem contém a expressão ou palavra isolada
      if (textoNorm.includes(itemNorm)) return true;
    }
  }

  return false;
}

/**
 * Processa mensagens recebidas pelo Baileys para instâncias com Template Universal
 * @param {string} projectId
 * @param {object} sock - Instância WASocket do Baileys
 * @param {object} upsert - Evento Baileys 'messages.upsert'
 */
async function processarMensagensRecebidas(projectId, sock, upsert) {
  try {
    if (!upsert || !Array.isArray(upsert.messages) || !sock) return;

    const idSanitizado = sanitizarProjeto(projectId);
    const gatilhos = obterGatilhos(idSanitizado).filter(g => g.ativo);
    const historico = obterHistoricoGatilhos(idSanitizado);
    let historicoModificado = false;

    for (const msg of upsert.messages) {
      // 1. Ignora mensagens enviadas por nós mesmos
      if (msg.key && msg.key.fromMe) continue;

      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) continue;

      // 2. Automação e captura aplicam-se estritamente a conversas individuais (@s.whatsapp.net)
      // NUNCA dispara gatilhos em canais (@newsletter) ou grupos (@g.us)
      if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

      // 3. Extrai o conteúdo em texto da mensagem recebida
      const conteudoTexto = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.documentMessage?.caption ||
        ''
      ).trim();

      const pushName = msg.pushName || '';

      // 4. Captura do Lead de forma automática e imediata
      registrarLead(idSanitizado, {
        remoteJid,
        pushName,
        texto: conteudoTexto
      });

      if (!conteudoTexto || gatilhos.length === 0) continue;

      // 5. Varredura dos gatilhos ativos
      for (const gatilho of gatilhos) {
        if (!verificarCorrespondenciaGatilho(conteudoTexto, gatilho)) {
          continue;
        }

        // 6. Verificação de Debounce Anti-Loop (evita re-envios em sequência rápida)
        const chaveDebounce = `${remoteJid}_${gatilho.id}`;
        const agoraMs = Date.now();
        const ultimoDisparoMs = historico[chaveDebounce] || 0;
        const intervaloDebounceMs = (gatilho.debounceMinutos || 10) * 60 * 1000;

        if (agoraMs - ultimoDisparoMs < intervaloDebounceMs) {
          logProjeto(
            idSanitizado,
            'GATILHO_DEBOUNCE',
            `Gatilho "${gatilho.nome}" ignorado para ${remoteJid}: debounce ativo (${Math.round((intervaloDebounceMs - (agoraMs - ultimoDisparoMs)) / 1000)}s restantes).`,
            'info'
          );
          continue;
        }

        logProjeto(
          idSanitizado,
          'GATILHO_ACIONADO',
          `Gatilho "${gatilho.nome}" correspondido para mensagem de ${remoteJid}: "${conteudoTexto.slice(0, 40)}..."`,
          'info'
        );

        // Marca timestamp do disparo
        historico[chaveDebounce] = agoraMs;
        historicoModificado = true;

        // Atualiza lead com o gatilho acionado
        registrarLead(idSanitizado, {
          remoteJid,
          pushName,
          texto: conteudoTexto,
          gatilhoNome: gatilho.nome
        });

        // 7. Simulação de presença humanizada ("digitando...")
        try {
          const antiBanManager = require('./antiBanManager');
          await antiBanManager.simularPresencaHumanizada(
            idSanitizado,
            sock,
            remoteJid,
            gatilho.anexoTipo === 'audio' ? 'audio' : 'texto',
            gatilho.respostaTexto
          );
        } catch (_) {}

        // 8. Envio da resposta através do sessionManager
        try {
          const sessionManager = require('./sessionManager');
          const anexoTipo = (gatilho.anexoTipo || 'nenhum').toLowerCase();

          if (anexoTipo === 'documento' && gatilho.anexoUrl) {
            // Entrega de Documento / PDF
            await sessionManager.enviarMensagem(idSanitizado, {
              to: remoteJid,
              type: 'documento',
              texto: gatilho.respostaTexto,
              url: gatilho.anexoUrl,
              nomeArquivo: gatilho.anexoNomeArquivo || 'documento.pdf'
            });
          } else if (anexoTipo === 'imagem' && gatilho.anexoUrl) {
            // Entrega de Imagem
            await sessionManager.enviarMensagem(idSanitizado, {
              to: remoteJid,
              type: 'imagem',
              url: gatilho.anexoUrl,
              legenda: gatilho.respostaTexto
            });
          } else if (anexoTipo === 'video' && gatilho.anexoUrl) {
            // Entrega de Vídeo
            await sessionManager.enviarMensagem(idSanitizado, {
              to: remoteJid,
              type: 'video',
              url: gatilho.anexoUrl,
              legenda: gatilho.respostaTexto
            });
          } else if (anexoTipo === 'audio' && gatilho.anexoUrl) {
            // Entrega de Áudio gravado (PTT)
            if (gatilho.respostaTexto) {
              await sessionManager.enviarMensagem(idSanitizado, {
                to: remoteJid,
                type: 'texto',
                texto: gatilho.respostaTexto
              });
            }
            await sessionManager.enviarMensagem(idSanitizado, {
              to: remoteJid,
              type: 'audio',
              url: gatilho.anexoUrl
            });
          } else {
            // Entrega de Texto simples/acolhedor
            if (gatilho.respostaTexto) {
              await sessionManager.enviarMensagem(idSanitizado, {
                to: remoteJid,
                type: 'texto',
                texto: gatilho.respostaTexto
              });
            }
          }

          gatilho.totalDisparos = (gatilho.totalDisparos || 0) + 1;
          const listaAtual = obterGatilhos(idSanitizado);
          const idx = listaAtual.findIndex(g => g.id === gatilho.id);
          if (idx >= 0) {
            listaAtual[idx].totalDisparos = gatilho.totalDisparos;
            salvarListaGatilhos(idSanitizado, listaAtual);
          }

          logProjeto(
            idSanitizado,
            'GATILHO_ENTREGUE',
            `Resposta automática do gatilho "${gatilho.nome}" entregue com sucesso para ${remoteJid}.`,
            'success'
          );
        } catch (errEnvio) {
          logProjeto(
            idSanitizado,
            'ERRO_ENVIO_GATILHO',
            `Falha ao enviar resposta do gatilho "${gatilho.nome}" para ${remoteJid}: ${errEnvio.message}`,
            'error'
          );
        }

        // Uma única regra é acionada por mensagem para evitar respostas conflitantes
        break;
      }
    }

    if (historicoModificado) {
      salvarHistoricoGatilhos(idSanitizado, historico);
    }
  } catch (errGeral) {
    logProjeto(sanitizarProjeto(projectId), 'ERRO_MOTOR_UNIVERSAL', `Erro no loop de mensagens universais: ${errGeral.message}`, 'error');
  }
}

/**
 * Disparo Programado / Broadcast para lista de contatos ou canais com intervalos Anti-Ban
 * @param {string} projectId
 * @param {object} params - { destinatarios, tipo, texto, url, legenda, delayBaseMs }
 * @returns {Promise<object>}
 */
async function executarBroadcast(projectId, { destinatarios, tipo = 'texto', texto = '', url = '', legenda = '', delayBaseMs = 3000 }) {
  const idSanitizado = sanitizarProjeto(projectId);
  const sessionManager = require('./sessionManager');
  const antiBanManager = require('./antiBanManager');

  if (!Array.isArray(destinatarios) || destinatarios.length === 0) {
    throw new Error('Nenhum destinatário informado para o broadcast.');
  }

  const alvos = destinatarios.map(d => String(d).trim()).filter(Boolean);
  logProjeto(idSanitizado, 'BROADCAST_INICIADO', `Iniciando disparo broadcast para ${alvos.length} destinatários...`, 'info');

  const resultados = {
    total: alvos.length,
    sucessos: 0,
    falhas: 0,
    detalhes: []
  };

  for (let i = 0; i < alvos.length; i++) {
    const alvo = alvos[i];
    try {
      await sessionManager.enviarMensagem(idSanitizado, {
        to: alvo,
        type: tipo,
        texto,
        url,
        legenda
      });
      resultados.sucessos++;
      resultados.detalhes.push({ destino: alvo, status: 'enviado' });
    } catch (err) {
      resultados.falhas++;
      resultados.detalhes.push({ destino: alvo, status: 'erro', motivo: err.message });
      logProjeto(idSanitizado, 'BROADCAST_ERRO_ALVO', `Erro ao enviar para ${alvo}: ${err.message}`, 'warn');
    }

    // Intervalo Anti-Ban com Jitter orgânico entre cada contato da lista
    if (i < alvos.length - 1) {
      const delayComJitter = antiBanManager.aplicarJitterIntervalo(delayBaseMs, idSanitizado);
      await new Promise(resolve => setTimeout(resolve, delayComJitter));
    }
  }

  logProjeto(
    idSanitizado,
    'BROADCAST_CONCLUIDO',
    `Broadcast concluído: ${resultados.sucessos} entregues, ${resultados.falhas} falhas de um total de ${resultados.total}.`,
    resultados.falhas === 0 ? 'success' : 'warn'
  );

  return resultados;
}

module.exports = {
  obterGatilhos,
  salvarGatilho,
  removerGatilho,
  alternarGatilho,
  obterLeads,
  registrarLead,
  removerLead,
  limparTodosLeads,
  exportarLeadsCsv,
  processarMensagensRecebidas,
  executarBroadcast
};
