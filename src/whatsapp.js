async function resolveLid(client, phoneNumber) {
  const numberId = await client.getNumberId(phoneNumber);
  const resolvedNumberId = numberId?._serialized;
  if (
    typeof resolvedNumberId === 'string'
    && (resolvedNumberId.endsWith('@lid') || numberId.server === 'lid')
  ) {
    return resolvedNumberId;
  }

  const lid = await client.pupPage.evaluate(async (number) => {
    const syncUtils = window.require('WAWebContactSyncUtils');
    if (typeof syncUtils?.constructUsyncDeltaQuery !== 'function') {
      throw new Error('O WhatsApp Web não disponibilizou a consulta de contatos.');
    }

    const query = syncUtils.constructUsyncDeltaQuery([{
      type: 'add',
      phoneNumber: number,
    }]);
    const result = await query.execute();
    return result?.list?.[0]?.lid ?? null;
  }, phoneNumber);

  if (typeof lid !== 'string' || !lid) {
    throw new Error(
      'O WhatsApp não retornou um LID para este número pela consulta do número nem pela sincronização de contatos.',
    );
  }

  return lid.includes('@') ? lid : `${lid}@lid`;
}

async function resolveOwnAccountChatId(client, phoneNumber, configuredSelfNumber) {
  if (!client.info) return null;

  const ownWid = client.info?.wid;
  if (
    configuredSelfNumber === phoneNumber
    && typeof ownWid?._serialized === 'string'
    && ownWid._serialized
  ) {
    return ownWid._serialized;
  }

  const ownNumber = typeof ownWid?.user === 'string'
    ? ownWid.user.replace(/\D/g, '')
    : '';
  if (ownNumber === phoneNumber && typeof ownWid?._serialized === 'string') {
    return ownWid._serialized;
  }

  const ownAccount = await client.pupPage?.evaluate(() => {
    const meUser = window.require('WAWebUserPrefsMeUser');
    const phoneWid = meUser.getMaybeMePnUser();
    const lidWid = meUser.getMaybeMeLidUser();

    return {
      phoneNumber: phoneWid?.user?.replace(/\D/g, '') || '',
      phoneChatId: phoneWid?._serialized || '',
      lidChatId: lidWid?._serialized || '',
    };
  });

  if (!ownAccount) return null;
  if (ownAccount.phoneNumber !== phoneNumber) return null;
  return ownAccount.lidChatId || ownAccount.phoneChatId || null;
}

async function sendWhatsAppMessage(client, phoneNumber, message, configuredSelfNumber) {
  const ownChatId = await resolveOwnAccountChatId(
    client,
    phoneNumber,
    configuredSelfNumber,
  );
  if (ownChatId) {
    return client.sendMessage(ownChatId, message);
  }

  try {
    const sentMessage = await client.sendMessage(`${phoneNumber}@c.us`, message);
    if (!sentMessage) {
      throw new Error('O WhatsApp não confirmou o envio da mensagem.');
    }
    return sentMessage;
  } catch (error) {
    if (!/No LID for user/i.test(error?.message || String(error))) {
      throw error;
    }
  }

  const lidChatId = await resolveLid(client, phoneNumber);
  return client.sendMessage(lidChatId, message);
}

module.exports = { resolveOwnAccountChatId, sendWhatsAppMessage };
