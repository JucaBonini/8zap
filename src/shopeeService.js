const crypto = require('crypto');
const { logProjeto } = require('./logger');

const SHOPEE_GRAPHQL_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

/**
 * Realiza a busca de produtos na Shopee usando a Shopee Affiliate Open API (GraphQL)
 * @param {object} params
 * @param {string} params.appId - App ID do Afiliado Shopee
 * @param {string} params.secret - Secret Key do Afiliado Shopee
 * @param {string} [params.keyword] - Palavra-chave ou categoria
 * @param {number} [params.limit=12] - Quantidade máxima de produtos
 * @param {number} [params.sortType=5] - Tipo de ordenação (5 = Mais Vendidos)
 * @returns {Promise<{ sucesso: boolean, produtos?: Array<object>, erro?: string, simulado?: boolean }>}
 */
async function buscarProdutosShopee({ appId, secret, keyword = 'cozinha', limit = 12, sortType = 5 }) {
  // Se não forneceu credenciais, retorna dados de demonstração para o usuário poder testar a tela
  if (!appId || !secret || !appId.trim() || !secret.trim()) {
    return {
      sucesso: true,
      simulado: true,
      mensagem: 'Modo Demonstração: Credenciais da Shopee não preenchidas. Exibindo achadinhos de exemplo para teste.',
      produtos: obterAchadinhosDemonstracao(keyword)
    };
  }

  const queryBody = `
    query {
      productOfferV2(
        keyword: "${keyword.replace(/"/g, '\\"')}",
        listType: 0,
        sortType: ${parseInt(sortType, 10) || 5},
        page: 1,
        limit: ${Math.min(parseInt(limit, 10) || 12, 30)}
      ) {
        nodes {
          itemId
          productName
          productLink
          offerLink
          imageUrl
          priceMin
          priceMax
          priceDiscountRate
          sales
          ratingStar
          commissionRate
          shopName
        }
        pageInfo {
          page
          limit
          hasNextPage
        }
      }
    }
  `;

  const payload = { query: queryBody };
  const payloadStr = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  // Assinatura oficial HMAC-SHA256 da Shopee Open API:
  // Factor = AppID + Timestamp + Payload (string compacto) + Secret
  const factor = `${appId.trim()}${timestamp}${payloadStr}${secret.trim()}`;
  const signature = crypto.createHash('sha256').update(factor).digest('hex');
  const authHeader = `SHA256 Credential=${appId.trim()},Timestamp=${timestamp},Signature=${signature}`;

  try {
    const res = await fetch(SHOPEE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: payloadStr
    });

    if (!res.ok) {
      const textoErro = await res.text().catch(() => '');
      return {
        sucesso: false,
        erro: `Falha na API da Shopee (HTTP ${res.status}): ${textoErro || res.statusText}`
      };
    }

    const data = await res.json();

    if (data.errors && data.errors.length > 0) {
      const msgErro = data.errors[0]?.message || 'Erro desconhecido retornado pela Shopee';
      return {
        sucesso: false,
        erro: `Shopee API: ${msgErro}`
      };
    }

    const nodes = data?.data?.productOfferV2?.nodes || [];

    const produtos = nodes.map((node) => {
      const precoNum = Number(node.priceMin) || 0;
      const precoFormatado = precoNum > 0 ? `R$ ${precoNum.toFixed(2).replace('.', ',')}` : 'Preço Especial';
      const desconto = node.priceDiscountRate ? `${node.priceDiscountRate}% OFF` : '';
      const estrelas = node.ratingStar ? Number(node.ratingStar).toFixed(1) : '5.0';

      return {
        itemId: String(node.itemId),
        titulo: node.productName,
        link: node.offerLink || node.productLink,
        linkOriginal: node.productLink,
        imagem: node.imageUrl,
        preco: precoFormatado,
        precoNum,
        desconto,
        vendas: node.sales || 0,
        avaliacao: estrelas,
        loja: node.shopName || 'Shopee',
        destaque: desconto ? `🔥 ${desconto} com Frete Especial` : '✨ Oferta em Destaque'
      };
    });

    return {
      sucesso: true,
      simulado: false,
      produtos
    };
  } catch (err) {
    return {
      sucesso: false,
      erro: `Erro de conexão com a API da Shopee: ${err.message}`
    };
  }
}

/**
 * Gera uma cópia persuasiva para WhatsApp usando OpenAI ou Google Gemini
 * @param {object} params
 * @param {object} params.produto
 * @param {string} [params.apiKeyOpenai]
 * @param {string} [params.apiKeyGemini]
 * @param {string} [params.provedor='openai']
 * @param {string} [params.tomVoz]
 * @returns {Promise<string>}
 */
