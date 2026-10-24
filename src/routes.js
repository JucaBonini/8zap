const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const sessionManager = require('./sessionManager');
const agendador = require('./agendador');
const destinosManager = require('./destinos');
const { obterLogsProjeto } = require('./logger');

// Garante que o diretório de uploads exista
const pastaUploads = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(pastaUploads)) {
  fs.mkdirSync(pastaUploads, { recursive: true });
}

/**
 * Middleware de Autenticação Simples via Header 'x-api-key'
 */
function sanitizarChave(chave) {
  if (!chave || typeof chave !== 'string') return '';
  return chave.trim().replace(/^["']|["']$/g, '').trim();
}

function autenticarApiKey(req, res, next) {
  const chaveConfigurada = sanitizarChave(process.env.API_KEY);

  // Se por acaso não estiver configurado no .env, alerta mas não trava
  if (!chaveConfigurada) {
    return next();
  }

  const chaveRecebida = sanitizarChave(req.headers['x-api-key'] || req.query.apiKey);

  if (!chaveRecebida || chaveRecebida !== chaveConfigurada) {
    return res.status(401).json({
      sucesso: false,
      erro: 'Não autorizado. Forneça o header "x-api-key" com a chave correta.'
    });
  }

  next();
}

// Aplica a autenticação a todas as rotas deste router
router.use(autenticarApiKey);

/**
 * GET /auth/verify
 * Verifica se a chave de API fornecida é válida
 */
router.get('/auth/verify', (req, res) => {
  res.json({ sucesso: true, autenticado: true, mensagem: 'Chave de acesso autenticada com sucesso!' });
});

// ==========================================
// ROTA DE UPLOAD DE MÍDIA (IMAGENS & VÍDEOS)
// ==========================================

/**
 * POST /upload
 * Recebe arquivos de imagem ou vídeo via Base64, salva em public/uploads/ e retorna links
 * Body aceito: { base64: string, nome?: string }
 */
router.post('/upload', async (req, res) => {
  try {
    const { base64, nome } = req.body || {};

    if (!base64 || typeof base64 !== 'string') {
      return res.status(400).json({
        sucesso: false,
        erro: 'Arquivo não informado. Envie o campo "base64" com o conteúdo da imagem.'
      });
    }

    let buffer;
    let extensao = '.jpg';

    // Suporta tanto Data URI ("data:image/png;base64,...") quanto Base64 puro
    const dataUriMatch = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (dataUriMatch) {
      const mime = dataUriMatch[1].toLowerCase();
      buffer = Buffer.from(dataUriMatch[2], 'base64');

      if (mime.includes('png')) extensao = '.png';
      else if (mime.includes('webp')) extensao = '.webp';
      else if (mime.includes('gif')) extensao = '.gif';
      else if (mime.includes('jpeg') || mime.includes('jpg')) extensao = '.jpg';
      else if (mime.includes('mp4')) extensao = '.mp4';
      else if (mime.includes('webm')) extensao = '.webm';
      else if (mime.includes('mpeg') || mime.includes('mp3')) extensao = '.mp3';
      else if (mime.includes('ogg') || mime.includes('opus')) extensao = '.ogg';
      else if (mime.includes('m4a') || mime.includes('aac')) extensao = '.m4a';
      else if (mime.includes('wav')) extensao = '.wav';
    } else {
      buffer = Buffer.from(base64, 'base64');
      if (nome && path.extname(nome)) {
        extensao = path.extname(nome).toLowerCase();
      }
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        sucesso: false,
        erro: 'O arquivo enviado está vazio ou corrompido.'
      });
    }

    // Limite de segurança de 25MB
    const maxBytes = 25 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return res.status(400).json({
        sucesso: false,
        erro: 'O arquivo excede o limite máximo permitido de 25MB.'
      });
    }

    // Detecta tipo de mídia
    const isVideo = extensao.includes('mp4') || extensao.includes('webm') || extensao.includes('mov');
    const isAudio = ['.mp3', '.ogg', '.m4a', '.wav', '.aac', '.opus'].some(ext => extensao.includes(ext));

    // Se for imagem (JPG, PNG, WEBP), processa e padroniza para 800x800 JPEG Progressivo 3G (~90-130 KB)
    if (!isVideo && !isAudio) {
      try {
        const receitasIaService = require('./receitasIaService');
        buffer = await receitasIaService.otimizarImagemPara3G(buffer, 800, 80);
        extensao = '.jpg';
      } catch (errOpt) {
        console.warn('[Upload] Aviso ao otimizar imagem para 3G:', errOpt.message);
      }
    }

    const idRandom = crypto.randomBytes(4).toString('hex');
    const nomeBaseLimpo = (nome ? path.parse(nome).name : 'midia')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 30);
    const nomeArquivo = `${Date.now()}_${idRandom}_${nomeBaseLimpo}${extensao}`;
    const caminhoDestino = path.join(pastaUploads, nomeArquivo);

    fs.writeFileSync(caminhoDestino, buffer);

    const protocolo = req.protocol;
    const host = req.get('host');
    const urlRelativa = `/uploads/${nomeArquivo}`;
    const urlCompleta = `${protocolo}://${host}${urlRelativa}`;

    return res.json({
      sucesso: true,
      mensagem: 'Upload concluído e link gerado com sucesso!',
      url: urlRelativa,
      urlCompleta: urlCompleta,
      nomeArquivo,
      tipo: isAudio ? 'audio' : (isVideo ? 'video' : 'imagem'),
      tamanhoBytes: buffer.length
    });
  } catch (err) {
    return res.status(500).json({
      sucesso: false,
      erro: `Erro interno no upload: ${err.message}`
    });
  }
});

