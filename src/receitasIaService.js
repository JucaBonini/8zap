const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { logProjeto } = require('./logger');

const pastaUploads = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(pastaUploads)) {
  fs.mkdirSync(pastaUploads, { recursive: true });
}

/**
 * Persona padrão da Mary para garantir receitas calorosas, humanizadas e que engajam de verdade
 */
const PERSONA_PADRAO_MARY = `Você é a Mary, uma cozinheira brasileira apaixonada, acolhedora e muito simpática, que compartilha receitas caseiras práticas e irresistíveis no WhatsApp.
Seu estilo de escrita é autêntico, humano, caloroso e animado (NUNCA pareça um robô ou um livro acadêmico de receitas).

REGRAS CRUCIAIS DE ESCRITA:
1. ABERTURA (O Gancho): Comece com uma saudação calorosa e um gancho irresistível, como: "Gente do céu, para tudo e olha essa maravilha que preparei hoje!", "Olha só o cheirinho que tá invadindo a cozinha!", "Aqui em casa quando faço esse prato não sobra nem o molho pra contar história!".
2. TÍTULO: Destaque o título do prato em caixa alta com asteriscos e emojis culinários adequados (ex: *PICADINHO DE PORCO COM LEGUMES* 🍲).
3. INGREDIENTES: Lista clara, prática, organizada com marcadores limpos (▫️ ou -) e medidas caseiras acessíveis (gramas, xícaras, colheres).
4. MODO DE PREPARO: Passo a passo descomplicado, numerado ou em tópicos curtos e fáceis de ler rapidamente no celular.
5. O SEGREDO DA MARY: Inclua sempre uma dica de ouro ou truque da Mary que faz toda a diferença no prato (ex: "*O segredinho da Mary:* doure a carne em fogo bem alto para reter o suco antes de colocar a água...").
6. RENDIMENTO E TEMPO: Indique de forma compacta (ex: ⏱️ *Preparo:* 35 min | 🍽️ *Rende:* 4 a 5 porções).
7. CHAMADA PARA AÇÃO (ENGAGAMENTO): Finalize com uma pergunta calorosa pedindo para as pessoas salvarem a receita e reagirem/comentarem (ex: "Gostou? Já salva essa receita pra fazer no fim de semana! E me conta aqui: você é do time que acompanha com arroz soltinho ou purê de batatas? 👇❤️").

NUNCA invente links externos ou hashtags robóticas em excesso.
A formatação deve ser compatível com o WhatsApp (use *negrito* e quebras de linha limpas).`;

/**
 * Prompt para orientar a geração da foto gastronômica ultra-realista
 */
const INSTRUCAO_PROMPT_FOTO = `A photo prompt in English for generating a professional, mouth-watering culinary photograph of the completed dish.
Must follow these rules:
- Ultra-realistic professional food photography, editorial culinary style.
- Shot in a cozy rustic kitchen, natural warm lighting.
- The dish should look incredibly appetizing: glistening glossy sauce, vibrant colors of vegetables, tender meat chunks, garnished with fresh chopped herbs (parsley/scallions), subtle rising steam.
- Served in a beautiful rustic cookware (like a red enameled cast-iron Dutch oven, rustic ceramic bowl, or skillet) on a clean modern dark cooktop or wooden table.
- 45-degree angle shot, shallow depth of field (bokeh background), sharp focus on the food texture.
- NO hands, NO people, NO plastic look, NO cartoonish 3D render, NO watermarks, NO text written inside the image.`;

/**
 * Gera o texto humanizado da receita usando OpenAI (ChatGPT)
 * Aplica regra rigorosa de NÃO repetição de pratos dos últimos 30 dias
 */
