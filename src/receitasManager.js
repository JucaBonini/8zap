const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logProjeto } = require('./logger');
const { comLockProjeto } = require('./agendador');
const sessionManager = require('./sessionManager');
const destinosManager = require('./destinos');
const receitasIaService = require('./receitasIaService');

const diretorioData = path.join(__dirname, '..', 'data');
if (!fs.existsSync(diretorioData)) {
  fs.mkdirSync(diretorioData, { recursive: true });
}

/**
 * Retorna o caminho do arquivo de configuração de receitas do projeto
 */
function obterCaminhoConfigReceitas(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `config-receitas-${idSanitizado}.json`);
}

/**
 * Retorna o caminho do catálogo de receitas do projeto
 */
function obterCaminhoReceitas(projectId) {
  const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(diretorioData, `receitas-${idSanitizado}.json`);
}

/**
 * Retorna a configuração de receitas do projeto
 */
function obterConfigReceitas(projectId) {
  const caminho = obterCaminhoConfigReceitas(projectId);
  const padrao = {
    ativo: false,
    provedor: 'openai', // 'openai' ou 'gemini'
    apiKeyOpenai: process.env.OPENAI_API_KEY || '',
    apiKeyGemini: process.env.GEMINI_API_KEY || '',
    modeloTextoOpenai: 'gpt-4o-mini',
    modeloTextoGemini: 'gemini-2.0-flash',
    resolucaoImagem: 800, // 800 ou 1024
    qualidadeCompressao: 80,
    destinos: [],
    personaCustom: ''
  };

  if (!fs.existsSync(caminho)) {
    return padrao;
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const dados = JSON.parse(conteudo);
    return {
      ativo: Boolean(dados.ativo),
      provedor: dados.provedor === 'gemini' ? 'gemini' : 'openai',
      apiKeyOpenai: dados.apiKeyOpenai || process.env.OPENAI_API_KEY || '',
      apiKeyGemini: dados.apiKeyGemini || process.env.GEMINI_API_KEY || '',
      modeloTextoOpenai: dados.modeloTextoOpenai || 'gpt-4o-mini',
      modeloTextoGemini: dados.modeloTextoGemini || 'gemini-2.0-flash',
      resolucaoImagem: Number(dados.resolucaoImagem) || 800,
      qualidadeCompressao: Number(dados.qualidadeCompressao) || 80,
      destinos: Array.isArray(dados.destinos) ? dados.destinos : [],
      personaCustom: typeof dados.personaCustom === 'string' ? dados.personaCustom : ''
    };
  } catch (err) {
    return padrao;
  }
}

/**
 * Salva a configuração de receitas do projeto
 */
function salvarConfigReceitas(projectId, novaConfig) {
  const caminho = obterCaminhoConfigReceitas(projectId);
  const configAtual = obterConfigReceitas(projectId);

  const mesclado = {
    ...configAtual,
    ...novaConfig
  };

  fs.writeFileSync(caminho, JSON.stringify(mesclado, null, 2), 'utf8');
  logProjeto(projectId, 'RECEITAS_CONFIG', 'Configurações do módulo de Receitas IA salvas com sucesso.', 'info');
  return mesclado;
}

/**
 * Obtém todas as receitas salvas do projeto
 */