// ==========================================
// ROTAS DE GERENCIAMENTO DE SESSÕES
// ==========================================

/**
 * GET /sessions
 * Lista todas as sessões conhecidas e seus status
 */
router.get('/sessions', (req, res) => {
  try {
    const lista = sessionManager.listarSessoes();
    res.json({
      sucesso: true,
      total: lista.length,
      sessoes: lista
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/start
 * Inicia ou retoma uma sessão Baileys para o projeto informado
 */
router.post('/sessions/:projectId/start', async (req, res) => {
  const { projectId } = req.params;
  try {
    const status = await sessionManager.iniciarSessao(projectId);
    res.json({
      sucesso: true,
      mensagem: `Sessão para o projeto "${projectId}" iniciada.`,
      sessao: status
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/status
 * Retorna o status de uma sessão específica
 */
router.get('/sessions/:projectId/status', (req, res) => {
  const { projectId } = req.params;
  try {
    const status = sessionManager.obterStatusSessao(projectId);
    res.json({
      sucesso: true,
      sessao: status
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/qr
 * Retorna o QR Code atual em base64 (data:image/png;base64,...)
 */
router.get('/sessions/:projectId/qr', (req, res) => {
  const { projectId } = req.params;
  try {
    const dadosQr = sessionManager.obterQrCode(projectId);
    res.json({
      sucesso: true,
      ...dadosQr
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/stop
 * Para a sessão atual sem apagar as credenciais
 */
router.post('/sessions/:projectId/stop', async (req, res) => {
  const { projectId } = req.params;
  try {
    const resultado = await sessionManager.encerrarSessao(projectId, false);
    res.json({
      sucesso: true,
      mensagem: `Sessão "${projectId}" pausada/desconectada.`,
      sessao: resultado
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId
 * Desconecta e exclui completamente as credenciais da sessão
 */
router.delete('/sessions/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const resultado = await sessionManager.encerrarSessao(projectId, true);
    res.json({
      sucesso: true,
      mensagem: `Sessão e credenciais do projeto "${projectId}" foram excluídas com sucesso.`,
      sessao: resultado
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DE ENVIO DE MENSAGENS
// ==========================================

/**
 * POST /sessions/:projectId/send
 * Envia uma mensagem avulsa imediatamente
 * Body aceito: { to, type, texto, url, legenda }
 */
router.post('/sessions/:projectId/send', async (req, res) => {
  const { projectId } = req.params;
  const { to, type, texto, url, legenda } = req.body;

  if (!to) {
    return res.status(400).json({
      sucesso: false,
      erro: 'O campo "to" (destinatário/telefone/canal) é obrigatório.'
    });
  }

  try {
    const resultado = await sessionManager.enviarMensagem(projectId, {
      to,
      type: type || 'texto',
      texto,
      url,
      legenda
    });

    res.json({
      sucesso: true,
      mensagem: 'Mensagem enviada com sucesso.',
      detalhes: resultado
    });
  } catch (err) {
    res.status(400).json({
      sucesso: false,
      erro: err.message
    });
  }
});

// ==========================================
// ROTAS DE FILA DE POSTAGENS AGENDADAS
// ==========================================

/**
 * GET /sessions/:projectId/fila
 * Lista a fila de postagens do projeto
 */
router.get('/sessions/:projectId/fila', async (req, res) => {
  const { projectId } = req.params;
  try {
    const itens = await agendador.obterFila(projectId);
    res.json({
      sucesso: true,
      projectId,
      total: itens.length,
      fila: itens
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/fila
 * Adiciona um novo item à fila de postagens agendadas
 */
router.post('/sessions/:projectId/fila', async (req, res) => {
  const { projectId } = req.params;
  const { tipo, to, texto, url, legenda, agendado_para, esteira } = req.body;

  try {
    let destinosFinais = to;

    // Se for string ou array contendo links do tipo https://whatsapp.com/channel/..., resolve para o @newsletter oficial
    if (typeof to === 'string') {
      const partes = to.split(/[,;\n]+/).map((d) => d.trim()).filter(Boolean);
      const resolvidas = await Promise.all(
        partes.map(async (d) => {
          if (d.includes('whatsapp.com/channel/') || d.startsWith('0029')) {
            try {
              const info = await destinosManager.resolverDestinoPorEntrada(projectId, d);
              return info.jid;
            } catch (_) {
              return d;
            }
          }
          return d;
        })
      );
      destinosFinais = resolvidas;
    } else if (Array.isArray(to)) {
      const resolvidas = await Promise.all(
        to.map(async (d) => {
          if (typeof d === 'string' && (d.includes('whatsapp.com/channel/') || d.startsWith('0029'))) {
            try {
              const info = await destinosManager.resolverDestinoPorEntrada(projectId, d);
              return info.jid;
            } catch (_) {
              return d;
            }
          }
          return d;
        })
      );
      destinosFinais = resolvidas;
    }

    const novoItem = await agendador.adicionarItemFila(projectId, {
      tipo,
      to: destinosFinais,
      texto,
      url,
      legenda,
      agendado_para,
      esteira: Boolean(esteira)
    });

    const totalAdicionados = Array.isArray(novoItem) ? novoItem.length : 1;
    res.status(201).json({
      sucesso: true,
      mensagem: totalAdicionados > 1
        ? `${totalAdicionados} postagens agendadas com sucesso (uma para cada canal)!`
        : 'Item adicionado à fila com sucesso.',
      item: novoItem
    });
  } catch (err) {
    res.status(400).json({
      sucesso: false,
      erro: err.message
    });
  }
});

/**
 * DELETE /sessions/:projectId/fila-enviados
 * Remove todos os itens que já foram enviados da fila de postagens
 */
router.delete('/sessions/:projectId/fila-enviados', async (req, res) => {
  const { projectId } = req.params;
  try {
    const resultado = await agendador.limparEnviadosFila(projectId);
    res.json({
      sucesso: true,
      mensagem: `${resultado.removidos} post(s) já enviado(s) removido(s) com sucesso.`,
      removidos: resultado.removidos
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/fila/:id
 * Remove um item da fila de postagens
 */
router.delete('/sessions/:projectId/fila/:id', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const itemRemovido = await agendador.removerItemFila(projectId, id);
    res.json({
      sucesso: true,
      mensagem: 'Item removido da fila.',
      item: itemRemovido
    });
  } catch (err) {
    res.status(400).json({
      sucesso: false,
      erro: err.message
    });
  }
});

/**
 * PUT /sessions/:projectId/fila/:id
 * Edita um item existente na fila de postagens
 */
router.put('/sessions/:projectId/fila/:id', async (req, res) => {
  const { projectId, id } = req.params;
  const { tipo, to, texto, url, legenda, agendado_para } = req.body;

  try {
    const itemAtualizado = await agendador.editarItemFila(projectId, id, {
      tipo,
      to,
      texto,
      url,
      legenda,
      agendado_para
    });

    res.json({
      sucesso: true,
      mensagem: 'Item da fila atualizado com sucesso.',
      item: itemAtualizado
    });
  } catch (err) {
    res.status(400).json({
      sucesso: false,
      erro: err.message
    });
  }
});

/**
 * POST /sessions/:projectId/fila/:id/reenviar
 * Dispara o reenvio imediato de um item da fila
 */
router.post('/sessions/:projectId/fila/:id/reenviar', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const resultado = await agendador.reenviarItemFila(projectId, id);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({
      sucesso: false,
      erro: err.message
    });
  }
});

// ==========================================
// ROTAS DE LOGS DO PROJETO
// ==========================================

/**
 * GET /sessions/:projectId/logs
 * Retorna as últimas linhas de log gravadas para o projeto
 */
router.get('/sessions/:projectId/logs', (req, res) => {
  const { projectId } = req.params;
  const limite = parseInt(req.query.limite, 10) || 100;

  try {
    const linhas = obterLogsProjeto(projectId, limite);
    res.json({
      sucesso: true,
      projectId,
      totalLinhas: linhas.length,
      logs: linhas
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DO MÓDULO RSS AUTOMÁTICO
// ==========================================

const rssFetcher = require('./rssFetcher');

/**
 * GET /sessions/:projectId/rss/config
 * Retorna a configuração atual de RSS do projeto
 */
router.get('/sessions/:projectId/rss/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = rssFetcher.obterConfigRss(projectId);
    res.json({
      sucesso: true,
      projectId,
      config
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/rss/config
 * Salva a nova configuração de RSS do projeto
 */
router.post('/sessions/:projectId/rss/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const configSalva = rssFetcher.salvarConfigRss(projectId, req.body);
    res.json({
      sucesso: true,
      mensagem: 'Configurações de RSS salvas com sucesso.',
      config: configSalva
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/destinos (e alias /rss/destinos)
 * Lista grupos e canais disponíveis (automáticos + manuais)
 */
router.get(['/sessions/:projectId/destinos', '/sessions/:projectId/rss/destinos'], async (req, res) => {
  const { projectId } = req.params;
  const forcar = req.query.forcar === 'true' || req.query.atualizar === 'true';
  try {
    const destinos = await destinosManager.listarDestinosDisponiveis(projectId, forcar);
    res.json({
      sucesso: true,
      projectId,
      total: destinos.length,
      destinos
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/destinos/manual (e alias /rss/destinos/manual)
 * Cadastra um novo destino manual (JID ou Link de convite do canal/grupo)
 */
router.post(['/sessions/:projectId/destinos/manual', '/sessions/:projectId/rss/destinos/manual'], async (req, res) => {
  const { projectId } = req.params;
  const { jid, link, nome, tipo } = req.body;
  const entrada = jid || link;

  if (!entrada) {
    return res.status(400).json({
      sucesso: false,
      erro: 'Informe o JID ou o link de convite do canal/grupo.'
    });
  }

  try {
    let dadosDestino = { jid: entrada, nome, tipo };

    // Se for um link de convite ou código de canal/grupo, resolve automaticamente
    if (entrada.includes('whatsapp.com/') || entrada.startsWith('0029')) {
      dadosDestino = await destinosManager.resolverDestinoPorLink(projectId, entrada);
      if (nome) dadosDestino.nome = nome;
    }

    const novoDestino = destinosManager.adicionarDestinoManual(projectId, dadosDestino);
    res.json({
      sucesso: true,
      mensagem: `Destino "${novoDestino.nome}" (${novoDestino.jid}) adicionado com sucesso!`,
      destino: novoDestino
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/destinos/manual/:jid (e alias /rss/destinos/manual/:jid)
 * Remove um destino manual cadastrado
 */
router.delete(['/sessions/:projectId/destinos/manual/:jid', '/sessions/:projectId/rss/destinos/manual/:jid'], (req, res) => {
  const { projectId, jid } = req.params;
  try {
    destinosManager.removerDestinoManual(projectId, jid);
    res.json({
      sucesso: true,
      mensagem: 'Destino removido com sucesso.'
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/rss/fetch
 * Força a busca imediata de novos artigos do feed RSS (com suporte a busca profunda)
 */
router.post('/sessions/:projectId/rss/fetch', async (req, res) => {
  const { projectId } = req.params;
  const { profunda } = req.body || {};
  try {
    const resultado = await rssFetcher.buscarNovosArtigos(projectId, { profunda: Boolean(profunda) });
    res.json({
      sucesso: true,
      mensagem: 'Busca de artigos RSS concluída.',
      resultado
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/rss/artigos
 * Lista o pool de artigos e estatísticas gerais
 */
router.get('/sessions/:projectId/rss/artigos', (req, res) => {
  const { projectId } = req.params;
  const { status, limite, busca } = req.query;
  try {
    const stats = rssFetcher.obterEstatisticasArtigos(projectId, { status, limite, busca });
    res.json({
      sucesso: true,
      projectId,
      ...stats
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/rss/historico
 * Retorna o histórico de posts disparados pelo RSS
 */
router.get('/sessions/:projectId/rss/historico', (req, res) => {
  const { projectId } = req.params;
  try {
    const historico = destinosManager.obterHistoricoDestinos(projectId);
    res.json({
      sucesso: true,
      projectId,
      total: historico.length,
      historico: historico.slice(-50).reverse() // últimos 50 disparos
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/rss/disparar-agora
 * Força o disparo de teste de um artigo RSS imediatamente
 */
router.post('/sessions/:projectId/rss/disparar-agora', async (req, res) => {
  const { projectId } = req.params;
  const agendadorRss = require('./agendadorRss');
  try {
    const resultado = await agendadorRss.dispararArtigoManual(projectId, true);
    res.json({
      sucesso: true,
      mensagem: 'Disparo de teste RSS executado com sucesso!',
      resultado
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DE CAMPANHAS & OFERTAS (SHOPEE / IMAGENS / DICAS)
// ==========================================

const campanhasManager = require('./campanhasManager');
const agendadorCampanhas = require('./agendadorCampanhas');
const shopeeService = require('./shopeeService');
const receitasManager = require('./receitasManager');

/**
 * GET /sessions/:projectId/campanhas/config
 * Retorna as configurações de horários e modos de campanhas
 */
router.get('/sessions/:projectId/campanhas/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = campanhasManager.obterConfigCampanhas(projectId);
    res.json({
      sucesso: true,
      projectId,
      config
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/campanhas/config
 * Atualiza as configurações de horários e preferências de campanhas
 */
router.post('/sessions/:projectId/campanhas/config', async (req, res) => {
  const { projectId } = req.params;
  try {
    const novaConfig = await campanhasManager.salvarConfigCampanhas(projectId, req.body);
    res.json({
      sucesso: true,
      mensagem: 'Configurações de campanhas salvas com sucesso!',
      config: novaConfig
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/campanhas/itens
 * Lista todos os itens de campanhas (Shopee, Imagens, etc) cadastrados
 */
router.get('/sessions/:projectId/campanhas/itens', (req, res) => {
  const { projectId } = req.params;
  try {
    const itens = campanhasManager.obterItensCampanhas(projectId);
    res.json({
      sucesso: true,
      projectId,
      total: itens.length,
      itens
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/campanhas/itens
 * Adiciona um novo item de campanha (Shopee ou Imagem)
 */
router.post('/sessions/:projectId/campanhas/itens', async (req, res) => {
  const { projectId } = req.params;
  try {
    const novoItem = await campanhasManager.adicionarItemCampanha(projectId, req.body);
    res.json({
      sucesso: true,
      mensagem: `Item "${novoItem.titulo}" adicionado com sucesso!`,
      item: novoItem
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * PUT /sessions/:projectId/campanhas/itens/:id
 * Atualiza um item de campanha existente
 */
router.put('/sessions/:projectId/campanhas/itens/:id', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const itemAtualizado = await campanhasManager.atualizarItemCampanha(projectId, id, req.body);
    res.json({
      sucesso: true,
      mensagem: 'Item atualizado com sucesso!',
      item: itemAtualizado
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/campanhas/itens/:id
 * Remove um item de campanha
 */
router.delete('/sessions/:projectId/campanhas/itens/:id', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const removido = await campanhasManager.removerItemCampanha(projectId, id);
    res.json({
      sucesso: true,
      mensagem: `Item "${removido.titulo}" removido com sucesso.`,
      removido
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/campanhas/disparar-agora
 * Força o disparo manual imediato de um item de teste para os canais
 */
router.post('/sessions/:projectId/campanhas/disparar-agora', async (req, res) => {
  const { projectId } = req.params;
  const { itemId } = req.body || {};
  try {
    const resultado = await agendadorCampanhas.dispararCampanhaManual(projectId, itemId || null);
    res.json({
      sucesso: true,
      mensagem: 'Disparo de teste de campanha executado com sucesso!',
      resultado
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/campanhas/shopee/buscar
 * Busca produtos na Shopee usando a Shopee Affiliate Open API (ou modo demonstração)
 */
router.post('/sessions/:projectId/campanhas/shopee/buscar', async (req, res) => {
  const { projectId } = req.params;
  const { keyword = 'cozinha', limit = 12, sortType = 5 } = req.body || {};

  try {
    const configCampanhas = campanhasManager.obterConfigCampanhas(projectId);
    const appId = (req.body.appId || configCampanhas.shopeeAppId || process.env.SHOPEE_APP_ID || '').trim();
    const secret = (req.body.secret || configCampanhas.shopeeSecret || process.env.SHOPEE_SECRET || '').trim();

    const resultado = await shopeeService.buscarProdutosShopee({
      appId,
      secret,
      keyword,
      limit,
      sortType
    });

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/campanhas/shopee/importar
 * Converte um produto da Shopee em item de campanha e gera copy persuasiva com IA
 */
router.post('/sessions/:projectId/campanhas/shopee/importar', async (req, res) => {
  const { projectId } = req.params;
  const { produto, gerarCopyIa = true, tomVoz = '' } = req.body || {};

  if (!produto || !produto.titulo || !produto.link) {
    return res.status(400).json({ sucesso: false, erro: 'Dados do produto incompletos (título e link são obrigatórios).' });
  }

  try {
    let legendaFinal = '';

    if (gerarCopyIa) {
      const configIa = receitasManager.obterConfigReceitas(projectId);
      legendaFinal = await shopeeService.gerarCopyOfertaShopee({
        produto,
        apiKeyOpenai: configIa.apiKeyOpenai || process.env.OPENAI_API_KEY || '',
        apiKeyGemini: configIa.apiKeyGemini || process.env.GEMINI_API_KEY || '',
        provedor: configIa.provedor || 'openai',
        tomVoz
      });
    }

    const itemSalvo = await campanhasManager.adicionarItemCampanha(projectId, {
      tipo: 'shopee',
      titulo: produto.titulo,
      destaque: produto.destaque || (produto.desconto ? `${produto.desconto} de Desconto` : ''),
      preco: produto.preco || '',
      link: produto.link,
      imagem: produto.imagem || '',
      legenda: legendaFinal,
      ativo: true
    });

    res.json({
      sucesso: true,
      mensagem: `Oferta "${produto.titulo}" adicionada com sucesso ao Banco de Campanhas!`,
      item: itemSalvo
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DA GRADE DIÁRIA MESTRA (TIMELINE)
// ==========================================

const gradeManager = require('./gradeManager');

/**
 * GET /sessions/:projectId/grade
 * Retorna a configuração da Grade Diária
 */
router.get('/sessions/:projectId/grade', async (req, res) => {
  const { projectId } = req.params;
  try {
    const config = gradeManager.obterConfigGrade(projectId);
    const fila = await agendador.obterFila(projectId);
    const totalEsteira = fila.filter((i) => !i.enviado && (i.esteira || !i.agendado_para)).length;
    res.json({
      sucesso: true,
      projectId,
      config,
      totalEsteira
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/grade
 * Salva a configuração da Grade Diária
 */
router.post('/sessions/:projectId/grade', (req, res) => {
  const { projectId } = req.params;
  try {
    const salva = gradeManager.salvarConfigGrade(projectId, req.body);
    res.json({
      sucesso: true,
      mensagem: 'Grade Diária salva com sucesso!',
      config: salva
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/grade/slots
 * Adiciona um novo horário à Grade Diária
 */
router.post('/sessions/:projectId/grade/slots', (req, res) => {
  const { projectId } = req.params;
  const { hora, origem } = req.body;
  try {
    const atualizada = gradeManager.adicionarSlotGrade(projectId, { hora, origem });
    res.json({
      sucesso: true,
      mensagem: `Horário ${hora} adicionado à Grade!`,
      config: atualizada
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/grade/slots/:slotId
 * Remove um horário da Grade Diária
 */
router.delete('/sessions/:projectId/grade/slots/:slotId', (req, res) => {
  const { projectId, slotId } = req.params;
  try {
    const atualizada = gradeManager.removerSlotGrade(projectId, slotId);
    res.json({
      sucesso: true,
      mensagem: 'Horário removido da Grade com sucesso.',
      config: atualizada
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/grade/slots/:slotId/testar
 * Força o disparo de teste de um slot específico da Grade Diária
 */
router.post('/sessions/:projectId/grade/slots/:slotId/testar', async (req, res) => {
  const { projectId, slotId } = req.params;
  try {
    const resultado = await gradeManager.dispararSlotManual(projectId, slotId);
    res.json({
      sucesso: true,
      mensagem: 'Disparo de teste da Grade executado com sucesso!',
      resultado
    });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DE RECEITAS IA (MARY)
// ==========================================

/**
 * GET /sessions/:projectId/receitas/config
 */
router.get('/sessions/:projectId/receitas/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = receitasManager.obterConfigReceitas(projectId);
    res.json({ sucesso: true, config });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/receitas/config
 */
router.post('/sessions/:projectId/receitas/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const salva = receitasManager.salvarConfigReceitas(projectId, req.body);
    res.json({ sucesso: true, mensagem: 'Configurações de Receitas IA salvas com sucesso!', config: salva });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/receitas/testar-chave
 */
router.post('/sessions/:projectId/receitas/testar-chave', async (req, res) => {
  const { projectId } = req.params;
  const { provedor, apiKeyOpenai, apiKeyGemini } = req.body || {};
  try {
    const resultado = await receitasManager.testarChaveIa(projectId, { provedor, apiKeyOpenai, apiKeyGemini });
    res.json({ sucesso: true, ...resultado });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/receitas
 */
router.get('/sessions/:projectId/receitas', (req, res) => {
  const { projectId } = req.params;
  try {
    const receitas = receitasManager.obterReceitas(projectId);
    res.json({ sucesso: true, receitas });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/receitas/gerar
 */
router.post('/sessions/:projectId/receitas/gerar', async (req, res) => {
  const { projectId } = req.params;
  const { tema, personaCustom, provedor, resolucao, apiKeyOpenai, apiKeyGemini } = req.body || {};
  try {
    const receita = await receitasManager.gerarReceita(projectId, { tema, personaCustom, provedor, resolucao, apiKeyOpenai, apiKeyGemini });
    res.json({ sucesso: true, mensagem: `Receita "${receita.titulo}" gerada com sucesso!`, receita });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/receitas/gerar-lote
 */
router.post('/sessions/:projectId/receitas/gerar-lote', async (req, res) => {
  const { projectId } = req.params;
  const { quantidade, temas, apiKeyOpenai, apiKeyGemini } = req.body || {};
  try {
    const receitas = await receitasManager.gerarLoteReceitas(projectId, { quantidade, temas, apiKeyOpenai, apiKeyGemini });
    res.json({ sucesso: true, mensagem: `${receitas.length} receitas geradas com sucesso!`, receitas });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/receitas/:id/disparar
 */
router.post('/sessions/:projectId/receitas/:id/disparar', async (req, res) => {
  const { projectId, id } = req.params;
  const { destinos } = req.body || {};
  try {
    const resultado = await receitasManager.dispararReceitaAgora(projectId, id, destinos);
    res.json({ sucesso: true, mensagem: 'Receita disparada para o WhatsApp com sucesso!', resultado });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/receitas/:id/fila
 */
router.post('/sessions/:projectId/receitas/:id/fila', async (req, res) => {
  const { projectId, id } = req.params;
  const { agendadoPara } = req.body || {};
  try {
    const resultado = await receitasManager.adicionarAFilaManual(projectId, id, agendadoPara);
    res.json({ sucesso: true, mensagem: 'Receita adicionada à Esteira / Fila de postagens!', resultado });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/receitas/:id/regerar-imagem
 */
router.post('/sessions/:projectId/receitas/:id/regerar-imagem', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const receita = await receitasManager.regerarImagemReceita(projectId, id);
    res.json({ sucesso: true, mensagem: 'Foto gastronômica regerada com sucesso!', receita });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * PUT /sessions/:projectId/receitas/:id
 */
router.put('/sessions/:projectId/receitas/:id', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const receita = await receitasManager.atualizarReceita(projectId, id, req.body);
    res.json({ sucesso: true, mensagem: 'Receita atualizada!', receita });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/receitas/:id
 */
router.delete('/sessions/:projectId/receitas/:id', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    await receitasManager.excluirReceita(projectId, id);
    res.json({ sucesso: true, mensagem: 'Receita excluída com sucesso.' });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DE PÁGINA DO FACEBOOK (ESTEIRA BUFFER)
// ==========================================

const facebookManager = require('./facebookManager');
const facebookService = require('./facebookService');

/**
 * GET /sessions/:projectId/facebook/config
 */
router.get('/sessions/:projectId/facebook/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = facebookManager.obterConfigFacebook(projectId);
    res.json({ sucesso: true, config });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/facebook/config
 */
router.post('/sessions/:projectId/facebook/config', async (req, res) => {
  const { projectId } = req.params;
  try {
    const dados = { ...(req.body || {}) };

    // Se forneceu pageId e pageAccessToken, tenta resolver o token de página real e dados da fanpage
    if (dados.pageId && dados.pageAccessToken) {
      try {
        const info = await facebookService.verificarConexaoPagina(dados.pageId, dados.pageAccessToken);
        if (info.pageAccessTokenResolvido) {
          dados.pageAccessToken = info.pageAccessTokenResolvido;
        }
        if (info.nome) dados.nomePagina = info.nome;
        if (info.foto) dados.fotoPagina = info.foto;
      } catch (_) {}
    }

    const config = facebookManager.salvarConfigFacebook(projectId, dados);
    res.json({ sucesso: true, mensagem: 'Configurações do Facebook salvas com sucesso!', config });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/facebook/testar-conexao
 */
router.post('/sessions/:projectId/facebook/testar-conexao', async (req, res) => {
  const { projectId } = req.params;
  const { pageId, pageAccessToken } = req.body || {};
  try {
    const config = facebookManager.obterConfigFacebook(projectId);
    const idParaTestar = pageId || config.pageId;
    const tokenParaTestar = pageAccessToken || config.pageAccessToken;

    const infoPagina = await facebookService.verificarConexaoPagina(idParaTestar, tokenParaTestar);

    // Salva automaticamente o Page Access Token resolvido e dados da página
    facebookManager.salvarConfigFacebook(projectId, {
      pageId: infoPagina.id || idParaTestar,
      pageAccessToken: infoPagina.pageAccessTokenResolvido || tokenParaTestar,
      nomePagina: infoPagina.nome || config.nomePagina,
      fotoPagina: infoPagina.foto || config.fotoPagina
    });

    res.json({ sucesso: true, mensagem: `Conectado com sucesso à página "${infoPagina.nome}"!`, dados: infoPagina });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/facebook/fila
 */
router.get('/sessions/:projectId/facebook/fila', (req, res) => {
  const { projectId } = req.params;
  try {
    const fila = facebookManager.obterFilaFacebook(projectId);
    res.json({ sucesso: true, fila });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/facebook/fila
 */
router.post('/sessions/:projectId/facebook/fila', (req, res) => {
  const { projectId } = req.params;
  try {
    const item = facebookManager.adicionarItemFilaFacebook(projectId, req.body || {});
    res.json({ sucesso: true, mensagem: 'Post adicionado à Esteira do Facebook!', item });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/facebook/fila/:id
 */
router.delete('/sessions/:projectId/facebook/fila/:id', (req, res) => {
  const { projectId, id } = req.params;
  try {
    facebookManager.removerItemFilaFacebook(projectId, id);
    res.json({ sucesso: true, mensagem: 'Item removido da esteira.' });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/facebook/fila-enviados
 */
router.delete('/sessions/:projectId/facebook/fila-enviados', (req, res) => {
  const { projectId } = req.params;
  try {
    const removidos = facebookManager.limparEnviadosFacebook(projectId);
    res.json({ sucesso: true, mensagem: `${removidos} post(s) já enviados foram limpos do histórico.` });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/facebook/fila/:id/recolocar
 * Recoloca um post publicado de volta na esteira de espera
 */
router.post('/sessions/:projectId/facebook/fila/:id/recolocar', (req, res) => {
  const { projectId, id } = req.params;
  try {
    const item = facebookManager.recolocarItemFilaFacebook(projectId, id);
    res.json({ sucesso: true, mensagem: 'Post recolocado na esteira com sucesso!', item });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/facebook/disparar-agora
 * Dispara manualmente o próximo post da esteira para teste imediato
 */
router.post('/sessions/:projectId/facebook/disparar-agora', async (req, res) => {
  const { projectId } = req.params;
  try {
    const resultado = await facebookManager.dispararProximoItemEsteiraFacebook(projectId);
    res.json({ sucesso: true, mensagem: 'Post disparado com sucesso para a Página do Facebook!', resultado });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/facebook/receitas/:id/fila
 * Envia uma Receita da Mary diretamente para a Esteira do Facebook
 */
router.post('/sessions/:projectId/facebook/receitas/:id/fila', async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const item = await facebookManager.adicionarReceitaAFilaFacebook(projectId, id);
    res.json({ sucesso: true, mensagem: 'Receita enviada para a Esteira do Facebook com sucesso!', item });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/facebook/testar-espelhamento
 * Dispara um post de teste espelhado na Página do Facebook usando uma receita da Mary ou do acervo do blog
 */
router.post('/sessions/:projectId/facebook/testar-espelhamento', async (req, res) => {
  const { projectId } = req.params;
  try {
    const receitasManager = require('./receitasManager');
    const lista = receitasManager.obterReceitas(projectId);
    let receita = lista.find((r) => r.status === 'pronto') || lista[0];

    // Fallback inteligente: se não tiver receita gerada pela Mary ainda, busca no pool de artigos do blog
    if (!receita) {
      const fs = require('fs');
      const path = require('path');
      const idSanitizado = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const arqArtigos = path.join(__dirname, '..', 'data', `artigos-${idSanitizado}.json`);

      if (fs.existsSync(arqArtigos)) {
        try {
          const artigos = JSON.parse(fs.readFileSync(arqArtigos, 'utf8'));
          const comFoto = artigos.filter((a) => a.imagem && typeof a.imagem === 'string' && a.imagem.startsWith('http'));
          const artigo = comFoto.length > 0 ? comFoto[0] : artigos[0];

          if (artigo) {
            receita = {
              id: artigo.id || 'artigo_teste',
              titulo: artigo.titulo || 'Receita Descomplicando Receitas',
              texto: `👩‍🍳 ${artigo.titulo}\n\n${artigo.resumo || 'Uma receita maravilhosa, prática e irresistível para toda a família!'}\n\n👉 Salve essa delícia e veja os detalhes completos no primeiro comentário!`,
              imagemUrl: artigo.imagem || '',
              linkOriginal: artigo.link || 'https://descomplicandoreceitas.com.br'
            };
          }
        } catch (_) {}
      }
    }

    if (!receita) {
      receita = {
        id: 'teste_padrao',
        titulo: 'Bolo de Cenoura com Cobertura de Chocolate Vulcão',
        texto: '👩‍🍳 Bolo de Cenoura Fofinho com Chocolate 🥕🍫\n\nUma receita prática, deliciosa e que todo mundo ama! Ideal para o café da tarde.\n\n👉 Veja a receita completa e o modo de preparo passo a passo no primeiro comentário!',
        imagemUrl: '',
        linkOriginal: 'https://descomplicandoreceitas.com.br'
      };
    }

    const resultado = await facebookManager.publicarEspelhamentoAutomatico(projectId, {
      origem: 'teste_espelhamento',
      origemId: receita.id,
      titulo: receita.titulo || 'Receita de Teste',
      tipo: (receita.imagemUrl || receita.imagemCaminhoFisico) ? 'imagem' : 'texto',
      texto: receita.texto,
      imagemUrl: receita.imagemUrl || '',
      caminhoArquivo: receita.imagemCaminhoFisico || '',
      linkComentario: receita.linkOriginal || ''
    });

    if (!resultado.publicado) {
      throw new Error(resultado.erro || resultado.motivo || 'Falha ao publicar no Facebook.');
    }

    res.json({
      sucesso: true,
      mensagem: `Receita "${receita.titulo}" publicada com sucesso na sua Página do Facebook!`,
      resultado
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DE CONTROLE DE UTM & MÉTRICAS
// ==========================================

const utmManager = require('./utmManager');

/**
 * GET /sessions/:projectId/utm/config
 * Retorna as configurações de UTM do projeto
 */
router.get('/sessions/:projectId/utm/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = utmManager.obterConfigUtm(projectId);
    res.json({ sucesso: true, config });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/utm/config
 * Salva as configurações de UTM do projeto
 */
router.post('/sessions/:projectId/utm/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = utmManager.salvarConfigUtm(projectId, req.body || {});
    res.json({ sucesso: true, mensagem: 'Configurações de UTM salvas com sucesso!', config });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/utm/gerar-link
 * Gera e testa uma URL com os parâmetros de UTM aplicados
 */
router.post('/sessions/:projectId/utm/gerar-link', (req, res) => {
  const { projectId } = req.params;
  const { url, canal, content } = req.body || {};
  try {
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ sucesso: false, erro: 'URL é obrigatória para gerar o link com UTM.' });
    }
    const urlComUtm = utmManager.anexarUtm(url.trim(), canal || 'facebook', projectId, { content });
    res.json({ sucesso: true, urlOriginal: url, canal: canal || 'facebook', urlComUtm });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/utm/estatisticas
 * Retorna estatísticas de cliques do link ponte
 */
router.get('/sessions/:projectId/utm/estatisticas', (req, res) => {
  const { projectId } = req.params;
  try {
    const estatisticas = utmManager.obterEstatisticasPonte(projectId);
    res.json({ sucesso: true, estatisticas });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

// ==========================================
// ROTAS DE GATILHOS DE REAÇÃO (WHATSAPP CHANNELS)
// ==========================================
const reacaoGatilhos = require('./reacaoGatilhos');

/**
 * GET /sessions/:projectId/gatilhos-reacao
 */
router.get('/sessions/:projectId/gatilhos-reacao', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = reacaoGatilhos.obterConfigGatilhos(projectId);
    res.json({
      sucesso: true,
      config,
      catalogo: reacaoGatilhos.CATALOGO_GATILHOS
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/gatilhos-reacao
 */
router.post('/sessions/:projectId/gatilhos-reacao', (req, res) => {
  const { projectId } = req.params;
  try {
    const config = reacaoGatilhos.salvarConfigGatilhos(projectId, req.body || {});
    res.json({ sucesso: true, mensagem: 'Configurações de Gatilhos de Reação salvas com sucesso!', config });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/gatilhos-reacao/testar-preview
 */
router.post('/sessions/:projectId/gatilhos-reacao/testar-preview', (req, res) => {
  const { projectId } = req.params;
  const { texto, categoria } = req.body || {};
  try {
    const textoBase = texto || '🍲 *BOLO DE CENOURA COM CHOCOLATE*\n\nUma receita prática, fofinha e deliciosa para acompanhar aquele cafezinho da tarde!';
    const preview = reacaoGatilhos.aplicarGatilhoReacao(textoBase, {
      categoria: categoria || 'culinaria',
      projectId,
      forcar: true
    });
    res.json({ sucesso: true, preview });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * GET /sessions/:projectId/antiban
 * Retorna as configurações de Anti-Ban e a lista negra (Blacklist)
 */
router.get('/sessions/:projectId/antiban', (req, res) => {
  const { projectId } = req.params;
  try {
    const antiBanManager = require('./antiBanManager');
    const config = antiBanManager.obterConfigAntiBan(projectId);
    const blacklist = antiBanManager.obterBlacklist(projectId);
    res.json({ sucesso: true, config, blacklist });
  } catch (err) {
    res.status(500).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/antiban/config
 * Salva novas configurações de Anti-Ban
 */
router.post('/sessions/:projectId/antiban/config', (req, res) => {
  const { projectId } = req.params;
  try {
    const antiBanManager = require('./antiBanManager');
    const atualizado = antiBanManager.salvarConfigAntiBan(projectId, req.body || {});
    res.json({ sucesso: true, config: atualizado });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * POST /sessions/:projectId/antiban/blacklist
 * Adiciona manualmente um contato à Blacklist
 */
router.post('/sessions/:projectId/antiban/blacklist', (req, res) => {
  const { projectId } = req.params;
  const { jid, motivo } = req.body || {};
  try {
    const antiBanManager = require('./antiBanManager');
    if (!jid) {
      return res.status(400).json({ sucesso: false, erro: 'JID ou telefone é obrigatório.' });
    }
    const adicionou = antiBanManager.adicionarNaBlacklist(projectId, jid, motivo || 'Adicionado manualmente pelo painel', 'painel');
    const blacklist = antiBanManager.obterBlacklist(projectId);
    res.json({ sucesso: true, adicionou, blacklist });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

/**
 * DELETE /sessions/:projectId/antiban/blacklist/:jid
 * Remove um contato da Blacklist
 */
router.delete('/sessions/:projectId/antiban/blacklist/:jid', (req, res) => {
  const { projectId, jid } = req.params;
  try {
    const antiBanManager = require('./antiBanManager');
    const removeu = antiBanManager.removerDaBlacklist(projectId, jid);
    const blacklist = antiBanManager.obterBlacklist(projectId);
    res.json({ sucesso: true, removeu, blacklist });
  } catch (err) {
    res.status(400).json({ sucesso: false, erro: err.message });
  }
});

module.exports = router;