async function gerarCopyOfertaShopee({ produto, apiKeyOpenai = '', apiKeyGemini = '', provedor = 'openai', tomVoz = '' }) {
  const promptSistema = tomVoz && tomVoz.trim()
    ? tomVoz.trim()
    : 'Você é um especialista em vendas e copywriting para grupos e canais de ofertas do WhatsApp no Brasil. Suas mensagens são dinâmicas, altamente persuasivas, usam emojis com equilíbrio e geram forte senso de urgência e oportunidade.';

  const promptUsuario = `Crie uma mensagem promocional curta, quente e irresistível para o WhatsApp para divulgar o seguinte produto:

PRODUTO: ${produto.titulo}
PREÇO: ${produto.preco}
DESTAQUE/DESCONTO: ${produto.desconto || 'Super Desconto'}
AVALIAÇÃO: ⭐ ${produto.avaliacao || '4.9'}
LINK DE COMPRA: ${produto.link}

REGRAS:
- Use negrito com asteriscos nos pontos chave (*NOME DO PRODUTO*, *PREÇO*, etc).
- Coloque uma chamada chamativa no início (ex: "🚨 *ACHADINHO IMPERDÍVEL NA SHOPEE!*").
- Destaque o benefício prático do produto em 1 ou 2 frases curtas.
- Inclua o link oficial no final com chamada clara para ação.
- NUNCA invente outros links. Retorne apenas o texto final formatado para o WhatsApp.`;

  if (provedor === 'gemini' && apiKeyGemini) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKeyGemini}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${promptSistema}\n\n${promptUsuario}` }] }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (texto && texto.trim()) return texto.trim();
      }
    } catch (_) {}
  }

  if (apiKeyOpenai) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKeyOpenai}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: promptSistema },
            { role: 'user', content: promptUsuario }
          ],
          temperature: 0.7
        })
      });
      if (res.ok) {
        const data = await res.json();
        const texto = data.choices?.[0]?.message?.content;
        if (texto && texto.trim()) return texto.trim();
      }
    } catch (_) {}
  }

  // Fallback caso não haja chave de IA disponível ou falhe
  return `🚨 *ACHADINHO IMPERDÍVEL NA SHOPEE!* 🔥\n\n🛍️ *${produto.titulo}*\n💰 *Preço:* ${produto.preco} ${produto.desconto ? `(${produto.desconto})` : ''}\n⭐ *Avaliação:* ${produto.avaliacao} estrelas\n\n👉 *Garanta o seu com desconto pelo link oficial:* 👇\n🛒 ${produto.link}`;
}

/**
 * Produtos ilustrativos para visualização e testes antes de preencher as chaves da Shopee
 */
function obterAchadinhosDemonstracao(keyword = '') {
  return [
    {
      itemId: 'shopee_demo_1',
      titulo: 'Fritadeira Elétrica Airfryer Digital 4L Antiaderente 1500W',
      link: 'https://shope.ee/exemplo-airfryer',
      linkOriginal: 'https://shopee.com.br/airfryer-digital-4l',
      imagem: 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=600&auto=format&fit=crop&q=80',
      preco: 'R$ 189,90',
      precoNum: 189.9,
      desconto: '42% OFF',
      vendas: 3420,
      avaliacao: '4.9',
      loja: 'Eletro Lar Oficial',
      destaque: '🔥 42% OFF + Frete Grátis'
    },
    {
      itemId: 'shopee_demo_2',
      titulo: 'Jogo de Panelas 5 Peças Cerâmica Antiaderente com Tampa de Vidro',
      link: 'https://shope.ee/exemplo-panelas',
      linkOriginal: 'https://shopee.com.br/jogo-panelas-ceramica',
      imagem: 'https://images.unsplash.com/photo-1584990347449-39bbf8703a45?w=600&auto=format&fit=crop&q=80',
      preco: 'R$ 129,00',
      precoNum: 129.0,
      desconto: '35% OFF',
      vendas: 1850,
      avaliacao: '4.8',
      loja: 'Casa & Conforto',
      destaque: '🔥 35% OFF'
    },
    {
      itemId: 'shopee_demo_3',
      titulo: 'Processador e Triturador Manual de Alimentos 3 Lâminas Inox 500ml',
      link: 'https://shope.ee/exemplo-triturador',
      linkOriginal: 'https://shopee.com.br/triturador-manual-alimentos',
      imagem: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=600&auto=format&fit=crop&q=80',
      preco: 'R$ 19,90',
      precoNum: 19.9,
      desconto: '50% OFF',
      vendas: 8900,
      avaliacao: '4.9',
      loja: 'Utilidades Express',
      destaque: '🔥 50% OFF - Mais Vendido'
    },
    {
      itemId: 'shopee_demo_4',
      titulo: 'Organizador Giratório Multiuso para Temperos e Cozinha 360 Graus',
      link: 'https://shope.ee/exemplo-organizador',
      linkOriginal: 'https://shopee.com.br/organizador-giratorio-temperos',
      imagem: 'https://images.unsplash.com/photo-1590794056226-79ef3a8147e1?w=600&auto=format&fit=crop&q=80',
      preco: 'R$ 34,50',
      precoNum: 34.5,
      desconto: '28% OFF',
      vendas: 2150,
      avaliacao: '4.8',
      loja: 'Lar Organizado',
      destaque: '🔥 28% OFF'
    }
  ];
}

module.exports = {
  buscarProdutosShopee,
  gerarCopyOfertaShopee
};
