const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { formatNotification } = require('../src/notifications');
const {
  createApp,
  isKnownNonFatalWhatsAppConsoleError,
  isWhatsAppStreamReady,
  listenForRequests,
  readConfig,
  tokenMatches,
} = require('../src');

test('formats a direct message without changing its contents', () => {
  assert.equal(formatNotification({ message: 'Servidor Jellyfin pronto' }), 'Servidor Jellyfin pronto');
});

test('formats common Jellyfin webhook event fields', () => {
  const message = formatNotification({
    NotificationType: 'PlaybackStart',
    ItemName: 'Filme de teste',
    ItemType: 'Movie',
    ProductionYear: 2025,
    UserName: 'Ana',
  });

  assert.match(message, /Reprodução iniciada/);
  assert.match(message, /Filme de teste \(Movie\) \(2025\)/);
  assert.match(message, /Usuário: Ana/);
});

test('formats Jellyfin webhook username fields', () => {
  assert.match(
    formatNotification({ NotificationType: 'ItemAdded', Username: 'Ana' }),
    /Usuário: Ana/,
  );
  assert.match(
    formatNotification({ NotificationType: 'ItemAdded', NotificationUsername: 'Bia' }),
    /Usuário: Bia/,
  );
});

test('rejects an event without notification content', () => {
  assert.throws(() => formatNotification({ arbitrary: 'value' }), /Informe message\/text/);
});

test('loads and normalizes configured recipient numbers', () => {
  const config = readConfig({
    API_TOKEN: 'test-secret',
    WA_RECIPIENTS: '15550100101, 15550100102, 15550100101',
    WA_SELF_NUMBER: '+1 555 010-0101',
    PORT: '3100',
    WA_DEDUPE_WINDOW_SECONDS: '30',
  });

  assert.equal(config.port, 3100);
  assert.deepEqual(config.recipients, ['15550100101', '15550100102']);
  assert.equal(config.selfPhoneNumber, '15550100101');
  assert.equal(config.dedupeWindowMs, 30000);
  assert.equal(config.debugLogEnabled, false);
  assert.equal(readConfig({
    API_TOKEN: 'test-secret',
    WA_RECIPIENTS: '15550100101',
    WA_DEBUG_LOG: '1',
  }).debugLogEnabled, true);
});

test('rejects invalid configuration values', () => {
  assert.throws(() => readConfig({ API_TOKEN: 'secret', WA_RECIPIENTS: '123' }), /entre 8 e 15 dígitos/);
  assert.throws(() => readConfig({
    API_TOKEN: 'secret',
    WA_RECIPIENTS: '15550100101',
    PORT: '70000',
  }), /PORT deve ser/);
  assert.throws(() => readConfig({
    API_TOKEN: 'secret',
    WA_RECIPIENTS: '15550100101',
    WA_SELF_NUMBER: '123',
  }), /WA_SELF_NUMBER/);
  assert.throws(() => readConfig({
    API_TOKEN: 'secret',
    WA_RECIPIENTS: '15550100101',
    WA_DEDUPE_WINDOW_SECONDS: '-1',
  }), /WA_DEDUPE_WINDOW_SECONDS/);
});

test('compares API tokens without accepting a mismatch', () => {
  assert.equal(tokenMatches('secret', 'secret'), true);
  assert.equal(tokenMatches('wrong', 'secret'), false);
  assert.equal(tokenMatches(undefined, 'secret'), false);
});

test('accepts readiness only when the WhatsApp stream is connected and synchronized', () => {
  const readyState = {
    connectionState: 'CONNECTED',
    libraryInjected: true,
    streamMode: 'MAIN',
    mainMode: 'MAIN',
    displayInfoIsNormal: true,
    hasSynced: true,
  };

  assert.equal(isWhatsAppStreamReady(readyState), true);
  assert.equal(isWhatsAppStreamReady({ ...readyState, hasSynced: false }), false);
  assert.equal(isWhatsAppStreamReady({ ...readyState, displayInfoIsNormal: false }), false);
  assert.equal(isWhatsAppStreamReady({ ...readyState, streamMode: 'SYNCING' }), false);
  assert.equal(isWhatsAppStreamReady({ ...readyState, connectionState: 'OPENING' }), false);
  assert.equal(isWhatsAppStreamReady(undefined), false);
});

test('ignores only the known non-fatal pinned-message history error', () => {
  const warning = [
    'ErrorUtils caught an error:',
    '[processLiveMessage] bad history msg false_123@g.us_3EB0F1C3229D06650ED9F7_123@lid',
    't=pinned_message st=undefined new=undefined fresh=undefined',
    '(bad-process-live-message-call)',
    'Subsequent non-fatal errors won\'t be logged; see https://fburl.com/debugjs.',
  ].join('\n');

  assert.equal(isKnownNonFatalWhatsAppConsoleError(warning), true);
  assert.equal(
    isKnownNonFatalWhatsAppConsoleError(
      '[processLiveMessage] bad history msg false_123@g.us_123@lid t=message (bad-process-live-message-call)',
    ),
    false,
  );
  assert.equal(isKnownNonFatalWhatsAppConsoleError('Outro erro do WhatsApp Web'), false);
});

test('ignores the known report-only upgrade-insecure-requests CSP warning', () => {
  assert.equal(
    isKnownNonFatalWhatsAppConsoleError(
      "The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.",
    ),
    true,
  );
  assert.equal(
    isKnownNonFatalWhatsAppConsoleError(
      "The Content Security Policy directive 'script-src' was violated.",
    ),
    false,
  );
});

