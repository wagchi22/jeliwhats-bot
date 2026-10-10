const fs = require('node:fs');
const path = require('node:path');

const defaultLogPath = path.join(__dirname, '..', 'whatsapp-debug.txt');
const maxLogBytes = 1024 * 1024;

function sanitizeRequestUrl(value) {
  const url = new URL(value);
  const pathname = url.pathname
    .split('/')
    .map((segment) => {
      let decodedSegment;
      try {
        decodedSegment = decodeURIComponent(segment);
      } catch {
        return '[redacted]';
      }

      return (
        /^\d{7,}$/.test(decodedSegment)
        || /^[\da-f-]{16,}$/i.test(decodedSegment)
        || decodedSegment.length > 40
        || decodedSegment.includes('@')
          ? '[redacted]'
          : segment.replace(/\d{7,}/g, '[redacted]')
      );
    })
    .join('/');

  return `${url.origin}${pathname}`;
}

function rotateLogIfNeeded(filePath, nextRecordBytes) {
  if (!fs.existsSync(filePath)) return;
  if (fs.statSync(filePath).size + nextRecordBytes <= maxLogBytes) return;

  const rotatedPath = `${filePath}.1`;
  if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
  fs.renameSync(filePath, rotatedPath);
}

function createWhatsAppDebugLogger(enabled, filePath = defaultLogPath) {
  let active = enabled;

  return (event, details = {}) => {
    if (!active) return;

    const record = {
      timestamp: new Date().toISOString(),
      event,
      ...details,
    };
    const line = `${JSON.stringify(record)}\n`;

    try {
      rotateLogIfNeeded(filePath, Buffer.byteLength(line));
      fs.appendFileSync(filePath, line, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error) {
      active = false;
      console.error(
        'Não foi possível gravar o log local de diagnóstico do WhatsApp; gravação desativada:',
        error.message,
      );
    }
  };
}

function attachWhatsAppDebugListeners(page, log) {
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;

    const request = response.request();
    log('http-response', {
      status,
      method: request.method(),
      resourceType: request.resourceType(),
      url: sanitizeRequestUrl(response.url()),
    });
  });

  page.on('requestfailed', (request) => {
    log('request-failed', {
      error: request.failure()?.errorText || 'network error',
      method: request.method(),
      resourceType: request.resourceType(),
      url: sanitizeRequestUrl(request.url()),
    });
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      log('console-error', { detailsOmitted: true });
    }
  });

  page.on('pageerror', () => {
    log('page-error', { detailsOmitted: true });
  });
}

module.exports = {
  attachWhatsAppDebugListeners,
  createWhatsAppDebugLogger,
  maxLogBytes,
  sanitizeRequestUrl,
};
