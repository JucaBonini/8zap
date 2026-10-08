const fs = require('fs');
const path = require('path');
const campanhasManager = require('./campanhasManager');
const rssFetcher = require('./rssFetcher');
const destinosManager = require('./destinos');
const sessionManager = require('./sessionManager');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');

/**
 * Executa a checagem e disparo periódico de campanhas e ofertas para todos os projetos ativos
 */
async function verificarEDispararCampanhas() {
  try {
    if (!fs.existsSync(diretorioData)) return;

    const arquivos = fs.readdirSync(diretorioData);
    // Identifica projetos que possuem configuração de campanhas ou que possuem sessões ativas
    const configsCampanhas = arquivos.filter((arq) => arq.startsWith('config-campanhas-') && arq.endsWith('.json'));

    const horaAtual = campanhasManager.obterHoraAtualFormatada();

    for (const arq of configsCampanhas) {
      const projectId = arq.replace(/^config-campanhas-/, '').replace(/\.json$/, '');
      const config = campanhasManager.obterConfigCampanhas(projectId);

      // Pula se campanhas estiverem desativadas
      if (!config.ativo) {
        continue;
      }

      // Verifica se a sessão do WhatsApp está conectada
      const statusSessao = sessionManager.obterStatusSessao(projectId);
      if (statusSessao.status !== 'connected') {
        continue;
      }

      const horariosConfigurados = Array.isArray(config.horarios) ? config.horarios : [];
      
      // Encontra se algum slot de horário bate com a hora atual
      const slotAtual = horariosConfigurados.find((h) => {
        const horaSlot = typeof h === 'string' ? h : h.hora;
        return horaSlot === horaAtual;
      });

      if (!slotAtual) {
        continue;
      }

      const controle = await campanhasManager.obterControleDiarioCampanhas(projectId);

      // Evita disparar duas vezes no mesmo horário hoje
      if (controle.horariosDisparados.has(horaAtual)) {
        continue;
      }

      // Verifica limite diário
      if (controle.totalHoje >= config.quantidadePorDia) {
        logProjeto(
          projectId,
          'CAMPANHA_LIMITE_DIARIO',
          `Limite diário de ${config.quantidadePorDia} posts de campanhas atingido hoje. Pulando horário ${horaAtual}.`,
          'info'
        );
        controle.horariosDisparados.add(horaAtual);
        await campanhasManager.salvarControleDiarioCampanhas(projectId, controle);
        continue;
      }

      // Determina o tipo desejado para este slot ('shopee', 'imagem', etc)
      const tipoSlot = typeof slotAtual === 'object' && slotAtual.tipo ? slotAtual.tipo : 'qualquer';
      const rotuloSlot = typeof slotAtual === 'object' && slotAtual.rotulo ? slotAtual.rotulo : `Horário ${horaAtual}`;

      logProjeto(
        projectId,
        'CAMPANHA_HORARIO_ATINGIDO',
        `Horário de campanha "${rotuloSlot}" (${horaAtual}) atingido. Selecionando conteúdo...`,
        'info'
      );

      // Executa o disparo do item
      await processarDisparoCampanha(projectId, config, horaAtual, tipoSlot);
    }
  } catch (err) {
    console.error('[AgendadorCampanhas] Erro no ciclo de verificação:', err.message);
  }
}

/**
 * Processa o disparo de um item de campanha (Shopee / Imagem / Post)
 * @param {string} projectId
 * @param {object} config
 * @param {string} horarioAtual
 * @param {string} [tipoSlot='qualquer']
 * @param {string} [itemIdForcado=null]
 */
