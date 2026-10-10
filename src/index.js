require('dotenv').config();

const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const {
  attachWhatsAppDebugListeners,
  createWhatsAppDebugLogger,
} = require('./debug-log');
const { formatNotification } = require('./notifications');
const { sendWhatsAppMessage } = require('./whatsapp');

function readConfig(env = process.env) {
  const apiToken = env.API_TOKEN?.trim();
  if (!apiToken) throw new Error('Defina API_TOKEN no ambiente antes de iniciar.');

  const recipients = (env.WA_RECIPIENTS || '')
    .split(',')
    .map((number) => number.replace(/\D/g, ''))
    .filter(Boolean);
  if (recipients.length === 0) {
    throw new Error('Defina ao menos um número em WA_RECIPIENTS.');
  }
  if (recipients.some((number) => number.length < 8 || number.length > 15)) {
    throw new Error('Cada número em WA_RECIPIENTS deve ter entre 8 e 15 dígitos.');
  }

  const selfPhoneNumber = (env.WA_SELF_NUMBER || '').replace(/\D/g, '') || null;
  if (selfPhoneNumber && (selfPhoneNumber.length < 8 || selfPhoneNumber.length > 15)) {
    throw new Error('WA_SELF_NUMBER deve ter entre 8 e 15 dígitos.');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
  }

  const dedupeWindowSeconds = Number(env.WA_DEDUPE_WINDOW_SECONDS || 300);
  if (
    !Number.isInteger(dedupeWindowSeconds)
    || dedupeWindowSeconds < 0
    || dedupeWindowSeconds > 86400
  ) {
    throw new Error('WA_DEDUPE_WINDOW_SECONDS deve ser um inteiro entre 0 e 86400.');
  }

  return {
    apiToken,
    port,
    recipients: [...new Set(recipients)],
    selfPhoneNumber,
    dedupeWindowMs: dedupeWindowSeconds * 1000,
    debugLogEnabled: env.WA_DEBUG_LOG === '1',
  };
}

