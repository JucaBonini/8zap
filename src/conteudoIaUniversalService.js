const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { logProjeto } = require('./logger');

const pastaUploads = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(pastaUploads)) {
  fs.mkdirSync(pastaUploads, { recursive: true });
}

const pastaData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(pastaData)) {
  fs.mkdirSync(pastaData, { recursive: true });
}

/**
 * Formatos de conteúdos disponíveis para geração universal
 */
const FORMATOS_CONTEUDO = {
  reflexao: {
    id: 'reflexao',
    nome: 'Reflexão & Estudo Profundo',
    instrucao: 'Escreva um texto acolhedor, profundo e reflexivo. Comece com um gancho envolvente, desenvolva o ensinamento de forma clara e acessível, traga uma aplicação prática para a vida real e finalize com uma pergunta ou estímulo de reação.'
  },
  artigo: {
    id: 'artigo',
    nome: 'Artigo / Estudo em Tópicos',
    instrucao: 'Escreva um conteúdo estruturado em tópicos objetivos (bullet points limpos). Explique os conceitos passo a passo com clareza cristalina, linguagem acessível e exemplos práticos.'
  },
  dica_rapida: {
    id: 'dica_rapida',
    nome: 'Pílula de Sabedoria / Dica Prática',
    instrucao: 'Escreva uma mensagem rápida, direta ao ponto e de alto impacto (máximo 120 palavras). Ideal para leitura dinâmica em poucos segundos.'
  },
  mensagem_diaria: {
    id: 'mensagem_diaria',
    nome: 'Mensagem do Dia / Inspiração',
    instrucao: 'Escreva uma mensagem de conexão e elevação para o dia a dia da comunidade. Tom motivador, acolhedor e focado em presença, equilíbrio e sabedoria.'
  },
  copy_vendas: {
    id: 'copy_vendas',
    nome: 'Convite / Chamada para Ação',
    instrucao: 'Escreva um texto altamente persuasivo e envolvente. Apresente uma oportunidade, dor ou curiosidade, desenvolva o valor do que está sendo oferecido e conduza com forte chamada para ação (pegar material, entrar em contato ou acessar link).'
  }
};

/**
 * Retorna o caminho do histórico de conteúdos gerados para um projeto
 */