test('reports an occupied API port without an unhandled server error', async (t) => {
  const occupiedServer = http.createServer();
  occupiedServer.listen(0);
  await new Promise((resolve) => occupiedServer.once('listening', resolve));
  t.after(() => occupiedServer.close());

  const port = occupiedServer.address().port;
  await assert.rejects(
    listenForRequests((_req, res) => res.end(), port),
    (error) => error.code === 'EADDRINUSE',
  );
});

test('protects the notification endpoint and delivers to configured recipients', async (t) => {
  const sentMessages = [];
  let ready = true;
  const app = createApp({
    client: {
      pupPage: {
        evaluate: async () => ({
          phoneNumber: '',
          phoneChatId: '',
          lidChatId: '',
        }),
      },
      sendMessage: async (chatId, message) => sentMessages.push({ chatId, message }),
    },
    recipients: ['15550100101', '15550100102'],
    apiToken: 'secret',
    isReady: () => ready,
  });
  const server = app.listen(0);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/notifications`;

  const unauthorized = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Teste' }),
  });
  assert.equal(unauthorized.status, 401);

  const delivered = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message: 'Teste' }),
  });
  assert.equal(delivered.status, 200);
  assert.deepEqual(await delivered.json(), { sent: 2 });
  assert.deepEqual(sentMessages, [
    { chatId: '15550100101@c.us', message: 'Teste' },
    { chatId: '15550100102@c.us', message: 'Teste' },
  ]);

  const plainTextWebhook = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({
      apiToken: 'secret',
      message: 'Item novo acabou de chegar ao Jellyfin',
    }),
  });
  assert.equal(plainTextWebhook.status, 200);
  assert.deepEqual(await plainTextWebhook.json(), { sent: 2 });
  assert.equal(sentMessages.at(-1).message, 'Item novo acabou de chegar ao Jellyfin');

  const formContentTypeWebhook = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({
      apiToken: 'secret',
      message: 'Item enviado como JSON com content-type form',
    }),
  });
  assert.equal(formContentTypeWebhook.status, 200);
  assert.deepEqual(await formContentTypeWebhook.json(), { sent: 2 });
  assert.equal(sentMessages.at(-1).message, 'Item enviado como JSON com content-type form');

  const encodedFormWebhook = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      apiToken: 'secret',
      message: 'Item enviado como formulario codificado',
    }),
  });
  assert.equal(encodedFormWebhook.status, 200);
  assert.deepEqual(await encodedFormWebhook.json(), { sent: 2 });
  assert.equal(sentMessages.at(-1).message, 'Item enviado como formulario codificado');

  const singleRecipient = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ recipient: '15550100101', message: 'Teste individual' }),
  });
  assert.equal(singleRecipient.status, 200);
  assert.deepEqual(await singleRecipient.json(), { sent: 1 });
  assert.equal(sentMessages.at(-1).chatId, '15550100101@c.us');

  const unconfiguredRecipient = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ recipient: '5511999999999', message: 'Teste' }),
  });
  assert.equal(unconfiguredRecipient.status, 400);

  const templateDelivered = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiToken: 'secret', message: 'Teste do template' }),
  });
  assert.equal(templateDelivered.status, 200);
  assert.deepEqual(await templateDelivered.json(), { sent: 2 });

  ready = false;
  const unavailable = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': 'secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message: 'Teste' }),
  });
  assert.equal(unavailable.status, 503);
});

test('routes a configured self-recipient through the linked WhatsApp account ID', async (t) => {
  const sentMessages = [];
  const app = createApp({
    client: {
      info: {
        wid: {
          user: 'account-lid',
          _serialized: 'own-account@lid',
        },
      },
      sendMessage: async (chatId, message) => {
        sentMessages.push({ chatId, message });
      },
    },
    recipients: ['15550100101', '15550100102'],
    selfPhoneNumber: '15550100101',
    apiToken: 'secret',
    isReady: () => true,
  });
  const server = app.listen(0);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiToken: 'secret',
      recipient: '15550100101',
      message: 'Teste para minha conta',
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: 1 });
  assert.deepEqual(sentMessages, [{
    chatId: 'own-account@lid',
    message: 'Teste para minha conta',
  }]);
});

test('suppresses duplicate Jellyfin events by notification type and item ID', async (t) => {
  const sentMessages = [];
  const app = createApp({
    client: {
      sendMessage: async (chatId, message) => {
        sentMessages.push({ chatId, message });
        return { id: `message-${sentMessages.length}` };
      },
    },
    recipients: ['15550100101'],
    apiToken: 'secret',
    isReady: () => true,
    dedupeWindowMs: 60000,
  });
  const server = app.listen(0);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/notifications`;
  const sendEvent = (notificationType, itemId, message) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiToken: 'secret',
      notificationType,
      itemId,
      message,
    }),
  });

  const first = await sendEvent('ItemAdded', 'item-1', 'Mesmo filme');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { sent: 1 });

  const duplicate = await sendEvent('ItemAdded', 'item-1', 'Mesmo filme');
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { sent: 0, duplicate: true });

  const differentItem = await sendEvent('ItemAdded', 'item-2', 'Mesmo filme');
  assert.equal(differentItem.status, 200);
  assert.deepEqual(await differentItem.json(), { sent: 1 });

  const differentEvent = await sendEvent('ItemDeleted', 'item-1', 'Mesmo filme');
  assert.equal(differentEvent.status, 200);
  assert.deepEqual(await differentEvent.json(), { sent: 1 });
  assert.equal(sentMessages.length, 3);
});