function tokenMatches(candidate, expected) {
  if (!candidate) return false;
  const candidateHash = crypto.createHash('sha256').update(candidate).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function isWhatsAppStreamReady(state) {
  return state?.connectionState === 'CONNECTED'
    && state?.libraryInjected === true
    && state?.streamMode === state?.mainMode
    && state?.displayInfoIsNormal === true
    && state?.hasSynced === true;
}

const knownNonFatalWhatsAppConsoleErrorPatterns = [
  /The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy/i,
  /storage bucket persistence denied/i,
  /Haste-supplied config for the QPL event/i,
  /WALogger called before initialization/i,
  /Failed to execute 'get' on 'IDBObjectStore': No key or key range specified/i,
  /findOrCreateLatestChat.*id->lid failed.*findOrCreateLatestChat_lid_not_found/i,
  /Failed to load resource: the server responded with a status of 400/i,
  /Protocol error \((?:Runtime\.addBinding|Page\.addScriptToEvaluateOnNewDocument)\): Target closed/i,
  /\[processLiveMessage\] bad history msg [\s\S]*?\bt=pinned_message\b[\s\S]*?\(bad-process-live-message-call\)/i,
];

function isKnownNonFatalWhatsAppConsoleError(text) {
  return knownNonFatalWhatsAppConsoleErrorPatterns.some((pattern) => pattern.test(text));
}

function listenForRequests(app, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

function createApp({
  client,
  recipients,
  apiToken,
  isReady,
  selfPhoneNumber,
  dedupeWindowMs = 300000,
}) {
  const app = express();
  const recentEvents = new Map();
  app.use(express.json({ limit: '64kb' }));
  app.use(express.text({
    type: ['text/plain', 'application/x-www-form-urlencoded'],
    limit: '64kb',
  }));
  app.use((req, res, next) => {
    if (typeof req.body !== 'string') return next();

    const body = req.body.trim();
    if (body.startsWith('{') || body.startsWith('[')) {
      try {
        req.body = JSON.parse(body);
        return next();
      } catch (error) {
        return next(error);
      }
    }

    if (req.is('application/x-www-form-urlencoded')) {
      req.body = Object.fromEntries(new URLSearchParams(body));
    }
    return next();
  });

  app.get('/health', (_req, res) => {
    res.status(isReady() ? 200 : 503).json({
      status: isReady() ? 'ready' : 'connecting',
      whatsapp: isReady() ? 'connected' : 'disconnected',
    });
  });

  app.post('/api/notifications', async (req, res) => {
    console.log('Webhook recebido.');
    const authorization = req.get('authorization') || '';
    const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    const bodyToken = req.body && typeof req.body === 'object'
      ? req.body.apiToken || req.body.ApiToken
      : undefined;
    const suppliedToken = bearerToken || req.get('x-api-key') || bodyToken;
    if (!tokenMatches(suppliedToken, apiToken)) {
      const bodyKeys = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? Object.keys(req.body).filter((key) => !/token/i.test(key))
        : [];
      console.error(
        'Webhook recusado: token ausente ou inválido.',
        JSON.stringify({
          contentType: req.get('content-type') || 'ausente',
          bodyType: Array.isArray(req.body) ? 'array' : typeof req.body,
          tokenFieldPresent: Boolean(bodyToken),
          authorizationHeaderPresent: Boolean(authorization),
          apiKeyHeaderPresent: Boolean(req.get('x-api-key')),
          otherBodyFields: bodyKeys,
        }),
      );
      return res.status(401).json({ error: 'Token ausente ou inválido.' });
    }

    if (!isReady()) {
      console.error('Webhook recusado: WhatsApp ainda não está conectado.');
      return res.status(503).json({ error: 'WhatsApp ainda não está conectado.' });
    }

    let targetRecipients = recipients;
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      const requestedRecipient = req.body.recipient;
      if (requestedRecipient !== undefined) {
        if (typeof requestedRecipient !== 'string') {
          console.error('Webhook recusado: recipient inválido.');
          return res.status(400).json({ error: 'recipient deve ser um número configurado.' });
        }
        const normalizedRecipient = requestedRecipient.replace(/\D/g, '');
        if (!recipients.includes(normalizedRecipient)) {
          console.error('Webhook recusado: recipient não configurado.');
          return res.status(400).json({ error: 'recipient não está na lista de destinatários configurados.' });
        }
        targetRecipients = [normalizedRecipient];
      }
    }

    let message;
    try {
      message = formatNotification(req.body);
    } catch (error) {
      console.error(
        'Webhook recusado: payload sem mensagem válida.',
        error instanceof Error ? error.message : String(error),
      );
      return res.status(400).json({ error: error.message });
    }

    const eventType = req.body && typeof req.body === 'object'
      ? req.body.notificationType || req.body.NotificationType
      : undefined;
    const itemId = req.body && typeof req.body === 'object'
      ? req.body.itemId || req.body.ItemId || req.body.ItemID
      : undefined;
    let dedupeKey;
    if (
      dedupeWindowMs > 0
      && typeof eventType === 'string'
      && eventType
      && typeof itemId === 'string'
      && itemId
    ) {
      const now = Date.now();
      for (const [key, expiresAt] of recentEvents) {
        if (expiresAt <= now) recentEvents.delete(key);
      }
      dedupeKey = JSON.stringify([eventType, itemId, [...targetRecipients].sort()]);
      if (recentEvents.has(dedupeKey)) {
        console.log('Notificação duplicada ignorada.');
        return res.status(200).json({ sent: 0, duplicate: true });
      }
      recentEvents.set(dedupeKey, now + dedupeWindowMs);
    }

    const deliveries = await Promise.allSettled(
      targetRecipients.map((number) => sendWhatsAppMessage(
        client,
        number,
        message,
        selfPhoneNumber,
      )),
    );
    const failed = deliveries
      .map((result, index) => ({ result, recipient: targetRecipients[index] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failed.length > 0) {
      if (dedupeKey) recentEvents.delete(dedupeKey);
      console.error(
        `Falha ao enviar notificação para ${failed.length} destinatário(s):`,
        failed.map(({ result, recipient }) => ({
          recipient: `***${recipient.slice(-4)}`,
          error: result.status === 'rejected'
            ? (result.reason.message || String(result.reason)).replace(/\s+/g, ' ').trim()
            : 'Erro desconhecido',
        })),
      );
      return res.status(502).json({
        error: 'Não foi possível entregar a notificação a todos os destinatários.',
        sent: targetRecipients.length - failed.length,
        failed: failed.length,
      });
    }

    console.log(`Notificação enviada para ${targetRecipients.length} destinatário(s).`);
    return res.status(200).json({ sent: targetRecipients.length });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'JSON inválido.' });
    }
    console.error(
      'Erro inesperado na API:',
      error instanceof Error ? error.message : String(error),
    );
    return res.status(500).json({ error: 'Erro interno da API.' });
  });

  return app;
}

