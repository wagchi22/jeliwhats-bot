function log(level, ...messages) {
  const timestamp = new Date()
    .toLocaleString('pt-BR', { hourCycle: 'h23' })
    .replace(',', '');
  const message = messages.map(String).join(' ');
  const normalizedMessage = message.replace(/\s+/g, ' ').trim();
  const stream = level === 'ERRO' ? process.stderr : process.stdout;
  const useColors = stream.isTTY && process.env.NO_COLOR === undefined;
  const timestampText = useColors ? `\u001b[90m${timestamp}\u001b[0m` : timestamp;
  const status = level === 'ERRO' ? `${level} ${normalizedMessage}` : level;
  const statusText = useColors
    ? `\u001b[${level === 'ERRO' ? '31' : '32'}m${status}\u001b[0m`
    : status;
  const messageText = level === 'ERRO' ? '' : ` ${normalizedMessage}`;
  const line = `${timestampText} ${statusText}${messageText}`;

  if (level === 'ERRO') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function logInfo(...messages) {
  log('INFO', ...messages);
}

function logError(...messages) {
  log('ERRO', ...messages);
}

module.exports = { logError, logInfo };
