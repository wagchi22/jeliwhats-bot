const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  attachWhatsAppDebugListeners,
  createWhatsAppDebugLogger,
  maxLogBytes,
  sanitizeRequestUrl,
} = require('../src/debug-log');

test('does not create a debug log when diagnostics are disabled', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jeliwhats-debug-'));
  const filePath = path.join(directory, 'whatsapp-debug.txt');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  createWhatsAppDebugLogger(false, filePath)('http-response', { status: 403 });

  assert.equal(fs.existsSync(filePath), false);
});

test('writes local diagnostic records without request secrets or message contents', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jeliwhats-debug-'));
  const filePath = path.join(directory, 'whatsapp-debug.txt');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const log = createWhatsAppDebugLogger(true, filePath);
  const page = new EventEmitter();
  attachWhatsAppDebugListeners(page, log);

  const request = {
    method: () => 'GET',
    resourceType: () => 'image',
    failure: () => null,
  };
  page.emit('response', {
    status: () => 403,
    request: () => request,
    url: () => 'https://mmg.whatsapp.net/image/1234567890123456?token=private-token',
  });
  page.emit('response', {
    status: () => 200,
    request: () => request,
    url: () => 'https://mmg.whatsapp.net/image/ok',
  });
  page.emit('console', {
    type: () => 'error',
    text: () => 'private message content',
  });
  page.emit('pageerror', new Error('private JavaScript details'));

  const contents = fs.readFileSync(filePath, 'utf8');
  const records = contents.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(records.length, 3);
  assert.deepEqual(records[0], {
    timestamp: records[0].timestamp,
    event: 'http-response',
    status: 403,
    method: 'GET',
    resourceType: 'image',
    url: 'https://mmg.whatsapp.net/image/[redacted]',
  });
  assert.deepEqual(records[1], {
    timestamp: records[1].timestamp,
    event: 'console-error',
    detailsOmitted: true,
  });
  assert.deepEqual(records[2], {
    timestamp: records[2].timestamp,
    event: 'page-error',
    detailsOmitted: true,
  });
  assert.doesNotMatch(contents, /private-token|private message content|private JavaScript details|1234567890123456/);
});

test('strips query strings and redacts sensitive request path segments', () => {
  assert.equal(
    sanitizeRequestUrl('https://example.test/assets/1234567890123456/%31%32%33%34%35%36%37%38/app.js?token=secret#section'),
    'https://example.test/assets/[redacted]/[redacted]/app.js',
  );
});

test('rotates the local debug log when it reaches its size limit', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jeliwhats-debug-'));
  const filePath = path.join(directory, 'whatsapp-debug.txt');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  fs.writeFileSync(filePath, 'x'.repeat(maxLogBytes));
  createWhatsAppDebugLogger(true, filePath)('http-response', { status: 403 });

  assert.equal(fs.statSync(`${filePath}.1`).size, maxLogBytes);
  assert.match(fs.readFileSync(filePath, 'utf8'), /"status":403/);
});