async function gerarComOpenAi(apiKey, modeloTexto = 'gpt-4o-mini', tema = '', personaCustom = '', pratosRecentes = []) {
  const promptSistema = (personaCustom && personaCustom.trim()) ? personaCustom.trim() : PERSONA_PADRAO_MARY;

  const listaRecentes = Array.isArray(pratosRecentes) && pratosRecentes.length > 0
    ? `\nREGRA OBRIGATÓRIA DE CARDÁPIO INÉDITO (ÚLTIMOS 30 DIAS):
Para manter o catálogo variado e com receitas únicas para o mês inteiro, é PROIBIDO repetir qualquer um dos seguintes pratos preparados nos últimos 30 dias:
- ${pratosRecentes.slice(0, 50).join('\n- ')}
Crie um prato brasileiro totalmente INÉDITO, diferente dos listados acima e irresistível!`
    : '';

  const promptUsuario = `Crie uma receita irresistível de comida caseira brasileira.
${tema && tema.trim() ? `Tema ou Prato solicitado: "${tema.trim()}".` : 'Escolha um prato clássico, muito apetitoso, popular e aconchegante para almoço, jantar ou sobremesa de família.'}
${listaRecentes}

Você deve responder ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "titulo": "Nome do prato em caixa alta",
  "mensagemWhatsApp": "Texto completo formatado da receita na voz da Mary para postar no WhatsApp com emojis e negrito"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modeloTexto,
      messages: [
        { role: 'system', content: promptSistema },
        { role: 'user', content: promptUsuario }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.75
    })
  });

  if (!res.ok) {
    const erroJson = await res.json().catch(() => ({}));
    const msg = erroJson.error?.message || res.statusText;
    if (res.status === 401) {
      throw new Error('Chave da OpenAI inválida (401 Unauthorized): Verifique se a sua chave sk-... foi copiada corretamente.');
    }
    if (res.status === 429) {
      throw new Error('Cota da OpenAI esgotada ou limite de taxa atingido (429): Verifique seus créditos em platform.openai.com/billing ou selecione o Google Gemini que é gratuito.');
    }
    throw new Error(`Falha na API da OpenAI (Texto): ${msg}`);
  }

  const jsonResposta = await res.json();
  const conteudo = jsonResposta.choices?.[0]?.message?.content;
  if (!conteudo) {
    throw new Error('A OpenAI não retornou conteúdo na resposta.');
  }

  const dados = JSON.parse(conteudo);
  return {
    titulo: dados.titulo || 'RECEITA DA MARY',
    mensagemWhatsApp: dados.mensagemWhatsApp,
    promptVisualIngles: ''
  };
}

/**
 * Gera a imagem do prato usando DALL-E 3 da OpenAI (se requisitado manualmente)
 */
async function gerarImagemOpenAi(apiKey, promptVisual) {
  const promptFinal = `${promptVisual}, authentic raw photograph, 8k resolution, culinary magazine editorial food shot, natural ambient lighting, no CGI, no 3D render, no plastic texture, no text`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: promptFinal.slice(0, 1000),
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'b64_json'
    })
  });

  if (!res.ok) {
    const erroJson = await res.json().catch(() => ({}));
    const msg = erroJson.error?.message || res.statusText;
    if (res.status === 400 && (msg.includes('billing') || msg.includes('quota'))) {
      throw new Error(`Cota do DALL-E 3 insuficiente na sua conta OpenAI: ${msg}`);
    }
    if (res.status === 429) {
      throw new Error(`Limite de taxa ou cota do DALL-E 3 atingido (429): ${msg}`);
    }
    throw new Error(`Falha na API da OpenAI (DALL-E 3): ${msg}`);
  }

  const dados = await res.json();
  const base64 = dados.data?.[0]?.b64_json;
  if (!base64) {
    throw new Error('DALL-E 3 não retornou dados de imagem em Base64.');
  }

  return Buffer.from(base64, 'base64');
}

/**
 * Gera o texto humanizado da receita usando Google Gemini
 * Aplica regra rigorosa de NÃO repetição de pratos dos últimos 30 dias
 */
async function gerarComGemini(apiKey, modeloTexto = 'gemini-2.0-flash', tema = '', personaCustom = '', pratosRecentes = []) {
  const promptSistema = (personaCustom && personaCustom.trim()) ? personaCustom.trim() : PERSONA_PADRAO_MARY;

  const listaRecentes = Array.isArray(pratosRecentes) && pratosRecentes.length > 0
    ? `\nREGRA OBRIGATÓRIA DE CARDÁPIO INÉDITO (ÚLTIMOS 30 DIAS):
Para manter o catálogo variado e com receitas únicas para o mês inteiro, é PROIBIDO repetir qualquer um dos seguintes pratos preparados nos últimos 30 dias:
- ${pratosRecentes.slice(0, 50).join('\n- ')}
Crie um prato brasileiro totalmente INÉDITO, diferente dos listados acima e irresistível!`
    : '';

  const promptUsuario = `${promptSistema}

Crie uma receita irresistível de comida caseira brasileira.
${tema && tema.trim() ? `Tema ou Prato solicitado: "${tema.trim()}".` : 'Escolha um prato clássico, muito apetitoso, popular e aconchegante para almoço, jantar ou sobremesa de família.'}
${listaRecentes}

Você deve responder ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "titulo": "Nome do prato em caixa alta",
  "mensagemWhatsApp": "Texto completo formatado da receita na voz da Mary para postar no WhatsApp com emojis e negrito"
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modeloTexto}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptUsuario }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.75
      }
    })
  });

  if (!res.ok) {
    const erroJson = await res.json().catch(() => ({}));
    throw new Error(`Falha na API do Google Gemini (Texto): ${erroJson.error?.message || res.statusText}`);
  }

  const dados = await res.json();
  const rawText = dados.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('O Gemini não retornou conteúdo na resposta.');
  }

  // Remove eventuais blocos de código ```json ... ``` se existirem
  const limpo = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(limpo);

  return {
    titulo: parsed.titulo || 'RECEITA DA MARY',
    mensagemWhatsApp: parsed.mensagemWhatsApp,
    promptVisualIngles: ''
  };
}