function obterCaminhoHistorico(projectId) {
  const idSanitizado = (projectId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(pastaData, `conteudos-ia-${idSanitizado}.json`);
}

/**
 * Obtém a lista de conteúdos IA gerados para a instância
 */
function obterHistorico(projectId) {
  const caminho = obterCaminhoHistorico(projectId);
  if (!fs.existsSync(caminho)) return [];
  try {
    const raw = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(raw);
    return Array.isArray(dados) ? dados : [];
  } catch (_) {
    return [];
  }
}

/**
 * Salva um novo conteúdo no histórico
 */
function salvarNoHistorico(projectId, item) {
  const caminho = obterCaminhoHistorico(projectId);
  const lista = obterHistorico(projectId);
  lista.unshift(item); // Mais recente no topo
  const limite = lista.slice(0, 100); // Mantém os últimos 100
  fs.writeFileSync(caminho, JSON.stringify(limite, null, 2), 'utf8');
  return item;
}

/**
 * Remove um item do histórico
 */
function removerDoHistorico(projectId, id) {
  const caminho = obterCaminhoHistorico(projectId);
  const lista = obterHistorico(projectId);
  const filtrados = lista.filter(item => item.id !== id);
  fs.writeFileSync(caminho, JSON.stringify(filtrados, null, 2), 'utf8');
  return true;
}

/**
 * Otimiza a imagem para padrão WhatsApp (JPEG progressivo, leve e de alta qualidade)
 */
async function otimizarImagem(bufferEntrada, resolucao = 800, qualidade = 80) {
  try {
    return await sharp(bufferEntrada)
      .resize(resolucao, resolucao, { fit: 'cover', position: 'center' })
      .jpeg({ quality: qualidade, progressive: true, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    return await sharp(bufferEntrada)
      .resize(resolucao, resolucao, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();
  }
}

/**
 * Monta o prompt de sistema e usuário para a IA
 */
function montarPrompts({ tema, formato, personaCustom, nichoNome }) {
  const formatoConfig = FORMATOS_CONTEUDO[formato] || FORMATOS_CONTEUDO.reflexao;
  
  const personaBase = (personaCustom && personaCustom.trim())
    ? personaCustom.trim()
    : 'Você é um comunicador acolhedor, sábio e direto ao ponto, que compartilha ensinamentos e insights de alto valor no WhatsApp.';

  const promptSistema = `${personaBase}

REGRAS DE CONDUTA E ESTILO PARA WHATSAPP:
- Escreva em português do Brasil impecável, acolhedor e natural (NUNCA soe como um robô enciclopédico).
- Formatação 100% WhatsApp: use *negrito* para ênfases e títulos, _itálico_ para ganchos ou pensamentos.
- Emojis equilibrados e contextuais (sem exageros).
- Parágrafos curtos (máximo 3 a 4 linhas por bloco) para leitura agradável no celular.
- NUNCA use termos de culinária, comida ou receitas, a menos que o tema explicitamente peça isso.
- Finalize sempre estimulando interação/reação no WhatsApp (ex: reaja com ❤️ ou 🔥).`;

  const promptUsuario = `Crie um conteúdo completo e envolvente sobre o seguinte tema:
Tema Solicitado: "${tema}"
Segmento/Nicho: ${nichoNome || 'Geral'}
Formato Desejado: ${formatoConfig.nome} - ${formatoConfig.instrucao}

ESTRUTURA DO CONTEÚDO NO WHATSAPP:
1. Linha 1: Título de forte impacto em caixa alta com emoji relevante (Ex: ✨ *O PODER OCULTO DO SILÊNCIO*)
2. Linha 2: Subtítulo ou gancho instigante em _itálico_
3. Linhas seguintes: O desenvolvimento do conteúdo no formato solicitado, fluido e inspirador.
4. Linha final: Chamada acolhedora para o leitor reagir com emoji (❤️, 🔥 ou 💡).

Além do texto em português, forneça um prompt descritivo em inglês ("promptVisualIngles") de 1 frase para uma foto/arte artística e atmosférica que combine com o tema, SEM texto escrito, fotorealista ou arte de alto nível visual.

Você deve responder ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "titulo": "Título curto do post",
  "mensagemWhatsApp": "Texto completo formatado da mensagem para envio no WhatsApp",
  "promptVisualIngles": "Visual photo prompt in English for image generation without text"
}`;

  return { promptSistema, promptUsuario };
}

/**
 * Gera texto usando OpenAI (ChatGPT)
 */
async function gerarTextoOpenAi({ apiKey, modeloTexto = 'gpt-4o-mini', tema, formato, personaCustom, nichoNome }) {
  const { promptSistema, promptUsuario } = montarPrompts({ tema, formato, personaCustom, nichoNome });

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
    const errJson = await res.json().catch(() => ({}));
    const msg = errJson.error?.message || res.statusText;
    if (res.status === 401) throw new Error('Chave da OpenAI inválida (401 Unauthorized). Verifique sua API Key.');
    if (res.status === 429) throw new Error('Cota da OpenAI esgotada ou limite de taxa atingido (429).');
    throw new Error(`Falha na OpenAI: ${msg}`);
  }

  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) throw new Error('A OpenAI não retornou conteúdo na resposta.');

  const dados = JSON.parse(raw);
  return {
    titulo: dados.titulo || tema.slice(0, 40),
    mensagemWhatsApp: dados.mensagemWhatsApp,
    promptVisualIngles: dados.promptVisualIngles || `${tema}, aesthetic atmospheric conceptual art, high quality, 8k, cinematic lighting, no text`
  };
}

/**
 * Gera imagem usando DALL-E 3 da OpenAI
 */
async function gerarImagemOpenAi(apiKey, promptVisual) {
  const promptFinal = `${promptVisual}, authentic cinematic high quality, beautiful atmospheric lighting, highly aesthetic composition, photorealistic 8k, no text, no watermark, no letters`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: promptFinal.slice(0, 950),
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'b64_json'
    })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(`Falha no DALL-E 3: ${errJson.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const base64 = data.data?.[0]?.b64_json;
  if (!base64) throw new Error('DALL-E 3 não retornou dados de imagem em Base64.');
  return Buffer.from(base64, 'base64');
}

/**
 * Gera texto usando Google Gemini
 */
async function gerarTextoGemini({ apiKey, modeloTexto = 'gemini-2.0-flash', tema, formato, personaCustom, nichoNome }) {
  const { promptSistema, promptUsuario } = montarPrompts({ tema, formato, personaCustom, nichoNome });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modeloTexto}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${promptSistema}\n\n---\n\n${promptUsuario}` }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.75
      }
    })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(`Falha no Google Gemini: ${errJson.error?.message || res.statusText}`);
  }

  const dados = await res.json();
  const rawText = dados.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('O Gemini não retornou conteúdo na resposta.');

  const limpo = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(limpo);

  return {
    titulo: parsed.titulo || tema.slice(0, 40),
    mensagemWhatsApp: parsed.mensagemWhatsApp,
    promptVisualIngles: parsed.promptVisualIngles || `${tema}, aesthetic atmospheric conceptual art, high quality, 8k, cinematic lighting, no text`
  };
}

/**
 * Gera imagem usando Google Imagen 3
 */
