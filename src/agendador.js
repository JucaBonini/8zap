const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sessionManager = require('./sessionManager');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');

// Garante que a pasta data/ exista
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

let intervaloTimer = null;

/**
 * Fila de locks assíncronos por projeto para evitar condições de corrida em operações de arquivo
 * Map<string, Promise<void>>
 */
const locksProjetos = new Map();

/**
 * Executa uma operação assíncrona garantindo exclusão mútua (lock) por projeto
 * @param {string} projectId
 * @param {Function} operacao
 * @returns {Promise<any>}
 */
async function comLockProjeto(projectId, operacao) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const lockAnterior = locksProjetos.get(idSanitizado) || Promise.resolve();

  let resolverLockAtual;
  const novoLock = new Promise((resolve) => {
    resolverLockAtual = resolve;
  });

  // Enfileira o novo lock
  locksProjetos.set(idSanitizado, novoLock);

  try {
    // Aguarda o lock anterior terminar
    await lockAnterior;
    // Executa a operação protegida
    const resultado = await operacao();
    return resultado;
  } finally {
    resolverLockAtual();
    // Limpa o mapa se não houver novos locks aguardando
    if (locksProjetos.get(idSanitizado) === novoLock) {
      locksProjetos.delete(idSanitizado);
    }
  }
}

/**
 * Retorna o caminho do arquivo JSON da fila de um projeto
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoFila(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `fila-${idSanitizado}.json`);
}

/**
 * Lê a fila de postagens de um projeto (leitura direta síncrona sem lock)
 * @param {string} projectId
 * @returns {Array<object>}
 */