async function start() {
  const config = readConfig();
  const debugLog = createWhatsAppDebugLogger(config.debugLogEnabled);
  if (config.debugLogEnabled) {
    debugLog('session-start', { note: 'Sensitive console messages and response bodies are omitted.' });
    console.log('Log de diagnóstico local do WhatsApp ativado em whatsapp-debug.txt.');
  }
  let whatsappReady = false;
  let readinessInterval;
  let readinessDiagnosticTimeout;
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      handleSIGINT: false,
    },
  });

  const markWhatsAppReady = () => {
    clearInterval(readinessInterval);
    clearTimeout(readinessDiagnosticTimeout);
    if (whatsappReady) return;
    whatsappReady = true;
    console.log('WhatsApp conectado e pronto para enviar notificações.');
  };

  client.on('qr', (qr) => {
    console.log('Escaneie este QR code com o WhatsApp para conectar:');
    qrcode.generate(qr, { small: true });
  });
  client.on('ready', markWhatsAppReady);
  client.on('loading_screen', (percent, message) => {
    console.log(`WhatsApp Web carregando (${percent}%): ${message}`);
  });
  client.on('change_state', (state) => {
    console.log(`Estado da conexão WhatsApp: ${state}`);
  });
  client.on('authenticated', () => {
    console.log('Sessão do WhatsApp autenticada.');
  });
  client.on('auth_failure', (message) => {
    whatsappReady = false;
    console.error('Falha na autenticação do WhatsApp:', message);
  });
  client.on('disconnected', (reason) => {
    whatsappReady = false;
    console.error('WhatsApp desconectado:', reason);
  });

  const app = createApp({
    client,
    recipients: config.recipients,
    apiToken: config.apiToken,
    isReady: () => whatsappReady,
    selfPhoneNumber: config.selfPhoneNumber,
    dedupeWindowMs: config.dedupeWindowMs,
  });
  console.log('Iniciando navegador e conectando ao WhatsApp...');
  let server;
  try {
    server = await listenForRequests(app, config.port);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new Error(
        `A porta ${config.port} já está em uso. Encerre a outra instância do bot ou altere PORT no .env.`,
      );
    }
    throw error;
  }
  console.log(`API de notificações disponível na porta ${config.port}.`);

  let readinessCheckRunning = false;
  let readinessDiagnosticShown = false;
  let diagnosticsAttached = false;
  const diagnosticsInterval = setInterval(() => {
    if (!client.pupPage || diagnosticsAttached) return;
    diagnosticsAttached = true;
    clearInterval(diagnosticsInterval);
    attachWhatsAppDebugListeners(client.pupPage, debugLog);
    client.pupPage.on('pageerror', (error) => {
      console.error('Erro JavaScript na página do WhatsApp:', error.message);
    });
    client.pupPage.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (isKnownNonFatalWhatsAppConsoleError(text)) return;
      console.error('Erro no console do WhatsApp Web:', text);
    });
    client.pupPage.on('requestfailed', (request) => {
      const error = request.failure()?.errorText || 'network error';
      const requestUrl = new URL(request.url());
      if (
        error === 'net::ERR_ABORTED'
        || (error === 'net::ERR_BLOCKED_BY_ORB' && requestUrl.hostname === 'www.facebook.com')
      ) {
        return;
      }
      console.error(
        'Falha ao carregar recurso do WhatsApp Web:',
        error,
        requestUrl.origin,
      );
    });
  }, 250);
  diagnosticsInterval.unref();

  readinessInterval = setInterval(async () => {
    if (whatsappReady || readinessCheckRunning || !client.pupPage || client.pupPage.isClosed()) {
      return;
    }

    readinessCheckRunning = true;
    try {
      const state = await client.pupPage.evaluate(() => {
        const libraryInjected = typeof window.WWebJS !== 'undefined';
        if (!libraryInjected) return { libraryInjected };

        let connectionState = 'indisponível';
        try {
          connectionState = window.require('WAWebSocketModel').Socket.state;
        } catch {
          connectionState = 'módulo do WhatsApp ainda não carregado';
        }

        const result = {
          connectionState,
          libraryInjected,
        };
        try {
          const { Stream, StreamInfo, StreamMode } = window.require('WAWebStreamModel');
          const getterModule = window.require('WAWebStreamGetters');
          const getterDisplayInfo = getterModule?.getDisplayInfo?.(Stream);
          const displayInfo = getterDisplayInfo ?? Stream.displayInfo;
          Object.assign(result, {
            streamMode: Stream.mode,
            mainMode: StreamMode.MAIN,
            displayInfoIsNormal: displayInfo === StreamInfo.NORMAL,
            hasSynced: Stream.hasSynced,
          });
        } catch {
          return result;
        }
        return result;
      });

      if (isWhatsAppStreamReady(state)) markWhatsAppReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/target closed|execution context was destroyed|cannot find context/i.test(message)) {
        console.error('Não foi possível verificar o estado do WhatsApp:', message);
      }
    } finally {
      readinessCheckRunning = false;
    }
  }, 1000);
  readinessInterval.unref();

  client.initialize().catch((error) => {
    console.error('Não foi possível iniciar o cliente do WhatsApp:', error);
    clearInterval(readinessInterval);
    server.close(() => process.exit(1));
  });

  readinessDiagnosticTimeout = setTimeout(async () => {
    if (whatsappReady || readinessDiagnosticShown) return;
    readinessDiagnosticShown = true;

    if (!client.pupPage || client.pupPage.isClosed()) {
      console.error('O WhatsApp ainda não ficou pronto após 45 segundos; navegador sem página ativa.');
      return;
    }

    try {
      const diagnostics = await client.pupPage.evaluate(() => {
        const libraryInjected = typeof window.WWebJS !== 'undefined';
        const result = {
          title: document.title,
          pageState: document.readyState,
          libraryInjected,
          webVersion: window.Debug?.VERSION ?? 'indisponível',
        };
        if (!libraryInjected) return result;

        try {
          result.connectionState = window.require('WAWebSocketModel').Socket.state;
        } catch {
          result.connectionState = 'módulo ainda não carregado';
        }
        try {
          const stream = window.require('WAWebStreamModel').Stream;
          result.streamMode = stream.mode;
          result.hasSynced = stream.hasSynced;
        } catch {
          result.streamMode = 'módulo ainda não carregado';
        }
        return result;
      });
      console.log('Estado de diagnóstico do WhatsApp:', JSON.stringify(diagnostics));
      if (!whatsappReady) {
        console.error('O WhatsApp ainda não confirmou a conexão. A API permanece indisponível para envios.');
      }
    } catch (error) {
      console.error('O WhatsApp ainda não confirmou a conexão:', error.message);
    }
  }, 45000);
  readinessDiagnosticTimeout.unref();

  const shutdown = async () => {
    clearTimeout(readinessDiagnosticTimeout);
    clearInterval(readinessInterval);
    clearInterval(diagnosticsInterval);
    server.close();
    await client.destroy();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  isKnownNonFatalWhatsAppConsoleError,
  isWhatsAppStreamReady,
  listenForRequests,
  readConfig,
  start,
  tokenMatches,
};
