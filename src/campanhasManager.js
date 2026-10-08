const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logProjeto } = require('./logger');
const { comLockProjeto } = require('./agendador');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Cache em memória do controle diário por projeto
 * Map<string, { data: string, horariosDisparados: Set<string>, totalHoje: number }>
 */
const disparosDiariosCampanhasCache = new Map();

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
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
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
 * Retorna o caminho do arquivo de configuração de campanhas
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoConfigCampanhas(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `config-campanhas-${idSanitizado}.json`);
}

/**
 * Retorna o caminho do arquivo do banco de itens de campanhas (Shopee, Imagens, etc)
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoItensCampanhas(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `campanhas-${idSanitizado}.json`);
}

/**
 * Retorna o caminho do arquivo de controle diário de campanhas
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoControleDiario(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `controle-diario-campanhas-${idSanitizado}.json`);
}

/**
 * Retorna a configuração padrão de campanhas
 * @returns {object}
 */
function obterConfigPadrao() {
  return {
    ativo: true,
    modoFila: 'rotativo', // 'rotativo' (reutiliza após cooldown) ou 'consumir' (envia uma vez e desativa)
    quantidadePorDia: 5,
    cooldownDias: 7,
    // Cada slot de horário pode opcionalmente especificar o tipo desejado ('shopee', 'imagem', ou 'qualquer')
    horarios: [
      { hora: '10:30', tipo: 'imagem', rotulo: 'Dica / Imagem da Manhã' },
      { hora: '16:30', tipo: 'shopee', rotulo: 'Oferta Shopee da Tarde' }
    ],
    destinosPermitidos: [],
    templateShopee: '🔥 *ACHADINHO IMPERDÍVEL!* 🔥\n\n🛍️ *{titulo}*\n{destaque}\n{preco}\n\n👉 *Acesse pelo link oficial para garantir com desconto:* 👇\n🛒 {link}',
    templateImagem: '✨ *{titulo}*\n\n{destaque}\n\n{link}'
  };
}

/**
 * Lê a configuração de campanhas do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigCampanhas(projectId) {
  const caminho = obterCaminhoConfigCampanhas(projectId);
  if (!fs.existsSync(caminho)) {
    const padrao = obterConfigPadrao();
    try {
      fs.writeFileSync(caminho, JSON.stringify(padrao, null, 2), 'utf8');
    } catch (_) {}
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    const padrao = obterConfigPadrao();

    // Normaliza horários legados se forem apenas strings ["10:30", "16:30"]
    let horariosNormalizados = dados.horarios;
    if (Array.isArray(horariosNormalizados)) {
      horariosNormalizados = horariosNormalizados.map((h) => {
        if (typeof h === 'string') {
          return { hora: h, tipo: 'qualquer', rotulo: `Disparo ${h}` };
        }
        return {
          hora: h.hora || '12:00',
          tipo: h.tipo || 'qualquer',
          rotulo: h.rotulo || `Disparo ${h.hora || '12:00'}`
        };
      });
    } else {
      horariosNormalizados = padrao.horarios;
    }

    return {
      ...padrao,
      ...dados,
      horarios: horariosNormalizados
    };
  } catch (err) {
    logProjeto(projectId, 'ERRO_CONFIG_CAMPANHAS', `Falha ao ler config de campanhas: ${err.message}`, 'error');
    return obterConfigPadrao();
  }
}

/**
 * Salva a configuração de campanhas de forma thread-safe
 * @param {string} projectId
 * @param {object} novaConfig
 * @returns {Promise<object>}
 */
async function salvarConfigCampanhas(projectId, novaConfig) {
  const caminho = obterCaminhoConfigCampanhas(projectId);
  return comLockProjeto(projectId, async () => {
    const atual = obterConfigCampanhas(projectId);

    // Normaliza os horários recebidos
    let horariosNormalizados = novaConfig.horarios;
    if (Array.isArray(horariosNormalizados)) {
      horariosNormalizados = horariosNormalizados.map((h) => {
        if (typeof h === 'string') {
          return { hora: h.trim(), tipo: 'qualquer', rotulo: `Disparo ${h.trim()}` };
        }
        return {
          hora: (h.hora || '').trim(),
          tipo: ['shopee', 'imagem', 'texto', 'qualquer'].includes(h.tipo) ? h.tipo : 'qualquer',
          rotulo: (h.rotulo || '').trim() || `Disparo ${h.hora}`
        };
      }).filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h.hora));
    } else {
      horariosNormalizados = atual.horarios;
    }

    const destinosPermitidos = Array.isArray(novaConfig.destinosPermitidos)
      ? novaConfig.destinosPermitidos
      : (Array.isArray(atual.destinosPermitidos) ? atual.destinosPermitidos : []);

    const configFinal = {
      ...atual,
      ...novaConfig,
      horarios: horariosNormalizados,
      destinosPermitidos,
      quantidadePorDia: parseInt(novaConfig.quantidadePorDia, 10) || atual.quantidadePorDia || 5,
      cooldownDias: parseInt(novaConfig.cooldownDias, 10) || atual.cooldownDias || 7,
      modoFila: ['rotativo', 'consumir'].includes(novaConfig.modoFila) ? novaConfig.modoFila : 'rotativo',
      ativo: novaConfig.ativo !== undefined ? !!novaConfig.ativo : atual.ativo
    };

    fs.writeFileSync(caminho, JSON.stringify(configFinal, null, 2), 'utf8');
    logProjeto(projectId, 'CONFIG_CAMPANHAS_SALVA', 'Configuração de campanhas e ofertas atualizada com sucesso.', 'info');
    return configFinal;
  });
}

