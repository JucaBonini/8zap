require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rotas = require('./routes');
const sessionManager = require('./sessionManager');
const agendador = require('./agendador');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globais
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos estáticos do Painel Web
const pastaPublica = path.join(__dirname, '..', 'public');
app.use(express.static(pastaPublica));

// Rota de Health Check (pública, útil para monitoramento)
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});

// Registrar rotas da API
app.use('/', rotas);
app.use('/api', rotas);

// Middleware de tratamento de erros 404 para rotas não encontradas
app.use((req, res, next) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(pastaPublica, 'index.html'));
  }
  res.status(404).json({
    sucesso: false,
    erro: `Rota ${req.method} ${req.url} não encontrada.`
  });
});

// Middleware global de tratamento de exceções
app.use((err, req, res, next) => {
  console.error('[Servidor] Erro não tratado:', err);
  res.status(500).json({
    sucesso: false,
    erro: 'Erro interno do servidor.',
    detalhe: err.message
  });
});

// Inicia o servidor HTTP
const servidor = app.listen(PORT, async () => {
  console.log('====================================================');
  console.log(`🚀 8zap WhatsApp Automation Server`);
  console.log(`📡 Servidor rodando na porta: ${PORT}`);
  console.log(`🌐 Painel Web: http://localhost:${PORT}`);
  console.log(`🔑 API_KEY configurada: ${process.env.API_KEY ? 'Sim' : 'Não definida'}`);
  console.log('====================================================');

  // Inicia o serviço de verificação periódica de postagens agendadas
  agendador.iniciarAgendador();

  // Restaura sessões de WhatsApp que já possuíam credenciais salvas em disco
  try {
    await sessionManager.restaurarSessoesSalvas();
  } catch (err) {
    console.error('[Servidor] Erro ao restaurar sessões existentes:', err.message);
  }
});

// Encerramento suave (Graceful Shutdown)
async function finalizarServidor(sinal) {
  console.log(`\n[Servidor] Recebido sinal ${sinal}. Encerrando serviços com segurança...`);
  
  // 1. Para o agendador
  agendador.pararAgendador();

  // 2. Encerra sockets e conexões ativas do Baileys
  try {
    await sessionManager.encerrarTodasSessoes();
  } catch (err) {
    console.error('[Servidor] Erro ao encerrar sessões do Baileys:', err.message);
  }

  // 3. Fecha o servidor HTTP
  servidor.close(() => {
    console.log('[Servidor] Servidor HTTP finalizado com sucesso.');
    process.exit(0);
  });

  // Força encerramento se demorar mais de 5s
  setTimeout(() => {
    console.error('[Servidor] Forçando encerramento imediato por timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => finalizarServidor('SIGINT'));
process.on('SIGTERM', () => finalizarServidor('SIGTERM'));

