const test = require('node:test');
const assert = require('node:assert/strict');
const { logError, logInfo } = require('../src/logger');

test('writes timestamped INFO and ERRO messages as single lines', () => {
  const originalLog = console.log;
  const originalError = console.error;
  const infoLines = [];
  const errorLines = [];
  console.log = (line) => infoLines.push(line);
  console.error = (line) => errorLines.push(line);

  try {
    logInfo('API disponível', 'na porta 3000.');
    logError('Falha ao enviar notificação:', 'motivo\nem outra linha');
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.match(infoLines[0], /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} INFO API disponível na porta 3000\.$/);
  assert.match(errorLines[0], /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} ERRO Falha ao enviar notificação: motivo em outra linha$/);
});

test('colors INFO and ERRO output in terminals unless NO_COLOR is set', () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalStderrIsTTY = process.stderr.isTTY;
  const originalNoColor = process.env.NO_COLOR;
  const infoLines = [];
  const errorLines = [];
  console.log = (line) => infoLines.push(line);
  console.error = (line) => errorLines.push(line);
  process.stdout.isTTY = true;
  process.stderr.isTTY = true;
  delete process.env.NO_COLOR;

  try {
    logInfo('API disponível.');
    logError('Falha ao enviar notificação.');
    process.env.NO_COLOR = '';
    logInfo('Sem cores.');
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stdout.isTTY = originalStdoutIsTTY;
    process.stderr.isTTY = originalStderrIsTTY;
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  }

  assert.match(infoLines[0], /\u001b\[90m.*\u001b\[0m \u001b\[32mINFO\u001b\[0m API disponível\./);
  assert.match(errorLines[0], /\u001b\[90m.*\u001b\[0m \u001b\[31mERRO Falha ao enviar notificação\.\u001b\[0m/);
  assert.match(infoLines[1], /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} INFO Sem cores\.$/);
});
