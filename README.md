# ⚡ 8zap WhatsApp Automation (Multi-Sessão, Agendador & Feed RSS)

Serviço Node.js completo para **gerenciamento de múltiplas sessões simultâneas de WhatsApp** utilizando a biblioteca **Baileys** (`@whiskeysockets/baileys`), com **API REST local**, **Agendador de postagens baseado em arquivos JSON**, **Módulo de Publicação Automática de Feeds RSS/Atom**, **Rate Limiting** integrado e um **Painel Web moderno**.

Projetado para **uso pessoal** para conectar múltiplos números, projetos, lojas e canais (`@newsletter`) a partir de uma única instância.

---

## 🛠️ Stack Utilizada

- **Node.js LTS** + **Express**
- **@whiskeysockets/baileys** (Conexão nativa via protocolo WebSockets do WhatsApp)
- **rss-parser** (Extração e parsing de feeds RSS/Atom)
- **qrcode** (Geração do QR Code em Base64 para escaneamento dinâmico)
- **dotenv** (Configurações de ambiente)
- **pino** (Logs limpos, com nível *silent* nos sockets para evitar ruídos)
- **JavaScript Puro / CommonJS** (Sem dependências desnecessárias de compilação)
- **Armazenamento em Arquivos JSON locais** (Sem dependência de bancos de dados externos)

---

## 📁 Estrutura do Projeto

```text
8zap/
├── package.json
├── .env.example
├── .env
├── .gitignore
├── README.md
├── sessions/              # Credenciais multi-dispositivo Baileys (por projeto)
│   └── <projectId>/
├── data/
│   ├── fila-<projectId>.json         # Fila de posts manuais agendados em JSON
│   ├── config-rss-<projectId>.json   # Configurações de RSS por projeto
│   ├── artigos-<projectId>.json      # Pool de artigos extraídos do feed
│   └── destinos-uso-<projectId>.json # Histórico de destinos utilizados (anti-repetição)
├── logs/
│   └── <projectId>.log    # Logs cronológicos de eventos por projeto
├── src/
│   ├── server.js          # Inicialização do Express, middlewares e graceful shutdown
│   ├── routes.js          # Definição e autenticação das rotas REST
│   ├── sessionManager.js  # Gerenciamento de N sessões, sockets, QR code e rate limiting
│   ├── agendador.js       # Worker em loop que verifica e dispara posts da fila manual
│   ├── agendadorRss.js    # Motor de seleção aleatória e disparo programado de RSS
│   ├── rssFetcher.js      # Extração, limpeza e pool de artigos do feed RSS
│   ├── destinos.js        # Descoberta, cache e controle de cooldown de canais/grupos
│   └── logger.js          # Logger persistente por projeto e no console
└── public/
    └── index.html         # Painel Web SPA moderno em Dark Mode
```

---

## 🚀 Instalação e Inicialização

### 1. Pré-requisitos
- Node.js instalado (v18+ ou v20+ LTS recomendado).

### 2. Clonar e Instalar Dependências
```bash
npm install
```

### 3. Configurar o arquivo `.env`
Copie o `.env.example` para `.env` e configure sua chave mestra e parâmetros:

```env
PORT=3000
API_KEY=minha_chave_mestra_8zap
INTERVALO_AGENDADOR_SEGUNDOS=60
INTERVALO_RSS_MINUTOS=30
DELAY_ENTRE_ENVIOS_MS=1500
```

### 4. Iniciar o Servidor

Modo de produção:
```bash
npm start
```

Modo de desenvolvimento (com auto-reload do Node):
```bash
npm run dev
```

O servidor estará acessível em: **`http://localhost:3000`**

---

## 📰 Módulo de RSS Automático

O módulo de RSS permite programar a extração e distribuição de artigos de qualquer feed para seus grupos e canais de forma autônoma:

