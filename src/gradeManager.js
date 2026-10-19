const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logProjeto } = require('./logger');
const sessionManager = require('./sessionManager');
const destinosManager = require('./destinos');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Retorna a hora atual no formato HH:MM no fuso configurado
 * @param {string} [fuso]
 * @returns {string}
 */
function obterHoraAtualFormatada(fuso = process.env.TIMEZONE || 'America/Sao_Paulo') {
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const hora = partes.find((p) => p.type === 'hour').value.padStart(2, '0');
    const min = partes.find((p) => p.type === 'minute').value.padStart(2, '0');
    return `${hora}:${min}`;
  } catch (_) {
    const agora = new Date();
    const horas = String(agora.getHours()).padStart(2, '0');
    const minutos = String(agora.getMinutes()).padStart(2, '0');
    return `${horas}:${minutos}`;
  }
}

/**
 * Retorna a data atual no formato YYYY-MM-DD no fuso configurado
 * @param {string} [fuso]
 * @returns {string}
 */
function obterDataHojeFormatada(fuso = process.env.TIMEZONE || 'America/Sao_Paulo') {
  try {
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const ano = partes.find((p) => p.type === 'year').value;
    const mes = partes.find((p) => p.type === 'month').value;
    const dia = partes.find((p) => p.type === 'day').value;
    return `${ano}-${mes}-${dia}`;
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Retorna o caminho do arquivo de configuração da grade
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoGrade(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `grade-${idSanitizado}.json`);
}

/**
 * Retorna a configuração da Grade Diária do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigGrade(projectId) {
  const caminho = obterCaminhoGrade(projectId);
  const padrao = {
    ativo: false,
    destinos: [],
    horarios: [
      { id: 'slot_1', hora: '07:45', origem: 'manual' },
      { id: 'slot_2', hora: '10:15', origem: 'rss' },
      { id: 'slot_3', hora: '11:45', origem: 'manual' },
      { id: 'slot_4', hora: '15:05', origem: 'campanhas' },
      { id: 'slot_5', hora: '17:20', origem: 'rss' },
      { id: 'slot_6', hora: '19:35', origem: 'manual' },
      { id: 'slot_7', hora: '21:00', origem: 'manual' }
    ],
    historicoDisparos: {}
  };

  if (!fs.existsSync(caminho)) {
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return {
      ativo: Boolean(dados.ativo),
      destinos: Array.isArray(dados.destinos) ? dados.destinos : [],
      horarios: Array.isArray(dados.horarios) ? dados.horarios : padrao.horarios,
      historicoDisparos: dados.historicoDisparos || {}
    };
  } catch (err) {
    logProjeto(projectId, 'ERRO_LEITURA_GRADE', `Falha ao ler grade: ${err.message}`, 'error');
    return padrao;
  }
}

/**
 * Salva a configuração da Grade Diária do projeto
 * @param {string} projectId
 * @param {object} novaConfig
 * @returns {object}
 */
function salvarConfigGrade(projectId, novaConfig) {
  const caminho = obterCaminhoGrade(projectId);
  const atual = obterConfigGrade(projectId);

  const horariosOrdenados = (Array.isArray(novaConfig.horarios) ? novaConfig.horarios : atual.horarios)
    .filter(h => h && h.hora && h.origem)
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const configParaSalvar = {
    ativo: novaConfig.ativo !== undefined ? Boolean(novaConfig.ativo) : atual.ativo,
    destinos: Array.isArray(novaConfig.destinos) ? novaConfig.destinos : atual.destinos,
    horarios: horariosOrdenados,
    historicoDisparos: atual.historicoDisparos || {}
  };

  try {
    fs.writeFileSync(caminho, JSON.stringify(configParaSalvar, null, 2), 'utf8');
    logProjeto(projectId, 'GRADE_CONFIG_SALVA', `Grade Diária atualizada com ${configParaSalvar.horarios.length} horários.`, 'info');
    return configParaSalvar;
  } catch (err) {
    logProjeto(projectId, 'ERRO_GRAVACAO_GRADE', `Falha ao salvar grade: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Adiciona um novo horário à Grade Diária
 * @param {string} projectId
 * @param {object} slot - { hora: '12:00', origem: 'manual'|'rss'|'campanhas'|'receitas' }
 * @returns {object}
 */
function adicionarSlotGrade(projectId, slot) {
  const { hora, origem } = slot;
  if (!hora || !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(hora)) {
    throw new Error('Horário inválido. Formato esperado: HH:MM.');
  }

  const origemLimpa = (origem || 'manual').toLowerCase();
  if (!['manual', 'rss', 'campanhas', 'receitas'].includes(origemLimpa)) {
    throw new Error('Tipo de disparo inválido. Use "manual", "rss", "campanhas" ou "receitas".');
  }

  const config = obterConfigGrade(projectId);
  const horaPadronizada = hora.padStart(5, '0');

  const novoSlot = {
    id: `slot_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    hora: horaPadronizada,
    origem: origemLimpa
  };

  config.horarios.push(novoSlot);
  return salvarConfigGrade(projectId, config);
}

/**
 * Remove um horário da Grade Diária
 * @param {string} projectId
 * @param {string} slotId
 * @returns {object}
 */
function removerSlotGrade(projectId, slotId) {
  const config = obterConfigGrade(projectId);
  config.horarios = config.horarios.filter((s) => s.id !== slotId);
  return salvarConfigGrade(projectId, config);
}

/**
 * Dispara manualmente um slot da Grade Diária para teste imediato
 * @param {string} projectId
 * @param {string} slotId
 * @returns {Promise<object>}
 */
async function dispararSlotManual(projectId, slotId) {
  const config = obterConfigGrade(projectId);
  const slot = config.horarios.find((s) => s.id === slotId);

  if (!slot) {
    throw new Error(`Horário da grade com ID "${slotId}" não encontrado.`);
  }

  logProjeto(projectId, 'GRADE_TESTE_DISPARO', `Iniciando disparo manual de teste para slot ${slot.hora} [${slot.origem.toUpperCase()}]...`, 'info');

  return executarDisparoSlot(projectId, slot, config.destinos);
}

/**
 * Executa o disparo de acordo com a origem do slot
 * @param {string} projectId
 * @param {object} slot
 * @param {Array<string>} destinosGrade
 * @returns {Promise<object>}
 */
async function executarDisparoSlot(projectId, slot, destinosGrade) {
  const agendador = require('./agendador');
  const agendadorRss = require('./agendadorRss');
  const agendadorCampanhas = require('./agendadorCampanhas');

  if (slot.origem === 'manual') {
    return agendador.dispararProximoItemEsteira(projectId, destinosGrade);
  } else if (slot.origem === 'rss') {
    return agendadorRss.dispararArtigoManual(projectId, true, destinosGrade);
  } else if (slot.origem === 'campanhas') {
    return agendadorCampanhas.dispararCampanhaManual(projectId, null, destinosGrade);
  } else if (slot.origem === 'receitas') {
    const receitasManager = require('./receitasManager');
    return receitasManager.dispararProximaReceita(projectId, destinosGrade);
  } else {
    throw new Error(`Origem desconhecida "${slot.origem}".`);
  }
}

/**
 * Verifica se há algum slot da Grade Diária para disparar no minuto atual
 * Chamado a cada ciclo pelo agendador principal
 */
async function verificarEDispararGrade() {
  if (!fs.existsSync(diretorioData)) return;

  const horaAtual = obterHoraAtualFormatada();
  const dataHoje = obterDataHojeFormatada();

  const arquivos = fs.readdirSync(diretorioData);
  const arquivosGrade = arquivos.filter((arq) => arq.startsWith('grade-') && arq.endsWith('.json'));

  for (const arq of arquivosGrade) {
    const projectId = arq.replace(/^grade-/, '').replace(/\.json$/, '');

    try {
      const config = obterConfigGrade(projectId);
      if (!config.ativo || !Array.isArray(config.horarios) || config.horarios.length === 0) {
        continue;
      }

      // Garante histórico do dia
      if (!config.historicoDisparos[dataHoje]) {
        config.historicoDisparos[dataHoje] = [];
        // Limpa dias anteriores para não acumular
        const dias = Object.keys(config.historicoDisparos);
        if (dias.length > 7) {
          dias.filter(d => d !== dataHoje).forEach(d => delete config.historicoDisparos[d]);
        }
      }

      // Procura slots correspondentes ao minuto atual
      const slotsDoMomento = config.horarios.filter((s) => s.hora === horaAtual);

      for (const slot of slotsDoMomento) {
        const chaveExecucao = `${slot.id}_${slot.hora}`;
        if (config.historicoDisparos[dataHoje].includes(chaveExecucao)) {
          // Já executou neste minuto hoje
          continue;
        }

        // Verifica conexão da sessão
        const statusSessao = sessionManager.obterStatusSessao(projectId);
        if (statusSessao.status !== 'connected') {
          logProjeto(projectId, 'GRADE_AVISO_SESSAO', `Horário ${slot.hora} [${slot.origem}] da Grade atingido, mas o WhatsApp não está conectado.`, 'warn');
          continue;
        }

        logProjeto(
          projectId,
          'GRADE_EXECUCAO_SLOT',
          `⏰ Horário ${slot.hora} da Grade Diária atingido! Executando disparo de [${slot.origem.toUpperCase()}]...`,
          'info'
        );

        // Registra execução imediatamente para blindar contra ticks concorrentes
        config.historicoDisparos[dataHoje].push(chaveExecucao);
        const caminho = obterCaminhoGrade(projectId);
        try {
          fs.writeFileSync(caminho, JSON.stringify(config, null, 2), 'utf8');
        } catch (_) {}

        try {
          const resultado = await executarDisparoSlot(projectId, slot, config.destinos);

          if (resultado && resultado.motivo === 'esteira_vazia') {
            logProjeto(
              projectId,
              'GRADE_AVISO_ESTEIRA',
              `Horário ${slot.hora} [Fila Manual]: ${resultado.mensagem}`,
              'warn'
            );
          } else {
            logProjeto(
              projectId,
              'GRADE_SUCESSO_SLOT',
              `✅ Disparo do horário ${slot.hora} [${slot.origem.toUpperCase()}] realizado com sucesso!`,
              'success'
            );
          }
        } catch (errDisparo) {
          logProjeto(
            projectId,
            'GRADE_ERRO_SLOT',
            `❌ Falha ao executar horário ${slot.hora} [${slot.origem.toUpperCase()}]: ${errDisparo.message}`,
            'error'
          );
        }
      }
    } catch (errProjeto) {
      console.error(`[Grade] Erro ao processar projeto ${projectId}:`, errProjeto.message);
    }
  }
}

module.exports = {
  obterHoraAtualFormatada,
  obterConfigGrade,
  salvarConfigGrade,
  adicionarSlotGrade,
  removerSlotGrade,
  dispararSlotManual,
  verificarEDispararGrade
};
