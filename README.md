# jeliwhats-bot

Bot simples para receber notificações do Jellyfin e enviá-las para números do WhatsApp.

## O que ele faz

- recebe requisições HTTP do Jellyfin;
- valida um token secreto;
- envia mensagens para os destinatários configurados;
- ignora notificações duplicadas em um intervalo configurável;
- mostra um QR code para conectar a conta do WhatsApp.

## Requisitos

- Node.js 18.19+
- Chromium/Puppeteer compatível
- Jellyfin com o plugin `Webhook`

## Instalação

```bash
git clone https://github.com/wagchi22/jeliwhats-bot.git
cd jeliwhats-bot
npm install
```

## Configuração

1. Gere o arquivo `.env`:

```bash
node bin/jeliwhats-bot.js init
```

2. Ajuste os valores em `.env`:

```env
PORT=3000
API_TOKEN=troque-por-um-token-secreto
WA_RECIPIENTS=15550100101,15550100102
WA_SELF_NUMBER=
WA_DEDUPE_WINDOW_SECONDS=300
```

- `API_TOKEN`: token usado para autenticar requisições.
- `WA_RECIPIENTS`: números no formato E.164 sem `+`.
- `WA_SELF_NUMBER`: use apenas quando um destinatário for o próprio número da conta conectada.
- `WA_DEDUPE_WINDOW_SECONDS`: tempo para ignorar eventos repetidos; use `0` para desativar.

## Execução

```bash
npm start
```

Depois, escaneie o QR code exibido no terminal com a conta do WhatsApp.

No Windows, também é possível usar:

```powershell
.\jeliwhats-bot.bat
```

Ou iniciar direto:

```powershell
node .\src\index.js
```

A sessão do WhatsApp fica em `.wwebjs_auth/` e não deve ser compartilhada nem versionada.

O endpoint `GET /health` informa se a conexão com o WhatsApp já está pronta.

## Integração com o Jellyfin

Configure o webhook do Jellyfin para enviar requisições `POST` para:

```text
http://<host-da-api>:3000/api/notifications
```

Exemplo de payload com token e mensagem:

```json
{
  "apiToken": "<API_TOKEN>",
  "notificationType": "{{json_encode NotificationType}}",
  "itemId": "{{json_encode ItemId}}",
  "message": "Jellyfin: {{#if_equals ItemType 'Episode'}}*{{json_encode SeriesName}} - {{json_encode Name}}* entrou no catálogo{{else}}*{{json_encode Name}}{{#if_exist Year}} ({{json_encode Year}}){{/if_exist}}* entrou no catálogo{{/if_equals}}"
}
```

Você também pode enviar um payload simples:

```json
{
  "message": "Teste de notificação do Jellyfin"
}
```

Para autenticar via cabeçalho, use `X-API-Key` com o mesmo valor de `API_TOKEN`.

Exemplo de teste:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/notifications `
  -Method Post `
  -Headers @{ "X-API-Key" = "<API_TOKEN>" } `
  -ContentType "application/json" `
  -Body '{"message":"Teste de notificação do Jellyfin"}'
```

## Observações importantes

- `localhost` só funciona quando o Jellyfin e a API estiverem na mesma máquina ou rede local.
- Se a API estiver exposta fora da rede local, proteja-a com autenticação e use HTTPS.
- A API responde com `503` enquanto o WhatsApp estiver desconectado, `400` para payload inválido e `502` se o envio falhar para algum destinatário.
- O campo `recipient` pode ser usado para enviar a mensagem apenas para um número específico já configurado.

## Testes

```bash
npm test
```

## Licença

Este projeto está sob a licença [MIT](./LICENSE).
