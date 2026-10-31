const fs = require('fs');
const path = require('path');
const { logProjeto } = require('./logger');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Catálogo de nichos pré-configurados com personas, templates e configurações recomendadas
 */
const CATALOGO_NICHOS = {
  culinaria: {
    id: 'culinaria',
    nome: 'Culinária & Gastronomia (Mary)',
    icone: '🍳',
    categoriaShopeePadrao: 'cozinha',
    personaPadrao: 'Você é a Mary, uma cozinheira brasileira acolhedora, prática e direta, que ensina receitas caseiras irresistíveis no WhatsApp.',
    modulosPadrao: {
      receitasIa: true,
      rss: true,
      campanhas: true,
      filaManual: true,
      facebook: true
    },
    templateRssPadrao: '🍲 *JANTAR RÁPIDO: {TITULO}*\n{abertura}\n\n_{resumo}_\n\n👉 *Toque no link oficial para ver os ingredientes e preparo completo:* 👇\n🔗 {link}\n\n📌 _Salva essa receita para quando precisar de uma ideia rápida!_',
    templateShopeePadrao: '🛒 *Achadinho da Cozinha: {titulo}*\n{destaque}\n\n{preco}\n🎟️ *Dica:* Ative o cupom de Frete Grátis na página antes de fechar!\n\n👉 *Pegue o seu com desconto aqui:* 👇\n🛒 {link}\n\n⚠️ _Preço e estoque válidos no momento da postagem._'
  },
  tecnologia: {
    id: 'tecnologia',
    nome: 'Tecnologia, Inovação & Gadgets',
    icone: '💻',
    categoriaShopeePadrao: 'eletronicos',
    personaPadrao: 'Você é um especialista em tecnologia e inovação, dinâmico e direto ao ponto, que compartilha novidades do mundo tech, truques práticos e produtos úteis no WhatsApp.',
    modulosPadrao: {
      receitasIa: false,
      rss: true,
      campanhas: true,
      filaManual: true,
      facebook: true
    },
    templateRssPadrao: '⚡ *MUNDO TECH: {TITULO}*\n\n{resumo}\n\n👉 *Leia a matéria completa no link:* 👇\n🔗 {link}\n\n💡 _Compartilhe com quem curte tecnologia!_',
    templateShopeePadrao: '🔥 *Achadinho Tech: {titulo}*\n{destaque}\n\n{preco}\n🎟️ *Dica:* Aproveite o frete grátis e cupons ativos!\n\n👉 *Acesse a oferta com desconto aqui:* 👇\n🛒 {link}\n\n⚠️ _Preço e estoque válidos no momento da postagem._'
  },
  marketing: {
    id: 'marketing',
    nome: 'Marketing Digital & Negócios',
    icone: '📈',
    categoriaShopeePadrao: 'livros',
    personaPadrao: 'Você é um estrategista de marketing e negócios digitais que traz insights práticos, estratégias de crescimento e tendências do mercado de forma objetiva.',
    modulosPadrao: {
      receitasIa: false,
      rss: true,
      campanhas: true,
      filaManual: true,
      facebook: true
    },
    templateRssPadrao: '📊 *INSIGHT DIGITAL: {TITULO}*\n\n{resumo}\n\n👉 *Confira os detalhes da estratégia:* 👇\n🔗 {link}\n\n🚀 _Aplique no seu negócio hoje mesmo!_',
    templateShopeePadrao: '📚 *Recomendação para seu Negócio: {titulo}*\n{destaque}\n\n{preco}\n\n👉 *Garanta o seu exemplar com desconto:* 👇\n🛒 {link}'
  },
  noticias: {
    id: 'noticias',
    nome: 'Notícias & Mídia Geral',
    icone: '📰',
    categoriaShopeePadrao: 'geral',
    personaPadrao: 'Você é um jornalista digital informativo, imparcial e ágil, trazendo resumos claros das notícias mais importantes do dia.',
    modulosPadrao: {
      receitasIa: false,
      rss: true,
      campanhas: false,
      filaManual: true,
      facebook: true
    },
    templateRssPadrao: '📢 *ÚLTIMAS NOTÍCIAS: {TITULO}*\n\n{resumo}\n\n👉 *Acompanhe a cobertura completa:* 👇\n🔗 {link}',
    templateShopeePadrao: '🛍️ *Destaque do Dia: {titulo}*\n{destaque}\n\n{preco}\n🔗 {link}'
  },
  achadinhos: {
    id: 'achadinhos',
    nome: 'Achadinhos, Cupons & Promoções',
    icone: '🛍️',
    categoriaShopeePadrao: 'geral',
    personaPadrao: 'Você é o caçador oficial de promoções e cupons da internet, super entusiasmado e rápido para avisar quando um produto vale muito a pena.',
    modulosPadrao: {
      receitasIa: false,
      rss: false,
      campanhas: true,
      filaManual: true,
      facebook: true
    },
    templateRssPadrao: '📢 *NOVIDADE: {TITULO}*\n\n{resumo}\n🔗 {link}',
    templateShopeePadrao: '🚨 *ACHADINHO IMPERDÍVEL: {titulo}*\n{destaque}\n\n💥 {preco}\n🎟️ *Atenção:* Resgate os cupons na página do produto antes de comprar!\n\n👉 *Acesse direto pelo link oficial:* 👇\n🛒 {link}\n\n🏃‍♂️ _Corre antes que acabe o estoque!_'
  },
  geral: {
    id: 'geral',
    nome: 'Geral / Personalizado',
    icone: '⚙️',
    categoriaShopeePadrao: 'geral',
    personaPadrao: 'Você é um comunicador acolhedor e direto, focado em entregar os melhores conteúdos para a sua comunidade no WhatsApp.',
    modulosPadrao: {
      receitasIa: false,
      rss: true,
      campanhas: true,
      filaManual: true,
      facebook: true
    },
    templateRssPadrao: '📢 *{TITULO}*\n\n{resumo}\n\n👉 *Confira a matéria completa:* 👇\n🔗 {link}',
    templateShopeePadrao: '🛒 *Dica de Oferta: {titulo}*\n{destaque}\n\n{preco}\n\n👉 *Confira no link oficial:* 👇\n🔗 {link}'
  }
};

