const fs = require('fs');
const path = require('path');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Catálogo de gatilhos de reação de alta conversão para WhatsApp Channels
 * Cada categoria contém abordagens persuasivas testadas para maximizar reações com emojis
 */
const CATALOGO_GATILHOS = {
  culinaria: [
    '💬 *Se você quer que eu mande a versão de sobremesa amanhã, reaja com 🔥 ou ❤️!*',
    '💬 *Quer que eu poste o segredinho do molho mais tarde? Deixa um 🔥 ou 😋 aqui!*',
    '💬 *Essa receita te deu água na boca? Reaja com 😋 ou ❤️ pra eu saber!*',
    '💬 *Vai fazer essa delícia no almoço do fim de semana? Reaja com 🔥 ou 😍!*',
    '💬 *Quer mais receitas fáceis e econômicas como essa amanhã? Reaja com ❤️ ou 👍!*',
    '💬 *De 0 a 10, que nota essa receita merece? Reaja com 🔥 (10) ou ❤️ (mil)!*',
    '💬 *Você prefere no almoço ou no jantar? Reaja com 🔥 (almoço) ou ❤️ (jantar)!*',
    '💬 *Quem quer a receita secreta de acompanhamento amanhã, reaja com 🔥!*',
    '💬 *Gostou da dica da Mary de hoje? Deixe sua reação com ❤️ ou 👏 abaixo!*'
  ],
  artigos: [
    '💬 *Gostou dessa receita? Deixe sua reação abaixo (❤️ ou 🔥) para o WhatsApp sempre te entregar os pratos em primeira mão!*',
    '💬 *Quer que eu traga outra versão dessa dica amanhã? Reaja com 🔥 ou 😋!*',
    '💬 *Achou essa ideia fácil e prática? Reaja com 👏 ou ❤️ pra eu saber!*',
    '💬 *Se você quer mais dicas práticas como essa, reaja com 💡 ou ❤️!*',
    '💬 *Quer o passo a passo em vídeo na próxima? Reaja com 🔥 ou 👍!*'
  ],
  campanhas: [
    '💬 *Quer mais achadinhos úteis de cozinha em promoção? Reaja com 🔥 ou ❤️!*',
    '💬 *Gostou desse achadinho? Reaja com 😍 se compraria ou 👍 se curtiu!*',
    '💬 *Se você quer cupom de frete grátis nos próximos achados, reaja com 🔥!*'
  ],
  universal: [
    '💬 *Se você curtiu essa postagem, reaja com ❤️ ou 🔥!*',
    '💬 *Gostou do conteúdo de hoje? Deixe sua reação (❤️, 🔥 ou 👏) abaixo!*'
  ]
};

/**
 * Retorna o caminho do arquivo de configuração de gatilhos
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoConfigGatilhos(projectId) {
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `config-gatilhos-${idSanitizado}.json`);
}

/**
 * Retorna a configuração de gatilhos de reação do projeto
 * @param {string} projectId
 * @returns {object}
 */
function obterConfigGatilhos(projectId = 'Receitas') {
  const caminho = obterCaminhoConfigGatilhos(projectId);
  const isReceitas = (projectId || '').toLowerCase().includes('receita');
  const padrao = {
    ativo: true,
    modo: 'rotativo', // 'rotativo' | 'personalizado'
    textoPersonalizado: isReceitas
      ? '💬 *Se você quer que eu mande a versão de sobremesa amanhã, reaja com 🔥 ou ❤️!*'
      : '💬 *Gostou do conteúdo? Deixe sua reação abaixo com ❤️ ou 🔥!*',
    aplicarEmReceitas: isReceitas,
    aplicarEmRss: true,
    aplicarEmCampanhas: true,
    aplicarEmFilaManual: true,
    usarSeparadorVisual: true
  };

  if (!fs.existsSync(caminho)) {
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return {
      ativo: dados.ativo !== undefined ? Boolean(dados.ativo) : padrao.ativo,
      modo: dados.modo === 'personalizado' ? 'personalizado' : 'rotativo',
      textoPersonalizado: typeof dados.textoPersonalizado === 'string' && dados.textoPersonalizado.trim() ? dados.textoPersonalizado.trim() : padrao.textoPersonalizado,
      aplicarEmReceitas: dados.aplicarEmReceitas !== undefined ? Boolean(dados.aplicarEmReceitas) : padrao.aplicarEmReceitas,
      aplicarEmRss: dados.aplicarEmRss !== undefined ? Boolean(dados.aplicarEmRss) : padrao.aplicarEmRss,
      aplicarEmCampanhas: dados.aplicarEmCampanhas !== undefined ? Boolean(dados.aplicarEmCampanhas) : padrao.aplicarEmCampanhas,
      aplicarEmFilaManual: dados.aplicarEmFilaManual !== undefined ? Boolean(dados.aplicarEmFilaManual) : padrao.aplicarEmFilaManual,
      usarSeparadorVisual: dados.usarSeparadorVisual !== undefined ? Boolean(dados.usarSeparadorVisual) : padrao.usarSeparadorVisual
    };
  } catch (_) {
    return padrao;
  }
}

