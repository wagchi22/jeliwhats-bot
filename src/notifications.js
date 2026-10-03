const EVENT_LABELS = {
  AuthenticationFailed: 'Falha de autenticação',
  AuthenticationSucceeded: 'Autenticação realizada',
  ItemAdded: 'Novo item adicionado',
  PlaybackStart: 'Reprodução iniciada',
  PlaybackStop: 'Reprodução encerrada',
  PlaybackStopped: 'Reprodução encerrada',
  UserCreated: 'Novo usuário criado',
};

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim();
}

function formatNotification(payload) {
  if (typeof payload === 'string') {
    const message = payload.trim();
    if (message) return message;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('O corpo deve ser uma mensagem ou um objeto JSON.');
  }

  const directMessage = firstString(payload.message, payload.text);
  if (directMessage) return directMessage;

  const event = firstString(
    payload.NotificationType,
    payload.notificationType,
    payload.event,
    payload.type,
  );
  const itemName = firstString(payload.ItemName, payload.Name, payload.name, payload.title);
  const userName = firstString(
    payload.UserName,
    payload.userName,
    payload.Username,
    payload.NotificationUsername,
  );
  const deviceName = firstString(payload.DeviceName, payload.deviceName);
  const clientName = firstString(payload.ClientName, payload.clientName);
  const serverName = firstString(payload.ServerName, payload.serverName);
  const itemType = firstString(payload.ItemType, payload.itemType);
  const year = payload.ProductionYear ?? payload.Year ?? payload.year;
  const overview = firstString(payload.Overview, payload.overview);

  if (!event && !itemName && !userName && !serverName) {
    throw new TypeError('Informe message/text ou campos de um evento do Jellyfin.');
  }

  const label = EVENT_LABELS[event] || event || 'Notificação do Jellyfin';
  const lines = [`🔔 ${label}`];

  if (itemName) {
    const typeLabel = itemType ? ` (${itemType})` : '';
    const yearLabel = year ? ` (${year})` : '';
    lines.push(`🎬 ${itemName}${typeLabel}${yearLabel}`);
  }
  if (userName) lines.push(`👤 Usuário: ${userName}`);
  if (deviceName || clientName) {
    lines.push(`📱 Dispositivo: ${[deviceName, clientName].filter(Boolean).join(' / ')}`);
  }
  if (serverName) lines.push(`🖥️ Servidor: ${serverName}`);
  if (overview) lines.push(`\n${overview.slice(0, 500)}`);

  return lines.join('\n');
}

module.exports = { formatNotification };