function lerArquivoFila(projectId) {
  const caminho = obterCaminhoFila(projectId);
  if (!fs.existsSync(caminho)) {
    return [];
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(projectId, 'ERRO_LEITURA_FILA', `Falha ao ler arquivo de fila: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Salva a lista de itens no arquivo JSON da fila do projeto de forma segura
 * @param {string} projectId
 * @param {Array<object>} itens
 */
function gravarArquivoFila(projectId, itens) {
  const caminho = obterCaminhoFila(projectId);
  try {
    fs.writeFileSync(caminho, JSON.stringify(itens, null, 2), 'utf8');
  } catch (err) {
    logProjeto(projectId, 'ERRO_GRAVACAO_FILA', `Falha ao salvar arquivo de fila: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Retorna a fila de postagens de um projeto (com lock)
 * @param {string} projectId
 * @returns {Promise<Array<object>>}
 */
async function obterFila(projectId) {
  return comLockProjeto(projectId, async () => {
    return lerArquivoFila(projectId);
  });
}

/**
 * Adiciona um novo item à fila do projeto (Thread-safe com Lock)
 * @param {string} projectId
 * @param {object} dadosItem - { tipo, to, texto, url, legenda, agendado_para }
 * @returns {Promise<object>}
 */
async function adicionarItemFila(projectId, dadosItem) {
  const { tipo = 'texto', to, texto, url, legenda, agendado_para } = dadosItem;

  if (!to) {
    throw new Error('O campo "to" (destinatário) é obrigatório.');
  }

  if (!agendado_para) {
    throw new Error('O campo "agendado_para" (data/hora ISO ou string válida) é obrigatório.');
  }

  const dataAgendada = new Date(agendado_para);
  if (isNaN(dataAgendada.getTime())) {
    throw new Error('O campo "agendado_para" contém uma data/hora inválida.');
  }

  const tipoNormalizado = (tipo || 'texto').toLowerCase();
  if (!['texto', 'imagem', 'video'].includes(tipoNormalizado)) {
    throw new Error('O "tipo" deve ser "texto", "imagem" ou "video".');
  }

  if (tipoNormalizado === 'texto' && (!texto || !texto.trim())) {
    throw new Error('O campo "texto" é obrigatório para mensagens de texto.');
  }

  if ((tipoNormalizado === 'imagem' || tipoNormalizado === 'video') && !url) {
    throw new Error(`O campo "url" é obrigatório para mensagens do tipo ${tipoNormalizado}.`);
  }

  const novoItem = {
    id: crypto.randomUUID ? crypto.randomUUID() : `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    tipo: tipoNormalizado,
    to: to.trim(),
    texto: texto || '',
    url: url || '',
    legenda: legenda || '',
    agendado_para: dataAgendada.toISOString(),
    enviado: false,
    enviado_em: null,
    criado_em: new Date().toISOString(),
    erro: null
  };

  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    filaAtual.push(novoItem);
    gravarArquivoFila(projectId, filaAtual);

    logProjeto(
      projectId,
      'AGENDAMENTO_CRIADO',
      `Post agendado para ${novoItem.agendado_para} para ${novoItem.to} (ID: ${novoItem.id})`,
      'info'
    );

    return novoItem;
  });
}

/**
 * Remove um item da fila de um projeto (Thread-safe com Lock)
 * @param {string} projectId
 * @param {string} idItem
 * @returns {Promise<object>}
 */
async function removerItemFila(projectId, idItem) {
  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    const index = filaAtual.findIndex((item) => item.id === idItem);

    if (index === -1) {
      throw new Error(`Item com ID "${idItem}" não encontrado na fila.`);
    }

    const itemRemovido = filaAtual.splice(index, 1)[0];
    gravarArquivoFila(projectId, filaAtual);

    logProjeto(projectId, 'AGENDAMENTO_REMOVIDO', `Item removido da fila: ID ${idItem}`, 'info');
    return itemRemovido;
  });
}

/**
 * Atualiza o status de um item específico na fila com garantia de lock atômico
 * @param {string} projectId
 * @param {string} idItem
 * @param {object} atualizacoes
 */
async function atualizarStatusItem(projectId, idItem, atualizacoes) {
  return comLockProjeto(projectId, async () => {
    const filaAtual = lerArquivoFila(projectId);
    const item = filaAtual.find((i) => i.id === idItem);
    if (item) {
      Object.assign(item, atualizacoes);
      gravarArquivoFila(projectId, filaAtual);
    }
  });
}

/**
 * Executa um ciclo completo de checagem e disparo das filas de todos os projetos
 */
async function executarCicloAgendador() {
  try {
    if (!fs.existsSync(diretorioData)) {
      return;
    }

    const arquivos = fs.readdirSync(diretorioData);
    const arquivosFila = arquivos.filter((arq) => arq.startsWith('fila-') && arq.endsWith('.json'));

    const agora = new Date();

    for (const arq of arquivosFila) {
      const projectId = arq.replace(/^fila-/, '').replace(/\.json$/, '');
      
      // Lê snapshot atual da fila
      const fila = await obterFila(projectId);

      for (const item of fila) {
        // Verifica se ainda não foi enviado e se a hora de envio já chegou
        if (!item.enviado && item.agendado_para) {
          const dataAgendada = new Date(item.agendado_para);

          if (dataAgendada <= agora) {
            // Verifica o status da sessão
            const statusSessao = sessionManager.obterStatusSessao(projectId);

            if (statusSessao.status !== 'connected') {
              logProjeto(
                projectId,
                'AGENDADOR_PENDENTE',
                `Item ${item.id} pronto para envio, porém a sessão está com status "${statusSessao.status}". Aguardando conexão.`,
                'warn'
              );
              continue;
            }

            // Executa o disparo através do sessionManager
            try {
              logProjeto(
                projectId,
                'AGENDADOR_DISPARANDO',
                `Disparando post agendado ID: ${item.id} para ${item.to}...`,
                'info'
              );

              await sessionManager.enviarMensagem(projectId, {
                to: item.to,
                type: item.tipo,
                texto: item.texto,
                url: item.url,
                legenda: item.legenda
              });

              // Atualização com lock atômico sem risco de sobrescrever adições concorrentes
              await atualizarStatusItem(projectId, item.id, {
                enviado: true,
                enviado_em: new Date().toISOString(),
                erro: null
              });

              logProjeto(
                projectId,
                'AGENDADOR_SUCESSO',
                `Post agendado ID ${item.id} enviado com sucesso!`,
                'success'
              );
            } catch (envioErr) {
              await atualizarStatusItem(projectId, item.id, {
                erro: envioErr.message,
                tentativas: (item.tentativas || 0) + 1
              });

              logProjeto(
                projectId,
                'AGENDADOR_ERRO',
                `Falha ao disparar post agendado ID ${item.id}: ${envioErr.message}`,
                'error'
              );
            }
          }
        }
      }
    }

    // 2. Executa a checagem e disparo do módulo de RSS Automático
    try {
      const agendadorRss = require('./agendadorRss');
      await agendadorRss.verificarEDispararRss();
    } catch (rssErr) {
      console.error('[Agendador] Erro no módulo de RSS:', rssErr.message);
    }
  } catch (cicloErr) {
    console.error('[Agendador] Erro no ciclo de verificação:', cicloErr.message);
  }
}

/**
 * Inicia o loop periódico do agendador
 */
function iniciarAgendador() {
  const intervaloSegundos = parseInt(process.env.INTERVALO_AGENDADOR_SEGUNDOS, 10) || 60;
  const intervaloMs = Math.max(intervaloSegundos, 5) * 1000;

  console.log(`[Agendador] Iniciando serviço de postagens agendadas (Checagem a cada ${intervaloMs / 1000}s)...`);

  // Executa uma primeira vez logo na inicialização
  executarCicloAgendador();

  // Mantém o loop periódico
  if (intervaloTimer) {
    clearInterval(intervaloTimer);
  }
  intervaloTimer = setInterval(executarCicloAgendador, intervaloMs);
}

/**
 * Para o loop do agendador
 */
function pararAgendador() {
  if (intervaloTimer) {
    clearInterval(intervaloTimer);
    intervaloTimer = null;
  }
}

module.exports = {
  comLockProjeto,
  obterFila,
  adicionarItemFila,
  removerItemFila,
  atualizarStatusItem,
  executarCicloAgendador,
  iniciarAgendador,
  pararAgendador
};