async function processarDisparoCampanha(projectId, config, horarioAtual, tipoSlot = 'qualquer', itemIdForcado = null) {
  const controle = await campanhasManager.obterControleDiarioCampanhas(projectId);

  try {
    let item = null;

    if (itemIdForcado) {
      const itens = campanhasManager.obterItensCampanhas(projectId);
      item = itens.find((i) => i.id === itemIdForcado);
    } else {
      item = await campanhasManager.obterProximoItemDisponivel(projectId, tipoSlot);
    }

    // Se a fila estiver vazia (nenhum post cadastrado ou ativo)
    if (!item) {
      logProjeto(
        projectId,
        'CAMPANHA_FILA_VAZIA',
        `Nenhum item disponível na fila de campanhas para o horário ${horarioAtual} [Filtro: ${tipoSlot}]. Disparo pulado com segurança.`,
        'warn'
      );
      controle.horariosDisparados.add(horarioAtual);
      await campanhasManager.salvarControleDiarioCampanhas(projectId, controle);
      return {
        sucesso: false,
        motivo: 'fila_vazia',
        horario: horarioAtual
      };
    }

    // Obtém destinos disponíveis cadastrados no projeto
    const todosDestinos = await destinosManager.listarDestinosDisponiveis(projectId);
    if (!todosDestinos || todosDestinos.length === 0) {
      logProjeto(
        projectId,
        'CAMPANHA_SEM_DESTINOS',
        'Nenhum grupo ou canal disponível para envio de campanhas. Cadastre destinos no painel.',
        'warn'
      );
      controle.horariosDisparados.add(horarioAtual);
      await campanhasManager.salvarControleDiarioCampanhas(projectId, controle);
      return {
        sucesso: false,
        motivo: 'sem_destinos',
        horario: horarioAtual
      };
    }

    // Filtra destinos permitidos (com herança automática do RSS e trava fail-safe)
    let permitidos = Array.isArray(config.destinosPermitidos) ? config.destinosPermitidos : [];
    
    // Herança inteligente: se a campanha não tem destinos específicos, herda os destinos do RSS
    if (permitidos.length === 0) {
      const configRss = rssFetcher.obterConfigRss(projectId);
      if (Array.isArray(configRss.destinosPermitidos) && configRss.destinosPermitidos.length > 0) {
        permitidos = configRss.destinosPermitidos;
      }
    }

    // TRAVA DE SEGURANÇA (FAIL-SAFE): Se nada foi selecionado, NUNCA disparar para todos os grupos
    if (permitidos.length === 0) {
      logProjeto(
        projectId,
        'CAMPANHA_SEM_DESTINOS_SELECIONADOS',
        'Nenhum canal ou grupo foi selecionado para receber ofertas/campanhas. Disparo cancelado por segurança.',
        'warn'
      );
      controle.horariosDisparados.add(horarioAtual);
      await campanhasManager.salvarControleDiarioCampanhas(projectId, controle);
      return {
        sucesso: false,
        motivo: 'sem_destinos_selecionados',
        horario: horarioAtual
      };
    }

    const destinosAlvos = todosDestinos.filter((d) => permitidos.includes(d.jid));

    if (destinosAlvos.length === 0) {
      logProjeto(
        projectId,
        'CAMPANHA_SEM_DESTINOS_ATIVOS',
        'Nenhum dos destinos selecionados está disponível. Disparo pulado.',
        'warn'
      );
      controle.horariosDisparados.add(horarioAtual);
      await campanhasManager.salvarControleDiarioCampanhas(projectId, controle);
      return {
        sucesso: false,
        motivo: 'sem_destinos_ativos',
        horario: horarioAtual
      };
    }

    // Formata o texto final com emojis e links
    const textoMensagem = campanhasManager.formatarMensagemCampanha(item, config);
    const imagemUrl = item.imagem && item.imagem.trim().length > 0 ? item.imagem.trim() : null;

    logProjeto(
      projectId,
      'CAMPANHA_BROADCAST_INICIO',
      `Disparando campanha "${item.titulo}" [Tipo: ${item.tipo}] para ${destinosAlvos.length} destino(s)...`,
      'info'
    );

    let totalEnviadosComSucesso = 0;

    for (const destino of destinosAlvos) {
      try {
        logProjeto(
          projectId,
          'CAMPANHA_ENVIANDO',
          `Enviando para "${destino.nome}" (${destino.jid})...`,
          'info'
        );

        if (imagemUrl) {
          try {
            await sessionManager.enviarMensagem(projectId, {
              to: destino.jid,
              type: 'imagem',
              url: imagemUrl,
              legenda: textoMensagem
            });
          } catch (imgErr) {
            logProjeto(
              projectId,
              'CAMPANHA_FALLBACK_TEXTO',
              `Falha ao enviar com imagem para "${destino.nome}" (${imgErr.message}). Enviando como texto...`,
              'warn'
            );
            await sessionManager.enviarMensagem(projectId, {
              to: destino.jid,
              type: 'texto',
              texto: textoMensagem
            });
          }
        } else {
          await sessionManager.enviarMensagem(projectId, {
            to: destino.jid,
            type: 'texto',
            texto: textoMensagem
          });
        }

        totalEnviadosComSucesso++;
      } catch (errDestino) {
        logProjeto(
          projectId,
          'CAMPANHA_ERRO_DESTINO',
          `Falha ao enviar campanha para "${destino.nome}": ${errDestino.message}`,
          'error'
        );
      }
    }

    // Atualiza estatísticas do item
    await campanhasManager.marcarItemComoEnviado(projectId, item.id);

    // Registra controle diário
    controle.horariosDisparados.add(horarioAtual);
    controle.totalHoje += 1;
    await campanhasManager.salvarControleDiarioCampanhas(projectId, controle);

    logProjeto(
      projectId,
      'CAMPANHA_SUCESSO',
      `Campanha "${item.titulo}" enviada com sucesso em ${totalEnviadosComSucesso}/${destinosAlvos.length} destinos! (${controle.totalHoje}/${config.quantidadePorDia} hoje)`,
      'success'
    );

    return {
      sucesso: true,
      item,
      destinos: destinosAlvos,
      totalEnviados: totalEnviadosComSucesso,
      horario: horarioAtual
    };
  } catch (erroGeral) {
    logProjeto(
      projectId,
      'CAMPANHA_ERRO_GERAL',
      `Falha na execução de disparo de campanha: ${erroGeral.message}`,
      'error'
    );
    throw erroGeral;
  }
}

/**
 * Força o disparo manual imediato de um item de campanha para testes
 * @param {string} projectId
 * @param {string} [itemId=null]
 * @returns {Promise<object>}
 */
async function dispararCampanhaManual(projectId, itemId = null) {
  const config = campanhasManager.obterConfigCampanhas(projectId);
  const horaAtual = campanhasManager.obterHoraAtualFormatada();
  return processarDisparoCampanha(projectId, config, `MANUAL_${horaAtual}`, 'qualquer', itemId);
}

module.exports = {
  verificarEDispararCampanhas,
  processarDisparoCampanha,
  dispararCampanhaManual
};