/**
 * Gera a imagem usando Imagen 3 do Google Gemini
 */
async function gerarImagemGemini(apiKey, promptVisual) {
  const promptFinal = `${promptVisual}, authentic raw photograph, culinary magazine editorial food shot, rich glossy sauce, vibrant colors, 45 degree angle, shallow depth of field, no CGI, no 3D render`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: promptFinal.slice(0, 800) }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '1:1'
      }
    })
  });

  if (!res.ok) {
    const erroJson = await res.json().catch(() => ({}));
    throw new Error(`Falha no Imagen 3 (Google): ${erroJson.error?.message || res.statusText}`);
  }

  const dados = await res.json();
  const b64 = dados.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    throw new Error('Imagen 3 não retornou dados de imagem válidos.');
  }

  return Buffer.from(b64, 'base64');
}

/**
 * Otimiza a imagem para ser ultra-leve (~100-140 KB) e nítida para redes 3G brasileiras
 * - Redimensiona para resolução ideal (800x800 ou 1024x1024)
 * - Comprime em JPEG progressivo com quality 80%
 * - Remove metadados desnecessários (strip EXIF)
 * @param {Buffer} bufferEntrada
 * @param {number} [resolucao=800]
 * @param {number} [qualidade=80]
 * @returns {Promise<Buffer>}
 */
async function otimizarImagemPara3G(bufferEntrada, resolucao = 800, qualidade = 80) {
  try {
    const bufferOtimizado = await sharp(bufferEntrada)
      .resize(resolucao, resolucao, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({
        quality: qualidade,
        progressive: true,
        mozjpeg: true
      })
      .toBuffer();

    return bufferOtimizado;
  } catch (err) {
    // Fallback: se por algum motivo a compressão avançada falhar, tenta jpeg padrão
    return sharp(bufferEntrada)
      .resize(resolucao, resolucao, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();
  }
}

/**
 * Salva a imagem otimizada em public/uploads/ com nome padronizado
 * @param {Buffer} bufferImagem
 * @param {string} idReceita
 * @returns {Promise<{ caminhoFisico: string, urlPublica: string, tamanhoBytes: number }>}
 */
async function salvarImagemReceita(bufferImagem, idReceita) {
  const nomeArquivo = `receita-${idReceita}.jpg`;
  const caminhoFisico = path.join(pastaUploads, nomeArquivo);

  await fs.promises.writeFile(caminhoFisico, bufferImagem);
  const stats = await fs.promises.stat(caminhoFisico);

  return {
    caminhoFisico,
    urlPublica: `/uploads/${nomeArquivo}`,
    tamanhoBytes: stats.size
  };
}

/**
 * Gera a imagem usando DALL-E 2 como alternativa caso DALL-E 3 esteja restrito por tier de faturamento
 */
async function gerarImagemDalle2(apiKey, promptVisual) {
  const promptFinal = `${promptVisual}, authentic raw photograph, culinary editorial food shot, natural ambient lighting, no CGI, no text`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'dall-e-2',
      prompt: promptFinal.slice(0, 950),
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json'
    })
  });

  if (!res.ok) {
    const erroJson = await res.json().catch(() => ({}));
    throw new Error(`Falha no DALL-E 2: ${erroJson.error?.message || res.statusText}`);
  }

  const dados = await res.json();
  const base64 = dados.data?.[0]?.b64_json;
  if (!base64) {
    throw new Error('DALL-E 2 não retornou dados de imagem em Base64.');
  }

  return Buffer.from(base64, 'base64');
}

/**
 * Baixa uma foto gastronômica de contingência condizente com o prato
 * Mapeia o título da receita para fotografias reais de alta resolução da culinária brasileira
 */