/**
 * Lê a lista de itens de campanhas do projeto
 * @param {string} projectId
 * @returns {Array<object>}
 */
function obterItensCampanhas(projectId) {
  const caminho = obterCaminhoItensCampanhas(projectId);
  if (!fs.existsSync(caminho)) {
    return [];
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (err) {
    logProjeto(projectId, 'ERRO_LER_CAMPANHAS', `Falha ao ler banco de campanhas: ${err.message}`, 'error');
    return [];
  }
}

/**
 * Salva a lista de itens de campanhas com lock seguro
 * @param {string} projectId
 * @param {Array<object>} itens
 * @returns {Promise<void>}
 */
async function salvarItensCampanhas(projectId, itens) {
  const caminho = obterCaminhoItensCampanhas(projectId);
  await comLockProjeto(projectId, async () => {
    try {
      fs.writeFileSync(caminho, JSON.stringify(itens, null, 2), 'utf8');
    } catch (err) {
      logProjeto(projectId, 'ERRO_GRAVAR_CAMPANHAS', `Falha ao salvar banco de campanhas: ${err.message}`, 'error');
      throw err;
    }
  });
}

/**
 * Adiciona um novo item de campanha (Shopee / Imagem / Post)
 * @param {string} projectId
 * @param {object} dadosItem
 * @returns {Promise<object>}
 */
async function adicionarItemCampanha(projectId, dadosItem) {
  const {
    tipo = 'shopee',
    titulo,
    destaque = '',
    preco = '',
    link = '',
    imagem = '',
    legenda = '',
    ativo = true
  } = dadosItem;

  if (!titulo || !titulo.trim()) {
    throw new Error('O campo "titulo" é obrigatório.');
  }

  const tipoNormalizado = ['shopee', 'imagem', 'texto'].includes(tipo) ? tipo : 'shopee';

  const novoItem = {
    id: crypto.randomUUID ? crypto.randomUUID() : `camp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    tipo: tipoNormalizado,
    titulo: titulo.trim(),
    destaque: destaque ? destaque.trim() : '',
    preco: preco ? preco.trim() : '',
    link: link ? link.trim() : '',
    imagem: imagem ? imagem.trim() : '',
    legenda: legenda ? legenda.trim() : '',
    ativo: ativo !== false,
    vezesEnviado: 0,
    ultimoEnvioEm: null,
    criadoEm: new Date().toISOString()
  };

  return comLockProjeto(projectId, async () => {
    const lista = obterItensCampanhas(projectId);
    lista.unshift(novoItem);
    const caminho = obterCaminhoItensCampanhas(projectId);
    fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf8');

    logProjeto(projectId, 'CAMPANHA_ADICIONADA', `Novo item de campanha adicionado: "${novoItem.titulo}" [Tipo: ${novoItem.tipo}]`, 'info');
    return novoItem;
  });
}

/**
 * Atualiza um item de campanha existente
 * @param {string} projectId
 * @param {string} itemId
 * @param {object} dadosAtualizacao
 * @returns {Promise<object>}
 */
async function atualizarItemCampanha(projectId, itemId, dadosAtualizacao) {
  return comLockProjeto(projectId, async () => {
    const lista = obterItensCampanhas(projectId);
    const index = lista.findIndex((item) => item.id === itemId);

    if (index === -1) {
      throw new Error(`Item com ID "${itemId}" não encontrado.`);
    }

    const itemExistente = lista[index];
    const itemAtualizado = {
      ...itemExistente,
      ...dadosAtualizacao,
      id: itemExistente.id, // Não permite alterar o ID
      criadoEm: itemExistente.criadoEm
    };

    lista[index] = itemAtualizado;
    const caminho = obterCaminhoItensCampanhas(projectId);
    fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf8');

    logProjeto(projectId, 'CAMPANHA_ATUALIZADA', `Item de campanha atualizado: "${itemAtualizado.titulo}" (ID: ${itemId})`, 'info');
    return itemAtualizado;
  });
}

/**
 * Remove um item de campanha
 * @param {string} projectId
 * @param {string} itemId
 * @returns {Promise<object>}
 */
async function removerItemCampanha(projectId, itemId) {
  return comLockProjeto(projectId, async () => {
    const lista = obterItensCampanhas(projectId);
    const index = lista.findIndex((item) => item.id === itemId);

    if (index === -1) {
      throw new Error(`Item com ID "${itemId}" não encontrado.`);
    }

    const removido = lista.splice(index, 1)[0];
    const caminho = obterCaminhoItensCampanhas(projectId);
    fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf8');

    logProjeto(projectId, 'CAMPANHA_REMOVIDA', `Item removido de campanhas: "${removido.titulo}"`, 'info');
    return removido;
  });
}

/**
 * Seleciona de forma inteligente o próximo item disponível para envio
 * @param {string} projectId
 * @param {string} [tipoDesejado='qualquer'] - 'shopee', 'imagem', 'texto' ou 'qualquer'
 * @returns {Promise<object|null>}
 */
async function obterProximoItemDisponivel(projectId, tipoDesejado = 'qualquer') {
  const config = obterConfigCampanhas(projectId);
  const itens = obterItensCampanhas(projectId);

  if (!itens || itens.length === 0) {
    return null;
  }

  // 1. Filtra itens ativos
  let elegiveis = itens.filter((i) => i.ativo);

  // 2. Se houver filtro de tipo e houver itens desse tipo, prioriza o tipo desejado
  if (tipoDesejado && tipoDesejado !== 'qualquer') {
    const filtradosPorTipo = elegiveis.filter((i) => i.tipo === tipoDesejado);
    if (filtradosPorTipo.length > 0) {
      elegiveis = filtradosPorTipo;
    }
  }

  if (elegiveis.length === 0) {
    return null;
  }

  const agora = Date.now();
  const cooldownMs = (config.cooldownDias || 7) * 24 * 60 * 60 * 1000;

  // No modo 'consumir', prioriza itens que nunca foram enviados
  if (config.modoFila === 'consumir') {
    const nuncaEnviados = elegiveis.filter((i) => !i.vezesEnviado || i.vezesEnviado === 0);
    if (nuncaEnviados.length > 0) {
      return nuncaEnviados[0];
    }
    return null; // Acabaram os itens novos
  }

  // No modo 'rotativo' (Fila com Cooldown Inteligente):
  // Prioridade 1: Itens que nunca foram enviados
  const nuncaEnviados = elegiveis.filter((i) => !i.ultimoEnvioEm);
  if (nuncaEnviados.length > 0) {
    return nuncaEnviados[0];
  }

  // Prioridade 2: Itens cujo cooldown já expirou, ordenados pelo envio mais antigo
  const foraDoCooldown = elegiveis.filter((i) => {
    const timestampEnvio = new Date(i.ultimoEnvioEm).getTime();
    return agora - timestampEnvio >= cooldownMs;
  });

  if (foraDoCooldown.length > 0) {
    foraDoCooldown.sort((a, b) => new Date(a.ultimoEnvioEm).getTime() - new Date(b.ultimoEnvioEm).getTime());
    return foraDoCooldown[0];
  }

  // Prioridade 3 (Fallback para nunca deixar o canal vazio): Pega o item enviado há mais tempo
  elegiveis.sort((a, b) => new Date(a.ultimoEnvioEm).getTime() - new Date(b.ultimoEnvioEm).getTime());
  return elegiveis[0];
}

/**
 * Marca um item de campanha como enviado
 * @param {string} projectId
 * @param {string} itemId
 */
async function marcarItemComoEnviado(projectId, itemId) {
  return comLockProjeto(projectId, async () => {
    const lista = obterItensCampanhas(projectId);
    const item = lista.find((i) => i.id === itemId);
    if (item) {
      item.vezesEnviado = (item.vezesEnviado || 0) + 1;
      item.ultimoEnvioEm = new Date().toISOString();

      // Se for modo 'consumir', desativa após o primeiro envio
      const config = obterConfigCampanhas(projectId);
      if (config.modoFila === 'consumir') {
        item.ativo = false;
      }

      const caminho = obterCaminhoItensCampanhas(projectId);
      fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf8');
    }
  });
}

/**
 * Formata o texto final da mensagem para envio da campanha
 * @param {object} item
 * @param {object} [config]
 * @returns {string}
 */
function formatarMensagemCampanha(item, config = {}) {
  const tipo = item.tipo || 'shopee';
  const titulo = item.titulo || '';
  const destaque = item.destaque ? `✨ ${item.destaque}` : '';
  const preco = item.preco ? `🏷️ *Preço Especial:* ${item.preco}` : '';
  const link = item.link || '';
  const legenda = item.legenda || '';

  // Se o usuário escreveu uma legenda personalizada completa, utiliza diretamente
  if (legenda && legenda.trim().length > 0) {
    return legenda
      .replace(/\{titulo\}/gi, titulo)
      .replace(/\{destaque\}/gi, item.destaque || '')
      .replace(/\{preco\}/gi, item.preco || '')
      .replace(/\{link\}/gi, link);
  }

  if (tipo === 'shopee') {
    const template = config.templateShopee || obterConfigPadrao().templateShopee;
    return template
      .replace(/\{titulo\}/gi, titulo)
      .replace(/\{destaque\}/gi, destaque)
      .replace(/\{preco\}/gi, preco)
      .replace(/\{link\}/gi, link)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (tipo === 'imagem') {
    const template = config.templateImagem || obterConfigPadrao().templateImagem;
    const blocoLink = link ? `🔗 *Mais informações:* ${link}` : '';
    return template
      .replace(/\{titulo\}/gi, titulo)
      .replace(/\{destaque\}/gi, item.destaque || '')
      .replace(/\{link\}/gi, blocoLink)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Tipo texto simples
  const linhas = [`📢 *${titulo}*`];
  if (item.destaque) linhas.push(`\n${item.destaque}`);
  if (item.preco) linhas.push(`\n${preco}`);
  if (link) linhas.push(`\n🔗 ${link}`);
  return linhas.join('\n').trim();
}

/**
 * Obtém ou inicializa o controle diário de disparos de campanhas
 * @param {string} projectId
 * @returns {Promise<{ data: string, horariosDisparados: Set<string>, totalHoje: number }>}
 */
async function obterControleDiarioCampanhas(projectId) {
  const dataHoje = obterDataHojeFormatada();
  let controle = disparosDiariosCampanhasCache.get(projectId);

  if (controle && controle.data === dataHoje) {
    return controle;
  }

  const caminho = obterCaminhoControleDiario(projectId);

  return comLockProjeto(projectId, async () => {
    let dadosArquivo = null;

    if (fs.existsSync(caminho)) {
      try {
        const conteudo = fs.readFileSync(caminho, 'utf8');
        dadosArquivo = JSON.parse(conteudo);
      } catch (err) {
        logProjeto(projectId, 'ERRO_LER_CONTROLE_CAMPANHAS', `Falha ao ler controle diário: ${err.message}`, 'error');
      }
    }

    if (dadosArquivo && dadosArquivo.data === dataHoje) {
      controle = {
        data: dataHoje,
        horariosDisparados: new Set(Array.isArray(dadosArquivo.horariosDisparados) ? dadosArquivo.horariosDisparados : []),
        totalHoje: typeof dadosArquivo.totalHoje === 'number' ? dadosArquivo.totalHoje : 0
      };
    } else {
      controle = {
        data: dataHoje,
        horariosDisparados: new Set(),
        totalHoje: 0
      };

      try {
        fs.writeFileSync(
          caminho,
          JSON.stringify(
            {
              data: dataHoje,
              horariosDisparados: [],
              totalHoje: 0
            },
            null,
            2
          ),
          'utf8'
        );
      } catch (_) {}
    }

    disparosDiariosCampanhasCache.set(projectId, controle);
    return controle;
  });
}

/**
 * Salva o controle diário de campanhas
 * @param {string} projectId
 * @param {{ data: string, horariosDisparados: Set<string>, totalHoje: number }} controle
 */
async function salvarControleDiarioCampanhas(projectId, controle) {
  const caminho = obterCaminhoControleDiario(projectId);
  const dadosParaSalvar = {
    data: controle.data,
    horariosDisparados: Array.from(controle.horariosDisparados || []),
    totalHoje: controle.totalHoje || 0
  };

  await comLockProjeto(projectId, async () => {
    try {
      fs.writeFileSync(caminho, JSON.stringify(dadosParaSalvar, null, 2), 'utf8');
    } catch (err) {
      logProjeto(projectId, 'ERRO_GRAVAR_CONTROLE_CAMPANHAS', `Falha ao salvar controle diário: ${err.message}`, 'error');
    }
  });
}

module.exports = {
  obterDataHojeFormatada,
  obterHoraAtualFormatada,
  obterConfigCampanhas,
  salvarConfigCampanhas,
  obterItensCampanhas,
  salvarItensCampanhas,
  adicionarItemCampanha,
  atualizarItemCampanha,
  removerItemCampanha,
  obterProximoItemDisponivel,
  marcarItemComoEnviado,
  formatarMensagemCampanha,
  obterControleDiarioCampanhas,
  salvarControleDiarioCampanhas
};
