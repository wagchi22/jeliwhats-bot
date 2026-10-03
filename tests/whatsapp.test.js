const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveOwnAccountChatId,
  sendWhatsAppMessage,
} = require('../src/whatsapp');

test('sends a direct phone-number message without querying the LID', async () => {
  const sent = [];
  const client = {
    sendMessage: async (chatId, message) => {
      sent.push({ chatId, message });
      return { id: 'message-id' };
    },
  };

  await sendWhatsAppMessage(client, '15550100101', 'Teste');
  assert.deepEqual(sent, [{
    chatId: '15550100101@c.us',
    message: 'Teste',
  }]);
});

test('sends to the linked account using its own WhatsApp ID', async () => {
  const sent = [];
  const client = {
    info: {
      wid: {
        user: '15550100101',
        _serialized: 'own-account@lid',
      },
    },
    pupPage: {
      evaluate: async () => assert.fail('Own-account ID is already available'),
    },
    sendMessage: async (chatId, message) => {
      sent.push({ chatId, message });
      return { id: 'message-id' };
    },
  };

  await sendWhatsAppMessage(client, '15550100101', 'Teste para minha conta');
  assert.deepEqual(sent, [{
    chatId: 'own-account@lid',
    message: 'Teste para minha conta',
  }]);
});

test('uses the linked account ID only for the explicitly configured own number', async () => {
  const sent = [];
  const client = {
    info: {
      wid: {
        user: 'account-lid',
        _serialized: 'own-account@lid',
      },
    },
    sendMessage: async (chatId, message) => {
      sent.push({ chatId, message });
      return { id: 'message-id' };
    },
  };

  await sendWhatsAppMessage(
    client,
    '15550100101',
    'Teste para minha conta',
    '15550100101',
  );
  assert.deepEqual(sent, [{
    chatId: 'own-account@lid',
    message: 'Teste para minha conta',
  }]);
});

test('accepts a completed own-account send when WhatsApp returns no message object', async () => {
  const sent = [];
  const client = {
    info: {
      wid: {
        user: 'account-lid',
        _serialized: 'own-account@lid',
      },
    },
    sendMessage: async (chatId, message) => {
      sent.push({ chatId, message });
      return undefined;
    },
  };

  await assert.doesNotReject(
    sendWhatsAppMessage(
      client,
      '15550100101',
      'Teste para minha conta',
      '15550100101',
    ),
  );
  assert.deepEqual(sent, [{
    chatId: 'own-account@lid',
    message: 'Teste para minha conta',
  }]);
});

test('does not use the linked account ID when recipient differs from own number', async () => {
  const client = {
    info: {
      wid: {
        user: 'account-lid',
        _serialized: 'own-account@lid',
      },
    },
    getNumberId: async () => null,
    pupPage: {
      evaluate: async (_query, phoneNumber) => (
        phoneNumber ? null : { phoneNumber: '', phoneChatId: '', lidChatId: '' }
      ),
    },
    sendMessage: async (chatId) => {
      assert.notEqual(chatId, 'own-account@lid');
      throw new Error('No LID for user');
    },
  };

  await assert.rejects(
    sendWhatsAppMessage(
      client,
      '15550100102',
      'Teste',
      '15550100101',
    ),
    /não retornou um LID/,
  );
});

test('resolves the linked account LID when ClientInfo contains a different ID', async () => {
  const client = {
    info: { wid: { user: 'account-lid', _serialized: 'account-lid@lid' } },
    pupPage: {
      evaluate: async () => ({
        phoneNumber: '15550100101',
        phoneChatId: '15550100101@c.us',
        lidChatId: 'account-lid@lid',
      }),
    },
    sendMessage: async () => ({ id: 'message-id' }),
  };

  assert.equal(
    await resolveOwnAccountChatId(client, '15550100101'),
    'account-lid@lid',
  );
  await sendWhatsAppMessage(client, '15550100101', 'Teste');
});

test('does not use the linked account LID for a different recipient', async () => {
  const client = {
    info: { wid: { user: 'account-lid', _serialized: 'account-lid@lid' } },
    pupPage: {
      evaluate: async () => ({
        phoneNumber: '15550100101',
        phoneChatId: '15550100101@c.us',
        lidChatId: 'account-lid@lid',
      }),
    },
  };

  assert.equal(
    await resolveOwnAccountChatId(client, '15550100102'),
    null,
  );
});

test('resolves a missing LID and retries a message to the LID chat', async () => {
  const sent = [];
  const client = {
    getNumberId: async () => null,
    pupPage: {
      evaluate: async (_query, phoneNumber) => {
        if (!phoneNumber) {
          return { phoneNumber: '', phoneChatId: '', lidChatId: '' };
        }
        assert.equal(phoneNumber, '15550100101');
        return 'contact-lid@lid';
      },
    },
    sendMessage: async (chatId, message) => {
      sent.push({ chatId, message });
      if (chatId.endsWith('@c.us')) throw new Error('No LID for user');
      return undefined;
    },
  };

  await assert.doesNotReject(
    sendWhatsAppMessage(client, '15550100101', 'Teste'),
  );
  assert.deepEqual(sent, [
    { chatId: '15550100101@c.us', message: 'Teste' },
    { chatId: 'contact-lid@lid', message: 'Teste' },
  ]);
});

test('uses whatsapp-web.js number lookup when it returns a LID', async () => {
  const sent = [];
  const client = {
    getNumberId: async (number) => {
      assert.equal(number, '15550100101');
      return {
        user: 'resolved-contact',
        server: 'lid',
        _serialized: 'resolved-contact@lid',
      };
    },
    pupPage: {
      evaluate: async () => assert.fail('Contact sync is unnecessary when getNumberId found the LID'),
    },
    sendMessage: async (chatId, message) => {
      sent.push({ chatId, message });
      if (chatId.endsWith('@c.us')) throw new Error('No LID for user');
      return { id: 'message-id' };
    },
  };

  await sendWhatsAppMessage(client, '15550100101', 'Teste');
  assert.deepEqual(sent, [
    { chatId: '15550100101@c.us', message: 'Teste' },
    { chatId: 'resolved-contact@lid', message: 'Teste' },
  ]);
});

test('reports when WhatsApp cannot resolve a LID', async () => {
  const client = {
    getNumberId: async () => null,
    pupPage: {
      evaluate: async (_query, phoneNumber) => (
        phoneNumber ? null : { phoneNumber: '', phoneChatId: '', lidChatId: '' }
      ),
    },
    sendMessage: async () => {
      throw new Error('No LID for user');
    },
  };

  await assert.rejects(
    sendWhatsAppMessage(client, '15550100101', 'Teste'),
    /não retornou um LID/,
  );
});

test('does not retry unrelated WhatsApp send errors', async () => {
  const client = {
    pupPage: {
      evaluate: async () => assert.fail('LID lookup is unnecessary'),
    },
    sendMessage: async () => {
      throw new Error('WhatsApp disconnected');
    },
  };

  await assert.rejects(
    sendWhatsAppMessage(client, '15550100101', 'Teste'),
    /WhatsApp disconnected/,
  );
});