/**
 * Salva a configuração de gatilhos de reação do projeto
 * @param {string} projectId
 * @param {object} novaConfig
 * @returns {object}
 */
function salvarConfigGatilhos(projectId, novaConfig = {}) {
  const caminho = obterCaminhoConfigGatilhos(projectId);
  const atual = obterConfigGatilhos(projectId);

  const mesclado = {
    ...atual,
    ativo: novaConfig.ativo !== undefined ? Boolean(novaConfig.ativo) : atual.ativo,
    modo: novaConfig.modo === 'personalizado' ? 'personalizado' : 'rotativo',
    textoPersonalizado: typeof novaConfig.textoPersonalizado === 'string' ? novaConfig.textoPersonalizado.trim() : atual.textoPersonalizado,
    aplicarEmReceitas: novaConfig.aplicarEmReceitas !== undefined ? Boolean(novaConfig.aplicarEmReceitas) : atual.aplicarEmReceitas,
    aplicarEmRss: novaConfig.aplicarEmRss !== undefined ? Boolean(novaConfig.aplicarEmRss) : atual.aplicarEmRss,
    aplicarEmCampanhas: novaConfig.aplicarEmCampanhas !== undefined ? Boolean(novaConfig.aplicarEmCampanhas) : atual.aplicarEmCampanhas,
    aplicarEmFilaManual: novaConfig.aplicarEmFilaManual !== undefined ? Boolean(novaConfig.aplicarEmFilaManual) : atual.aplicarEmFilaManual,
    usarSeparadorVisual: novaConfig.usarSeparadorVisual !== undefined ? Boolean(novaConfig.usarSeparadorVisual) : atual.usarSeparadorVisual
  };

  fs.writeFileSync(caminho, JSON.stringify(mesclado, null, 2), 'utf8');
  logProjeto(projectId, 'GATILHOS_CONFIG_SALVA', 'Configurações de Gatilhos de Reação atualizadas com sucesso.', 'info');
  return mesclado;
}

/**
 * Sorteia um gatilho de reação de uma categoria
 * @param {string} categoria - 'culinaria' | 'artigos' | 'campanhas' | 'universal'
 * @returns {string}
 */
function sortearGatilhoReacao(categoria = 'culinaria') {
  const lista = CATALOGO_GATILHOS[categoria] || CATALOGO_GATILHOS.culinaria;
  const index = Math.floor(Math.random() * lista.length);
  return lista[index];
}

/**
 * Verifica se a mensagem já contém algum gatilho explícito de reação para não duplicar
 * @param {string} texto
 * @returns {boolean}
 */
function mensagemJaPossuiGatilho(texto) {
  if (!texto || typeof texto !== 'string') return false;
  const regexGatilho = /(reaja com|deixe um [❤️🔥😋👏👍]|reaja nesta|reaja abaixo|deixe sua rea[çc][aã]o|reagir com)/i;
  return regexGatilho.test(texto);
}

/**
 * Aplica o Gatilho de Reação a um texto de mensagem caso ainda não possua
 * @param {string} textoOriginal
 * @param {object} opcoes
 * @param {string} [opcoes.categoria='culinaria'] - 'culinaria' | 'artigos' | 'campanhas' | 'universal'
 * @param {string} [opcoes.projectId='Receitas']
 * @param {boolean} [opcoes.forcar=false]
 * @returns {string} Texto formatado com o gatilho de reação
 */
function aplicarGatilhoReacao(textoOriginal, opcoes = {}) {
  const {
    projectId = 'Receitas',
    forcar = false
  } = opcoes;

  const isReceitas = (projectId || '').toLowerCase().includes('receita');
  const categoria = opcoes.categoria || (isReceitas ? 'culinaria' : 'universal');

  const textoLimpo = (textoOriginal || '').trim();
  if (!textoLimpo) return textoLimpo;

  const config = obterConfigGatilhos(projectId);

  // Se estiver desativado globalmente e não for forçado
  if (!config.ativo && !forcar) {
    return textoLimpo;
  }

  // Verifica permissão por tipo de conteúdo
  if (!forcar) {
    if (categoria === 'culinaria' && !config.aplicarEmReceitas) return textoLimpo;
    if (categoria === 'artigos' && !config.aplicarEmRss) return textoLimpo;
    if (categoria === 'campanhas' && !config.aplicarEmCampanhas) return textoLimpo;
    if (categoria === 'manual' && !config.aplicarEmFilaManual) return textoLimpo;
  }

  // Se o texto já tiver chamada de reação, não duplica
  if (mensagemJaPossuiGatilho(textoLimpo)) {
    return textoLimpo;
  }

  // Define qual frase usar (personalizada ou sorteada)
  const gatilhoTexto = (config.modo === 'personalizado' && config.textoPersonalizado)
    ? config.textoPersonalizado
    : sortearGatilhoReacao(categoria);

  // Monta o texto final com espaçamento adequado
  return `${textoLimpo}\n\n${gatilhoTexto}`;
}

module.exports = {
  CATALOGO_GATILHOS,
  obterConfigGatilhos,
  salvarConfigGatilhos,
  sortearGatilhoReacao,
  mensagemJaPossuiGatilho,
  aplicarGatilhoReacao
};