1. **Anti-repetição de Artigos**: Cada artigo possui um hash MD5 único e só é publicado uma única vez (`usado: true`).
2. **Sorteio Aleatório de Destinos com Cooldown**: A cada horário programado (ex: `09:00`, `15:00`, `21:00`), o sistema sorteia um destino (grupo ou canal) entre os elegíveis, garantindo que nenhum destino receba outro post antes de cumprir a janela de cooldown configurada (padrão 24h).
3. **Reaproveitamento de Rate Limiting**: As postagens do RSS utilizam o mesmo `sessionManager.enviarMensagem`, herdando a fila serializada e proteção contra flood.
4. **Descoberta Automática + Destinos Manuais**: Detecta automaticamente grupos via `sock.groupFetchAllParticipating()` e permite cadastrar manualmente JIDs de canais (`@newsletter`).

---

## 🌐 Painel Web Integrado

Abra no seu navegador: **`http://localhost:3000`**

1. **Autenticação**: Insira sua `API_KEY` no canto superior direito e clique em **"Salvar Chave"**.
2. **Aba "QR Code & Conexão"**: Escaneie o QR Code dinâmico com seu WhatsApp.
3. **Aba "📰 RSS Automático"**:
   - Defina a URL do feed RSS e ative a chave.
   - Configure a quantidade de posts por dia e cooldown por destino.
   - Adicione/remova horários fixos de postagem.
   - Clique em "Buscar Canais/Grupos" para selecionar os destinos participantes.
   - Acompanhe o pool de artigos e o histórico de envios em tempo real.
4. **Aba "Enviar Mensagem"**: Disparo imediato avulso (texto, imagem, vídeo).
5. **Aba "Fila Manual"**: Programe postagens personalizadas com data/hora específica.
6. **Aba "Logs"**: Visualizador do terminal com auto-refresh.

---

## 📡 Documentação da API REST

Todas as rotas exigem o envio do header **`x-api-key`** contendo a chave configurada no `.env`.

### 1. Sessões
- `GET /sessions`: Lista todas as sessões e status.
- `POST /sessions/:projectId/start`: Inicia ou retoma a sessão.
- `GET /sessions/:projectId/status`: Consulta status atual.
- `GET /sessions/:projectId/qr`: Retorna QR Code em base64 (`data:image/png;base64,...`).
- `POST /sessions/:projectId/stop`: Pausa a sessão.
- `DELETE /sessions/:projectId`: Encerra e apaga credenciais.

### 2. Envio de Mensagens
- `POST /sessions/:projectId/send`
  ```json
  {
    "to": "5511999999999",
    "type": "texto",
    "texto": "Olá! Mensagem de teste."
  }
  ```

### 3. Fila Manual
- `GET /sessions/:projectId/fila`: Lista a fila do projeto.
- `POST /sessions/:projectId/fila`: Adiciona agendamento manual.
- `DELETE /sessions/:projectId/fila/:id`: Remove item da fila.

### 4. Módulo de RSS
- `GET /sessions/:projectId/rss/config`: Obtém as configurações de RSS.
- `POST /sessions/:projectId/rss/config`: Salva novas configurações de RSS.
  ```json
  {
    "ativo": true,
    "rssUrl": "https://g1.globo.com/rss/g1/tecnologia/",
    "quantidadePorDia": 5,
    "cooldownHorasPorDestino": 24,
    "horarios": ["09:00", "12:00", "15:00", "18:00", "21:00"],
    "destinosPermitidos": []
  }
  ```
- `GET /sessions/:projectId/rss/destinos`: Lista destinos (grupos/canais).
- `POST /sessions/:projectId/rss/destinos/manual`: Cadastra JID manual.
- `POST /sessions/:projectId/rss/fetch`: Força extração imediata do feed.
- `GET /sessions/:projectId/rss/artigos`: Estatísticas do pool de artigos.
- `GET /sessions/:projectId/rss/historico`: Histórico de posts RSS disparados.

---

## ⚠️ AVISO DE RESPONSABILIDADE (DISCLAIMER)

> [!WARNING]
> Este projeto utiliza a biblioteca **Baileys**, que emula a interface de conexão do WhatsApp Web.
> - **Não é uma API oficial da Meta**.
> - Envio massivo de mensagens (SPAM), envio para contatos desconhecidos sem interação prévia ou uso de intervalos agressivos pode levar ao **banimento temporário ou permanente do número**.
> - Utilize exclusivamente para automação dos seus próprios canais, lembretes pessoais, alertas internos e com contatos que consentiram com o recebimento de mensagens.
