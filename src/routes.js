const express = require('express');
const router = express.Router();
const sessionManager = require('./sessionManager');
const agendador = require('./agendador');
const { obterLogsProjeto } = require('./logger');

/**
 * Middleware de Autenticação Simples via Header 'x-api-key'
 */
function autenticarApiKey(req, res, next) {
  const chaveConfigurada = process.env.API_KEY;

  // Se por acaso não estiver configurado no .env, alerta mas não trava
  if (!chaveConfigurada) {
    return next();
  }

  const chaveRecebida = req.headers['x-api-key'] || req.query.apiKey;

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
  const { tipo, to, texto, url, legenda, agendado_para } = req.body;

  try {
    const novoItem = await agendador.adicionarItemFila(projectId, {
      tipo,
      to,
      texto,
      url,
      legenda,
      agendado_para
    });

    res.status(201).json({
      sucesso: true,
      mensagem: 'Item adicionado à fila com sucesso.',
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
const destinosManager = require('./destinos');

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
 * GET /sessions/:projectId/rss/destinos
 * Lista grupos e canais disponíveis (automáticos + manuais)
 */
router.get('/sessions/:projectId/rss/destinos', async (req, res) => {
  const { projectId } = req.params;
  const forcar = req.query.forcar === 'true';
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
 * POST /sessions/:projectId/rss/destinos/manual
 * Cadastra um novo destino manual (JID ou Link de convite do canal/grupo)
 */
router.post('/sessions/:projectId/rss/destinos/manual', async (req, res) => {
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
 * DELETE /sessions/:projectId/rss/destinos/manual/:jid
 * Remove um destino manual cadastrado
 */
router.delete('/sessions/:projectId/rss/destinos/manual/:jid', (req, res) => {
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
 * Força a busca imediata de novos artigos do feed RSS
 */
router.post('/sessions/:projectId/rss/fetch', async (req, res) => {
  const { projectId } = req.params;
  try {
    const resultado = await rssFetcher.buscarNovosArtigos(projectId);
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
  try {
    const stats = rssFetcher.obterEstatisticasArtigos(projectId);
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

module.exports = router;