function obterReceitas(projectId) {
  const caminho = obterCaminhoReceitas(projectId);
  if (!fs.existsSync(caminho)) {
    return [];
  }

  try {
    const conteudo = fs.readFileSync(caminho, 'utf8');
    const lista = JSON.parse(conteudo);
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

/**
 * Grava a lista de receitas no disco
 */
function salvarReceitas(projectId, lista) {
  const caminho = obterCaminhoReceitas(projectId);
  fs.writeFileSync(caminho, JSON.stringify(lista, null, 2), 'utf8');
}

/**
 * Gera uma nova receita completa com texto na voz da Mary + foto apetitosa otimizada para 3G
 * @param {string} projectId
 * @param {object} [opcoes] - { tema, personaCustom, provedor, resolucao }
 */
async function gerarReceita(projectId, opcoes = {}) {
  const config = obterConfigReceitas(projectId);
  const provedor = opcoes.provedor || config.provedor || 'openai';
  const resolucao = Number(opcoes.resolucao) || config.resolucaoImagem || 800;
  const qualidade = Number(config.qualidadeCompressao) || 80;
  const personaCustom = opcoes.personaCustom || config.personaCustom || '';
  const tema = opcoes.tema || '';

  const apiKeyOpenai = (opcoes.apiKeyOpenai || config.apiKeyOpenai || process.env.OPENAI_API_KEY || '').trim();
  const apiKeyGemini = (opcoes.apiKeyGemini || config.apiKeyGemini || process.env.GEMINI_API_KEY || '').trim();

  // Se o usuário enviou uma chave nas opções da requisição, salva para o projeto
  if (opcoes.apiKeyOpenai || opcoes.apiKeyGemini) {
    try {
      salvarConfigReceitas(projectId, {
        apiKeyOpenai,
        apiKeyGemini,
        provedor
      });
    } catch (_) {}
  }

  const idReceita = crypto.randomUUID();

  logProjeto(
    projectId,
    'RECEITAS_GERANDO',
    `Iniciando geração de receita com IA [${provedor.toUpperCase()}]... ${tema ? `Tema: "${tema}"` : '(Prato surpresa da Mary)'}`,
    'info'
  );

  let resultadoTexto;
  let bufferBrutoImagem;

  if (provedor === 'gemini') {
    const apiKey = apiKeyGemini;
    if (!apiKey) {
      throw new Error('Chave da API do Google Gemini não configurada. Insira sua chave Gemini no painel.');
    }

    resultadoTexto = await receitasIaService.gerarComGemini(
      apiKey,
      config.modeloTextoGemini,
      tema,
      personaCustom
    );

    logProjeto(
      projectId,
      'RECEITAS_TEXTO_OK',
      `Receita "${resultadoTexto.titulo}" criada pelo Gemini! Gerando fotografia gastronômica...`,
      'info'
    );

    // Gera a imagem usando Imagen 3 (ou fallback para OpenAI se configurada)
    try {
      bufferBrutoImagem = await receitasIaService.gerarImagemGemini(
        apiKey,
        resultadoTexto.promptVisualIngles
      );
    } catch (errGeminiImg) {
      logProjeto(
        projectId,
        'RECEITAS_AVISO_IMAGEM',
        `Aviso no Imagen 3: ${errGeminiImg.message}. Verificando se há chave OpenAI de contingência...`,
        'warn'
      );
      if (config.apiKeyOpenai) {
        bufferBrutoImagem = await receitasIaService.gerarImagemOpenAi(
          config.apiKeyOpenai,
          resultadoTexto.promptVisualIngles
        );
      } else {
        throw errGeminiImg;
      }
    }
  } else {
    // Provedor padrão: OpenAI (ChatGPT + DALL-E 3)
    const apiKey = apiKeyOpenai;
    if (!apiKey) {
      throw new Error('Chave da API da OpenAI (ChatGPT) não configurada. Insira sua OpenAI API Key no painel.');
    }

    resultadoTexto = await receitasIaService.gerarComOpenAi(
      apiKey,
      config.modeloTextoOpenai,
      tema,
      personaCustom
    );

    logProjeto(
      projectId,
      'RECEITAS_TEXTO_OK',
      `Receita "${resultadoTexto.titulo}" criada pela OpenAI! Gerando fotografia com DALL-E 3...`,
      'info'
    );

    let provedorFinal = 'dall-e-3';
    try {
      bufferBrutoImagem = await receitasIaService.gerarImagemOpenAi(
        apiKey,
        resultadoTexto.promptVisualIngles
      );
    } catch (errDalle3) {
      logProjeto(
        projectId,
        'RECEITAS_AVISO_DALLE3',
        `Aviso no DALL-E 3: ${errDalle3.message}. Tentando DALL-E 2...`,
        'warn'
      );
      try {
        bufferBrutoImagem = await receitasIaService.gerarImagemDalle2(
          apiKey,
          resultadoTexto.promptVisualIngles
        );
        provedorFinal = 'dall-e-2';
      } catch (errDalle2) {
        logProjeto(
          projectId,
          'RECEITAS_AVISO_DALLE2',
          `DALL-E 2 também indisponível na conta. Buscando foto fiel para "${resultadoTexto.titulo}" no acervo curado...`,
          'warn'
        );
        bufferBrutoImagem = await receitasIaService.obterFotoCulinariaFallback(resultadoTexto.titulo);
        provedorFinal = 'curadoria';
      }
    }
  }

  // Otimiza a foto para ficar levíssima (~90-130 KB) e nítida para o 3G brasileiro
  logProjeto(projectId, 'RECEITAS_OTIMIZANDO', `Comprimindo foto para ${resolucao}x${resolucao} (JPEG Progressivo / 3G)...`, 'info');
  const bufferOtimizado = await receitasIaService.otimizarImagemPara3G(bufferBrutoImagem, resolucao, qualidade);
  const infoArquivo = await receitasIaService.salvarImagemReceita(bufferOtimizado, idReceita);

  const novaReceita = {
    id: idReceita,
    titulo: resultadoTexto.titulo,
    texto: resultadoTexto.mensagemWhatsApp,
    promptVisual: resultadoTexto.promptVisualIngles,
    imagemUrl: infoArquivo.urlPublica,
    imagemCaminhoFisico: infoArquivo.caminhoFisico,
    tamanhoBytes: infoArquivo.tamanhoBytes,
    resolucao: `${resolucao}x${resolucao}`,
    provedor: provedorFinal,
    status: 'pronto',
    enviadoEm: null,
    destinosEnviados: [],
    criadoEm: new Date().toISOString()
  };

  // Salva no banco de receitas com lock atômico
  await comLockProjeto(projectId, async () => {
    const lista = obterReceitas(projectId);
    lista.unshift(novaReceita);
    salvarReceitas(projectId, lista);
  });

  const tamanhoKb = (infoArquivo.tamanhoBytes / 1024).toFixed(1);
  logProjeto(
    projectId,
    'RECEITAS_SUCESSO',
    `Receita "${novaReceita.titulo}" gerada com sucesso! Foto salva: ${tamanhoKb} KB (Ultra-leve).`,
    'success'
  );

  return novaReceita;
}

/**
 * Gera um lote de receitas com temas pré-definidos ou automáticos
 * @param {string} projectId
 * @param {object} param1 - { quantidade, temas }
 */
async function gerarLoteReceitas(projectId, { quantidade = 5, temas = [], apiKeyOpenai, apiKeyGemini, provedor } = {}) {
  const qtdFinal = Math.min(Math.max(Number(quantidade) || 1, 1), 50);
  const receitasCriadas = [];

  logProjeto(projectId, 'RECEITAS_LOTE_INICIO', `Iniciando geração em lote de ${qtdFinal} receitas...`, 'info');

  for (let i = 0; i < qtdFinal; i++) {
    const temaAtual = temas[i] || '';
    try {
      const rec = await gerarReceita(projectId, { tema: temaAtual, apiKeyOpenai, apiKeyGemini, provedor });
      receitasCriadas.push(rec);

      // Pequena pausa amigável para evitar rate-limit
      if (i < qtdFinal - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    } catch (err) {
      logProjeto(projectId, 'RECEITAS_LOTE_ERRO', `Erro no item ${i + 1}/${qtdFinal}: ${err.message}`, 'error');
    }
  }

  logProjeto(
    projectId,
    'RECEITAS_LOTE_FIM',
    `Lote finalizado! ${receitasCriadas.length} de ${qtdFinal} receitas foram geradas e estão disponíveis no catálogo.`,
    'success'
  );

  return receitasCriadas;
}

/**
 * Atualiza o texto, título e/ou foto de uma receita
 */
async function atualizarReceita(projectId, receitaId, novosDados = {}) {
  return comLockProjeto(projectId, async () => {
    const lista = obterReceitas(projectId);
    const index = lista.findIndex((r) => r.id === receitaId);
    if (index === -1) {
      throw new Error(`Receita ID "${receitaId}" não encontrada.`);
    }

    if (novosDados.titulo) lista[index].titulo = novosDados.titulo.trim();
    if (novosDados.texto) lista[index].texto = novosDados.texto.trim();

    // Se o usuário enviou uma nova foto (Upload de arquivo em Base64 ou URL)
    if (novosDados.novaImagemBase64) {
      const base64Limpo = novosDados.novaImagemBase64.replace(/^data:image\/\w+;base64,/, '');
      const bufferBruto = Buffer.from(base64Limpo, 'base64');
      const resolucao = Number(lista[index].resolucao?.split('x')[0]) || 800;
      const bufferOtimizado = await receitasIaService.otimizarImagemPara3G(bufferBruto, resolucao, 80);
      const infoArquivo = await receitasIaService.salvarImagemReceita(bufferOtimizado, receitaId);
      lista[index].imagemUrl = `${infoArquivo.urlPublica}?t=${Date.now()}`;
      lista[index].imagemCaminhoFisico = infoArquivo.caminhoFisico;
      lista[index].tamanhoBytes = infoArquivo.tamanhoBytes;
      lista[index].provedor = 'usuario';
      logProjeto(projectId, 'RECEITAS_FOTO_ALTERADA', `Foto da receita "${lista[index].titulo}" atualizada por upload.`, 'info');
    } else if (novosDados.novaImagemUrl && novosDados.novaImagemUrl.trim()) {
      const url = novosDados.novaImagemUrl.trim();
      if (!url.startsWith('/uploads/')) {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error('Não foi possível baixar a imagem da URL fornecida.');
        }
        const ab = await res.arrayBuffer();
        const bufferBruto = Buffer.from(ab);
        const resolucao = Number(lista[index].resolucao?.split('x')[0]) || 800;
        const bufferOtimizado = await receitasIaService.otimizarImagemPara3G(bufferBruto, resolucao, 80);
        const infoArquivo = await receitasIaService.salvarImagemReceita(bufferOtimizado, receitaId);
        lista[index].imagemUrl = `${infoArquivo.urlPublica}?t=${Date.now()}`;
        lista[index].imagemCaminhoFisico = infoArquivo.caminhoFisico;
        lista[index].tamanhoBytes = infoArquivo.tamanhoBytes;
        lista[index].provedor = 'usuario';
        logProjeto(projectId, 'RECEITAS_FOTO_ALTERADA', `Foto da receita "${lista[index].titulo}" atualizada por link externo.`, 'info');
      }
    }

    salvarReceitas(projectId, lista);
    return lista[index];
  });
}

/**
 * Exclui uma receita e seu arquivo de foto associado
 */
async function excluirReceita(projectId, receitaId) {
  return comLockProjeto(projectId, async () => {
    const lista = obterReceitas(projectId);
    const receita = lista.find((r) => r.id === receitaId);

    if (receita && receita.imagemCaminhoFisico && fs.existsSync(receita.imagemCaminhoFisico)) {
      try {
        fs.unlinkSync(receita.imagemCaminhoFisico);
      } catch (_) {}
    }

    const filtrada = lista.filter((r) => r.id !== receitaId);
    salvarReceitas(projectId, filtrada);
    logProjeto(projectId, 'RECEITAS_EXCLUIDA', `Receita ID ${receitaId} excluída.`, 'info');
    return { sucesso: true };
  });
}

/**
 * Regera somente a foto com IA para uma receita já existente
 */
async function regerarImagemReceita(projectId, receitaId) {
  const config = obterConfigReceitas(projectId);
  const lista = obterReceitas(projectId);
  const receita = lista.find((r) => r.id === receitaId);

  if (!receita) {
    throw new Error(`Receita ID "${receitaId}" não encontrada.`);
  }

  logProjeto(projectId, 'RECEITAS_REGERANDO_FOTO', `Regerando foto culinária para "${receita.titulo}"...`, 'info');

  const provedor = config.provedor || 'openai';
  let bufferBruto;
  let provedorFoto = 'dall-e-3';

  if (provedor === 'gemini') {
    try {
      bufferBruto = await receitasIaService.gerarImagemGemini(config.apiKeyGemini, receita.promptVisual);
      provedorFoto = 'gemini';
    } catch (_) {
      try {
        bufferBruto = await receitasIaService.obterFotoCulinariaFallback(receita.titulo);
        provedorFoto = 'curadoria';
      } catch (e) {
        throw _;
      }
    }
  } else {
    try {
      bufferBruto = await receitasIaService.gerarImagemOpenAi(config.apiKeyOpenai, receita.promptVisual);
      provedorFoto = 'dall-e-3';
    } catch (errD3) {
      try {
        bufferBruto = await receitasIaService.gerarImagemDalle2(config.apiKeyOpenai, receita.promptVisual);
        provedorFoto = 'dall-e-2';
      } catch (errD2) {
        bufferBruto = await receitasIaService.obterFotoCulinariaFallback(receita.titulo);
        provedorFoto = 'curadoria';
      }
    }
  }

  const resolucao = Number(config.resolucaoImagem) || 800;
  const qualidade = Number(config.qualidadeCompressao) || 80;
  const bufferOtimizado = await receitasIaService.otimizarImagemPara3G(bufferBruto, resolucao, qualidade);
  const infoArquivo = await receitasIaService.salvarImagemReceita(bufferOtimizado, receita.id);

  return comLockProjeto(projectId, async () => {
    const listaAtualizada = obterReceitas(projectId);
    const rec = listaAtualizada.find((r) => r.id === receitaId);
    if (rec) {
      rec.imagemUrl = `${infoArquivo.urlPublica}?t=${Date.now()}`;
      rec.imagemCaminhoFisico = infoArquivo.caminhoFisico;
      rec.tamanhoBytes = infoArquivo.tamanhoBytes;
      rec.provedor = provedorFoto;
      salvarReceitas(projectId, listaAtualizada);
    }
    return rec;
  });
}

/**
 * Dispara uma receita específica para os destinos selecionados no WhatsApp
 */
async function dispararReceitaAgora(projectId, receitaId, destinosSobrescritos = null) {
  const lista = obterReceitas(projectId);
  const receita = lista.find((r) => r.id === receitaId);

  if (!receita) {
    throw new Error(`Receita ID "${receitaId}" não encontrada.`);
  }

  const config = obterConfigReceitas(projectId);
  const destinos = (Array.isArray(destinosSobrescritos) && destinosSobrescritos.length > 0)
    ? destinosSobrescritos
    : config.destinos;

  if (!destinos || destinos.length === 0) {
    throw new Error('Nenhum canal/grupo de destino configurado para o envio.');
  }

  logProjeto(projectId, 'RECEITAS_DISPARANDO', `Disparando receita "${receita.titulo}" para ${destinos.length} destino(s)...`, 'info');

  const resultados = [];
  for (const destino of destinos) {
    try {
      const res = await sessionManager.enviarMensagem(projectId, {
        to: destino,
        type: 'imagem',
        url: receita.imagemCaminhoFisico || receita.imagemUrl,
        legenda: receita.texto
      });
      resultados.push({ destino, sucesso: true, id: res.mensagemId });
    } catch (err) {
      resultados.push({ destino, sucesso: false, erro: err.message });
      logProjeto(projectId, 'RECEITAS_ERRO_DESTINO', `Falha ao enviar para ${destino}: ${err.message}`, 'error');
    }
  }

  // Atualiza status da receita
  await comLockProjeto(projectId, async () => {
    const listaAtualizada = obterReceitas(projectId);
    const rec = listaAtualizada.find((r) => r.id === receitaId);
    if (rec) {
      rec.status = 'enviado';
      rec.enviadoEm = new Date().toISOString();
      rec.destinosEnviados = destinos;
      salvarReceitas(projectId, listaAtualizada);
    }
  });

  return { sucesso: true, resultados };
}

/**
 * Usado pela Grade Diária Mestra quando chega um horário com origem "receitas":
 * Pega a próxima receita pronta da esteira e dispara automaticamente para os canais da grade.
 * Se a esteira estiver vazia, gera uma nova receita apetitosa na hora e dispara!
 */
async function dispararProximaReceita(projectId, destinosGrade = null) {
  const config = obterConfigReceitas(projectId);
  const destinosFinais = (Array.isArray(destinosGrade) && destinosGrade.length > 0)
    ? destinosGrade
    : config.destinos;

  if (!destinosFinais || destinosFinais.length === 0) {
    throw new Error('Nenhum destino de canal definido para o disparo de receitas da Grade Diária.');
  }

  const lista = obterReceitas(projectId);
  // Procura a primeira receita com status 'pronto' que ainda não foi enviada
  let proximaReceita = lista.find((r) => r.status === 'pronto');

  if (!proximaReceita) {
    logProjeto(
      projectId,
      'GRADE_RECEITAS_ESTEIRA_VAZIA',
      'Nenhuma receita em espera na esteira. Gerando automaticamente nova receita com a Mary...',
      'info'
    );
    proximaReceita = await gerarReceita(projectId);
  }

  return dispararReceitaAgora(projectId, proximaReceita.id, destinosFinais);
}

/**
 * Adiciona a receita como um post na Fila Manual (agendador.js)
 */
async function adicionarAFilaManual(projectId, receitaId, agendadoPara = null) {
  const agendador = require('./agendador');
  const lista = obterReceitas(projectId);
  const receita = lista.find((r) => r.id === receitaId);

  if (!receita) {
    throw new Error(`Receita ID "${receitaId}" não encontrada.`);
  }

  const itemFila = {
    tipo: 'image',
    url: receita.imagemUrl,
    legenda: receita.texto,
    agendado_para: agendadoPara || null,
    esteira: !agendadoPara // se não tiver data específica, vai para a esteira buffer da grade
  };

  const resultado = await agendador.adicionarItemFila(projectId, itemFila);
  logProjeto(projectId, 'RECEITAS_ENVIADA_FILA', `Receita "${receita.titulo}" adicionada à Fila Manual / Esteira.`, 'info');
  return resultado;
}

/**
 * Testa a conexão com a API da IA (OpenAI ou Gemini)
 */
async function testarChaveIa(projectId, { provedor = 'openai', apiKeyOpenai, apiKeyGemini } = {}) {
  const config = obterConfigReceitas(projectId);
  const prov = provedor || config.provedor || 'openai';

  if (prov === 'gemini') {
    const key = (apiKeyGemini || config.apiKeyGemini || process.env.GEMINI_API_KEY || '').trim();
    if (!key) {
      throw new Error('Nenhuma chave do Google Gemini foi informada.');
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google Gemini rejeitou a chave: ${err.error?.message || res.statusText}`);
    }
    if (apiKeyGemini) {
      try {
        salvarConfigReceitas(projectId, { apiKeyGemini: key, provedor: 'gemini' });
      } catch (_) {}
    }
    return {
      mensagem: 'Chave do Google Gemini conectada com sucesso!',
      provedor: 'gemini'
    };
  } else {
    // OpenAI
    const key = (apiKeyOpenai || config.apiKeyOpenai || process.env.OPENAI_API_KEY || '').trim();
    if (!key) {
      throw new Error('Nenhuma chave da OpenAI foi informada. Insira sua OpenAI API Key (sk-proj-...).');
    }

    // Faz uma requisição de teste leve ao ChatGPT (gpt-4o-mini, 5 tokens)
    const resTexto = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Responda apenas: OK' }],
        max_tokens: 5
      })
    });

    if (!resTexto.ok) {
      const err = await resTexto.json().catch(() => ({}));
      const msg = err.error?.message || resTexto.statusText;
      if (resTexto.status === 401) {
        throw new Error(`Chave OpenAI não autorizada (401): ${msg}. Verifique se copiou a chave completa.`);
      }
      if (resTexto.status === 429) {
        throw new Error(`Cota esgotada na OpenAI (429): ${msg}. Se você acabou de recarregar créditos ($3), o gateway da OpenAI costuma demorar entre 5 a 15 minutos para liberar a API.`);
      }
      throw new Error(`OpenAI retornou erro (${resTexto.status}): ${msg}`);
    }

    // Se o usuário passou a chave no teste e foi bem sucedido, já salva
    if (apiKeyOpenai) {
      try {
        salvarConfigReceitas(projectId, { apiKeyOpenai: key, provedor: 'openai' });
      } catch (_) {}
    }

    return {
      mensagem: 'Chave da OpenAI 100% operacional! O modelo GPT-4o-mini respondeu com sucesso.',
      provedor: 'openai'
    };
  }
}

module.exports = {
  obterConfigReceitas,
  salvarConfigReceitas,
  obterReceitas,
  gerarReceita,
  gerarLoteReceitas,
  atualizarReceita,
  excluirReceita,
  regerarImagemReceita,
  dispararReceitaAgora,
  dispararProximaReceita,
  adicionarAFilaManual,
  testarChaveIa
};