async function obterFotoCulinariaFallback(titulo = '') {
  const t = (titulo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  let fotos = [];

  if (t.includes('feijoad') || t.includes('feijao') || t.includes('tropeiro') || t.includes('tutu') || t.includes('baiao')) {
    fotos = [
      'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=1024&auto=format&fit=crop&q=80', // Feijoada / feijão preto suculento
      'https://images.unsplash.com/photo-1574484284002-952d92456975?w=1024&auto=format&fit=crop&q=80'  // Feijoada tradicional completa
    ];
  } else if (t.includes('carne') || t.includes('costela') || t.includes('bife') || t.includes('picanha') || t.includes('churrasc') || t.includes('picadinho') || t.includes('almondeg') || t.includes('moido') || t.includes('porco') || t.includes('lombo') || t.includes('suino') || t.includes('panela')) {
    fotos = [
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1024&auto=format&fit=crop&q=80', // Picadinho com molho e legumes
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1024&auto=format&fit=crop&q=80', // Carne assada suculenta
      'https://images.unsplash.com/photo-1544025162-d76694265947?w=1024&auto=format&fit=crop&q=80'  // Costela assada com barbecue/molho
    ];
  } else if (t.includes('frango') || t.includes('galinh') || t.includes('strogonoff') || t.includes('coxa') || t.includes('sobrecoxa') || t.includes('file de frango')) {
    fotos = [
      'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=1024&auto=format&fit=crop&q=80', // Frango assado dourado com batatas
      'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=1024&auto=format&fit=crop&q=80', // Strogonoff de frango cremoso
      'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=1024&auto=format&fit=crop&q=80'  // Frango crocante
    ];
  } else if (t.includes('peixe') || t.includes('moqueca') || t.includes('camarao') || t.includes('bacalha') || t.includes('tilapia') || t.includes('salmao') || t.includes('frutos do mar')) {
    fotos = [
      'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=1024&auto=format&fit=crop&q=80', // Moqueca na panela de barro
      'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=1024&auto=format&fit=crop&q=80', // Peixe grelhado com legumes
      'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=1024&auto=format&fit=crop&q=80'  // Camarão refogado com ervas
    ];
  } else if (t.includes('massa') || t.includes('macarrao') || t.includes('lasanh') || t.includes('espaguete') || t.includes('nhoque') || t.includes('pizza') || t.includes('penne') || t.includes('risoto')) {
    fotos = [
      'https://images.unsplash.com/photo-1574894709920-11b28e7367e3?w=1024&auto=format&fit=crop&q=80', // Lasanha dourada com queijo derretido
      'https://images.unsplash.com/photo-1621996346565-e3d5d6281691?w=1024&auto=format&fit=crop&q=80', // Massa caseira italiana
      'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=1024&auto=format&fit=crop&q=80'  // Espaguete à bolonhesa
    ];
  } else if (t.includes('sopa') || t.includes('caldo') || t.includes('canja') || t.includes('creme') || t.includes('mandioca') || t.includes('abobora')) {
    fotos = [
      'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=1024&auto=format&fit=crop&q=80', // Sopa cremosa
      'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=1024&auto=format&fit=crop&q=80'  // Caldo quente na tigela
    ];
  } else if (t.includes('doce') || t.includes('bolo') || t.includes('torta') || t.includes('pudim') || t.includes('chocolate') || t.includes('brigadeiro') || t.includes('pave') || t.includes('sobremesa')) {
    fotos = [
      'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=1024&auto=format&fit=crop&q=80', // Bolo de chocolate com cobertura
      'https://images.unsplash.com/photo-1587314168485-3236d6710814?w=1024&auto=format&fit=crop&q=80', // Pudim lisinho com calda
      'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=1024&auto=format&fit=crop&q=80'  // Torta doce
    ];
  } else if (t.includes('salada') || t.includes('salpicao') || t.includes('legume') || t.includes('saudavel')) {
    fotos = [
      'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1024&auto=format&fit=crop&q=80', // Salada fresca de folhas e legumes
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1024&auto=format&fit=crop&q=80'
    ];
  } else {
    // Prato clássico caseiro de comida de mãe brasileira
    fotos = [
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1024&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1024&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=1024&auto=format&fit=crop&q=80'
    ];
  }

  const urlEscolhida = fotos[Math.floor(Math.random() * fotos.length)];
  const res = await fetch(urlEscolhida);
  if (!res.ok) {
    throw new Error('Falha ao baixar foto culinária de contingência.');
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

module.exports = {
  PERSONA_PADRAO_MARY,
  gerarComOpenAi,
  gerarImagemOpenAi,
  gerarImagemDalle2,
  gerarComGemini,
  gerarImagemGemini,
  obterFotoCulinariaFallback,
  otimizarImagemPara3G,
  salvarImagemReceita
};
