const fs = require('fs');
const path = require('path');

const diretorioLogs = path.join(__dirname, '..', 'logs');

// Garante que o diretório de logs exista
if (!fs.existsSync(diretorioLogs)) {
  fs.mkdirSync(diretorioLogs, { recursive: true });
}

/**
 * Formata a data atual para padrão ISO local
 * @returns {string}
 */
function obterTimestamp() {
  return new Date().toISOString();
}

/**
 * Registra um evento no log do projeto e exibe no console
 * @param {string} projectId - Identificador do projeto
 * @param {string} evento - Nome do evento (ex: CONEXAO, QR_CODE, ENVIO, ERRO)
 * @param {string|object} mensagem - Mensagem detalhada ou objeto de erro
 * @param {'info'|'warn'|'error'|'success'} nivel - Nível do log
 */
function logProjeto(projectId, evento, mensagem, nivel = 'info') {
  const timestamp = obterTimestamp();
  const textoMensagem = typeof mensagem === 'object' ? JSON.stringify(mensagem) : mensagem;
  const linhaLog = `[${timestamp}] [${nivel.toUpperCase()}] [${evento}] ${textoMensagem}\n`;

  // 1. Grava no arquivo de log do projeto específico
  try {
    const caminhoLog = path.join(diretorioLogs, `${projectId}.log`);
    fs.appendFileSync(caminhoLog, linhaLog, 'utf8');
  } catch (err) {
    console.error(`[Logger] Falha ao escrever log para ${projectId}:`, err.message);
  }

  // 2. Exibe no console com formatação
  const prefixoConsole = `[${timestamp}] [${projectId}] [${evento}]`;
  if (nivel === 'error') {
    console.error(`\x1b[31m${prefixoConsole} ${textoMensagem}\x1b[0m`);
  } else if (nivel === 'warn') {
    console.warn(`\x1b[33m${prefixoConsole} ${textoMensagem}\x1b[0m`);
  } else if (nivel === 'success') {
    console.log(`\x1b[32m${prefixoConsole} ${textoMensagem}\x1b[0m`);
  } else {
    console.log(`\x1b[36m${prefixoConsole}\x1b[0m ${textoMensagem}`);
  }
}

/**
 * Lê as últimas N linhas de log de um projeto
 * @param {string} projectId - Identificador do projeto
 * @param {number} limite - Quantidade máxima de linhas retornadas
 * @returns {string[]}
 */
function obterLogsProjeto(projectId, limite = 100) {
  const caminhoLog = path.join(diretorioLogs, `${projectId}.log`);
  if (!fs.existsSync(caminhoLog)) {
    return [];
  }

  try {
    const conteudo = fs.readFileSync(caminhoLog, 'utf8');
    const linhas = conteudo.trim().split('\n').filter(Boolean);
    return linhas.slice(-limite);
  } catch (err) {
    console.error(`[Logger] Erro ao ler logs de ${projectId}:`, err.message);
    return [];
  }
}

module.exports = {
  logProjeto,
  obterLogsProjeto
};