async function gerarImagemGemini(apiKey, promptVisual) {
  const promptFinal = `${promptVisual}, authentic cinematic high quality, beautiful atmospheric lighting, highly aesthetic composition, photorealistic 8k, no text, no watermark, no letters`;
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
    const errJson = await res.json().catch(() => ({}));
    throw new Error(`Falha no Imagen 3: ${errJson.error?.message || res.statusText}`);
  }

  const dados = await res.json();
  const b64 = dados.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen 3 não retornou dados de imagem.');
  return Buffer.from(b64, 'base64');
}

/**
 * Função mestre para gerar um conteúdo universal com IA
 */
async function gerarConteudoUniversal(projectId, opcoes = {}) {
  const {
    tema,
    formato = 'reflexao',
    gerarImagem = false,
    provedor = '', // Se vazio, pega da config
    apiKeyOpenai = '',
    apiKeyGemini = '',
    personaCustom = ''
  } = opcoes;

  if (!tema || !tema.trim()) {
    throw new Error('O tema ou assunto do conteúdo é obrigatório.');
  }

  const perfilManager = require('./perfilManager');
  const perfil = perfilManager.obterPerfil(projectId);

  // Obtém chaves salvas na configuração
  let chavesConfig = {};
  try {
    const receitasManager = require('./receitasManager');
    chavesConfig = receitasManager.obterConfigReceitas(projectId);
  } catch (_) {}

  const keyOpenaiFinal = apiKeyOpenai || chavesConfig.apiKeyOpenai || process.env.OPENAI_API_KEY || '';
  const keyGeminiFinal = apiKeyGemini || chavesConfig.apiKeyGemini || process.env.GEMINI_API_KEY || '';
  const provedorFinal = provedor || chavesConfig.provedor || (keyGeminiFinal && !keyOpenaiFinal ? 'gemini' : 'openai');

  const personaFinal = personaCustom || perfil.persona || '';

  logProjeto(projectId, 'IA_UNIVERSAL_GERANDO', `Iniciando geração de conteúdo IA. Tema: "${tema}", Formato: ${formato}, Provedor: ${provedorFinal}`, 'info');

  let resultadoTexto = null;

  if (provedorFinal === 'gemini') {
    if (!keyGeminiFinal) {
      throw new Error('Chave da API do Google Gemini não configurada. Insira sua chave nos Ajustes ou no formulário.');
    }
    resultadoTexto = await gerarTextoGemini({
      apiKey: keyGeminiFinal,
      tema: tema.trim(),
      formato,
      personaCustom: personaFinal,
      nichoNome: perfil.nichoNome || perfil.nicho
    });
  } else {
    if (!keyOpenaiFinal) {
      throw new Error('Chave da API da OpenAI não configurada. Insira sua chave nos Ajustes ou no formulário.');
    }
    resultadoTexto = await gerarTextoOpenAi({
      apiKey: keyOpenaiFinal,
      tema: tema.trim(),
      formato,
      personaCustom: personaFinal,
      nichoNome: perfil.nichoNome || perfil.nicho
    });
  }

  let urlImagemFinal = null;

  if (gerarImagem) {
    try {
      logProjeto(projectId, 'IA_UNIVERSAL_IMAGEM', `Gerando imagem ilustrativa com IA (${provedorFinal})...`, 'info');
      let bufferBruto = null;
      if (provedorFinal === 'gemini') {
        bufferBruto = await gerarImagemGemini(keyGeminiFinal, resultadoTexto.promptVisualIngles);
      } else {
        bufferBruto = await gerarImagemOpenAi(keyOpenaiFinal, resultadoTexto.promptVisualIngles);
      }

      const bufferOtimizado = await otimizarImagem(bufferBruto, 800, 80);
      const nomeArquivo = `ia-universal-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
      const caminhoSalvar = path.join(pastaUploads, nomeArquivo);
      fs.writeFileSync(caminhoSalvar, bufferOtimizado);
      urlImagemFinal = `/uploads/${nomeArquivo}`;
    } catch (errImg) {
      logProjeto(projectId, 'IA_UNIVERSAL_IMAGEM_AVISO', `Aviso: Falha ao gerar imagem (${errImg.message}). O texto foi gerado com sucesso.`, 'warn');
    }
  }

  const idConteudo = `conteudo_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const novoItem = {
    id: idConteudo,
    projectId,
    titulo: resultadoTexto.titulo,
    textoWhatsApp: resultadoTexto.mensagemWhatsApp,
    urlImagem: urlImagemFinal,
    tema: tema.trim(),
    formato,
    provedor: provedorFinal,
    criadoEm: new Date().toISOString()
  };

  salvarNoHistorico(projectId, novoItem);
  logProjeto(projectId, 'IA_UNIVERSAL_SUCESSO', `Conteúdo "${novoItem.titulo}" gerado e salvo com sucesso!`, 'info');

  return novoItem;
}

module.exports = {
  FORMATOS_CONTEUDO,
  gerarConteudoUniversal,
  obterHistorico,
  removerDoHistorico
};