/**
 * Retorna o caminho do arquivo de perfil do projeto
 * @param {string} projectId
 * @returns {string}
 */
function obterCaminhoPerfil(projectId) {
  const idSanitizado = (projectId || 'Receitas').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `perfil-${idSanitizado}.json`);
}

/**
 * Retorna o perfil configurado da sessão. Se não existir, gera o perfil padrão adequado.
 * @param {string} projectId
 * @returns {object}
 */
function obterPerfil(projectId) {
  const caminho = obterCaminhoPerfil(projectId);
  const idLower = (projectId || '').toLowerCase();
  const isCulinaria = idLower.includes('receita');
  const nichoPadraoId = isCulinaria ? 'culinaria' : 'geral';
  const catalogoPadrao = CATALOGO_NICHOS[nichoPadraoId];

  const padrao = {
    projectId,
    nicho: catalogoPadrao.id,
    nomeNicho: catalogoPadrao.nome,
    icone: catalogoPadrao.icone,
    persona: catalogoPadrao.personaPadrao,
    categoriaShopee: catalogoPadrao.categoriaShopeePadrao,
    modulos: { ...catalogoPadrao.modulosPadrao },
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };

  if (!fs.existsSync(caminho)) {
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return {
      projectId,
      nicho: dados.nicho || padrao.nicho,
      nomeNicho: dados.nomeNicho || padrao.nomeNicho,
      icone: dados.icone || padrao.icone,
      persona: typeof dados.persona === 'string' ? dados.persona : padrao.persona,
      categoriaShopee: dados.categoriaShopee || padrao.categoriaShopee,
      modulos: {
        receitasIa: dados.modulos?.receitasIa !== undefined ? Boolean(dados.modulos.receitasIa) : padrao.modulos.receitasIa,
        rss: dados.modulos?.rss !== undefined ? Boolean(dados.modulos.rss) : padrao.modulos.rss,
        campanhas: dados.modulos?.campanhas !== undefined ? Boolean(dados.modulos.campanhas) : padrao.modulos.campanhas,
        filaManual: dados.modulos?.filaManual !== undefined ? Boolean(dados.modulos.filaManual) : padrao.modulos.filaManual,
        facebook: dados.modulos?.facebook !== undefined ? Boolean(dados.modulos.facebook) : padrao.modulos.facebook
      },
      criadoEm: dados.criadoEm || padrao.criadoEm,
      atualizadoEm: dados.atualizadoEm || padrao.atualizadoEm
    };
  } catch (err) {
    logProjeto(projectId, 'ERRO_PERFIL', `Falha ao ler perfil da sessão: ${err.message}`, 'error');
    return padrao;
  }
}

/**
 * Salva o perfil da sessão no disco
 * @param {string} projectId
 * @param {object} novosDados
 * @returns {object}
 */
function salvarPerfil(projectId, novosDados = {}) {
  const caminho = obterCaminhoPerfil(projectId);
  const atual = obterPerfil(projectId);

  const nichoId = novosDados.nicho || atual.nicho;
  const catalogo = CATALOGO_NICHOS[nichoId] || CATALOGO_NICHOS.geral;

  const perfilFinal = {
    projectId,
    nicho: nichoId,
    nomeNicho: novosDados.nomeNicho || catalogo.nome,
    icone: catalogo.icone || '⚙️',
    persona: novosDados.persona !== undefined ? novosDados.persona : atual.persona,
    categoriaShopee: novosDados.categoriaShopee || catalogo.categoriaShopeePadrao,
    modulos: {
      receitasIa: novosDados.modulos?.receitasIa !== undefined ? Boolean(novosDados.modulos.receitasIa) : atual.modulos.receitasIa,
      rss: novosDados.modulos?.rss !== undefined ? Boolean(novosDados.modulos.rss) : atual.modulos.rss,
      campanhas: novosDados.modulos?.campanhas !== undefined ? Boolean(novosDados.modulos.campanhas) : atual.modulos.campanhas,
      filaManual: novosDados.modulos?.filaManual !== undefined ? Boolean(novosDados.modulos.filaManual) : atual.modulos.filaManual,
      facebook: novosDados.modulos?.facebook !== undefined ? Boolean(novosDados.modulos.facebook) : atual.modulos.facebook
    },
    criadoEm: atual.criadoEm,
    atualizadoEm: new Date().toISOString()
  };

  try {
    fs.writeFileSync(caminho, JSON.stringify(perfilFinal, null, 2), 'utf8');
    logProjeto(projectId, 'PERFIL_SALVO', `Perfil da sessão atualizado para o nicho "${perfilFinal.nomeNicho}".`, 'info');
    return perfilFinal;
  } catch (err) {
    logProjeto(projectId, 'ERRO_SALVAR_PERFIL', `Falha ao gravar perfil: ${err.message}`, 'error');
    throw err;
  }
}

module.exports = {
  CATALOGO_NICHOS,
  obterPerfil,
  salvarPerfil
};

