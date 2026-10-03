# Notificações do Jellyfin pelo WhatsApp

Pacote npm que inicia um serviço Node.js para receber notificações HTTP do
Jellyfin e encaminhá-las, via WhatsApp Web, aos números configurados. O envio usa
[whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js), uma biblioteca
não oficial; mantenha-a atualizada e considere os termos de uso do WhatsApp.
Para contornar a falha de conexão com versões recentes do WhatsApp Web, o
projeto fixa temporariamente o commit `85443fa` da
[PR #201853](https://github.com/wwebjs/whatsapp-web.js/pull/201853), que ainda
não foi incluído no pacote publicado. O `.npmrc` permite somente dependências
remotas declaradas neste `package.json`.

## Versionamento

O pacote npm se chama `jeliwhats-bot` e usa versionamento semântico
(`MAJOR.MINOR.PATCH`). A versão atual é `1.0.0`, registrada no `package.json`
e no `package-lock.json`, e sua tag Git é `v1.0.0`.

Para criar a próxima versão, com a árvore de trabalho limpa, execute um destes
comandos:

```powershell
npm version patch # correção compatível: 1.0.0 -> 1.0.1
npm version minor # funcionalidade compatível: 1.0.0 -> 1.1.0
npm version major # mudança incompatível: 1.0.0 -> 2.0.0
```

O npm atualiza os dois arquivos de manifesto e cria um commit e uma tag Git
`vX.Y.Z`. Depois, publique o commit e as tags com `git push origin main
--follow-tags`.

## Licença

Este projeto é distribuído sob a licença [MIT](./LICENSE).

## Requisitos

- Node.js 18.19 ou superior.
- Um navegador Chromium compatível com o Puppeteer usado por
  `whatsapp-web.js`.
- Jellyfin e o plugin Webhook instalados.

## Configuração

1. Instale o pacote globalmente com `npm install --global jeliwhats-bot`.
2. No diretório em que o serviço deve guardar a configuração e a sessão do
   WhatsApp, execute `jeliwhats-bot init`. O comando cria `.env` com um
   `API_TOKEN` aleatório. Ele falha se `.env` já existir, sem sobrescrever o
   arquivo.
3. Ajuste `WA_RECIPIENTS`, com números no formato internacional
   E.164 (código do país + DDD + número, sem `+`), separados por vírgula. O
   arquivo inicial usa números fictícios; substitua-os pelos destinatários
   desejados.
4. Se um dos destinatários for o mesmo número da conta WhatsApp conectada,
   defina `WA_SELF_NUMBER` com esse número completo para enviar pelo ID da
   própria conta. Deixe-o vazio se nenhum destinatário for a conta conectada.
5. Inicie com `jeliwhats-bot` e escaneie o QR code exibido no terminal
   pelo WhatsApp que será usado para enviar as notificações. A sessão fica
   salva em `.wwebjs_auth/`; não compartilhe nem versione essa pasta.

Para executar a partir do código-fonte em vez do pacote publicado, use
`npm install`, copie `.env.example` para `.env` e inicie com `npm start`.

No Windows, execute `.\whatsapp-bot.bat` no PowerShell ou dê duplo clique
nesse arquivo. Ele abre uma janela PowerShell separada para o bot; pressione
`Ctrl+C` nessa janela para encerrar a conexão e o navegador sem o prompt do
CMD para finalizar um arquivo em lotes. Também é possível iniciar diretamente
no PowerShell com `node .\src\index.js`.

Se o npm informar que o script de instalação do `puppeteer` foi bloqueado,
autorize-o e instale o navegador gerenciado pelo Puppeteer:

```powershell
npm.cmd install-scripts approve puppeteer
npm.cmd rebuild puppeteer
```

Ao iniciar, o terminal informa o progresso de abertura do navegador e da
conexão com o WhatsApp. Se mostrar somente que a API iniciou, sem QR code ou
mensagem de conexão, confira se o computador consegue acessar
`https://web.whatsapp.com/`. O serviço monitora continuamente os sinais
`CONNECTED`, `MAIN`, `NORMAL` e sincronização concluída no próprio WhatsApp
Web; quando todos forem verdadeiros, marca a API como pronta mesmo se a
biblioteca perder o evento `ready` durante uma navegação/reinjeção. Se a
conexão não for confirmada em 45 segundos, o terminal mostra um diagnóstico e
a API continua recusando envios até a conexão estar pronta.

O serviço inicia a API na porta definida por `PORT` (3000 por padrão). O
endpoint `GET /health` informa se o WhatsApp já está conectado.
O terminal mostra mensagens simples em português. Avisos conhecidos e não
fatais do WhatsApp Web, como os erros de persistência do navegador e de QPL,
são ocultados, assim como o erro transitório `Runtime.addBinding: Target
closed` emitido durante a navegação da página.

## Integração com o Webhook do Jellyfin

Configure o plugin para fazer uma requisição `POST` para
`http://<host-da-api>:3000/api/notifications`. O destino genérico do plugin
pode incluir o token no JSON do template, usando o campo `apiToken`; substitua
`<API_TOKEN>` pelo valor definido no `.env`:

```json
{
  "apiToken": "<API_TOKEN>",
  "notificationType": "{{json_encode NotificationType}}",
  "itemId": "{{json_encode ItemId}}",
  "message": "Jellyfin: {{#if_equals ItemType 'Episode'}}*{{json_encode SeriesName}} - {{json_encode Name}}* entrou no catálogo{{else}}*{{json_encode Name}}{{#if_exist Year}} ({{json_encode Year}}){{/if_exist}}* entrou no catálogo{{/if_equals}}"
}
```

Com **Item Added** selecionado e os tipos **Movies** e **Episodes** marcados,
o template gera, por exemplo, `Jellyfin: *Interestelar (2014)* entrou no
catálogo` para filmes e `Jellyfin: *Dark - Segredos* entrou no catálogo` para
episódios. Os títulos aparecem em negrito no WhatsApp. O ano do filme aparece
se o campo `Year` estiver disponível. O helper `json_encode` escapa os títulos
para JSON. Mantenha o token privado na configuração do plugin.

Os campos `notificationType` e `itemId` permitem à API ignorar eventos
repetidos do mesmo item e tipo durante 5 minutos. O intervalo pode ser alterado
com `WA_DEDUPE_WINDOW_SECONDS` no `.env`; use `0` para desativar a deduplicação.
Como a identificação usa o ID do item, títulos iguais de itens diferentes não
são descartados.

O terminal da API registra quando um webhook chega e informa recusas por
token, payload ou estado da conexão, sem registrar o token nem o conteúdo da
mensagem. Se nenhum `Webhook recebido.` aparecer ao gerar um evento, confira
se a URL usa um endereço alcançável pelo Jellyfin. `localhost` só funciona
quando Jellyfin e API compartilham a mesma máquina e rede; para outro
computador ou contêiner, use o endereço IP/host da máquina da API.
O destino genérico do Webhooks envia `text/plain` por padrão; a API aceita
templates JSON nesse formato e também quando o cabeçalho estiver definido
como `application/x-www-form-urlencoded`. Não é necessário configurar o
cabeçalho `Content-Type` manualmente.

O endpoint aceita JSON de eventos do Jellyfin (por exemplo,
`NotificationType`, `ItemName`, `ItemType`, `ProductionYear` e `UserName`).
Para templates/payloads personalizados, também aceita `{"message":"Texto da mensagem"}`.
Opcionalmente, envie `"recipient":"15550100101"` no JSON para entregar
somente a um dos números já configurados; números fora da lista são recusados.
Uma chamada autenticada para testar pode ser feita assim:

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/notifications `
  -Method Post `
  -Headers @{ "X-API-Key" = "<API_TOKEN>" } `
  -ContentType "application/json" `
  -Body '{"message":"Teste de notificação do Jellyfin"}'
```

O endpoint retorna `503` enquanto o WhatsApp estiver desconectado, `400` para
payloads inválidos e `502` se o envio falhar para algum destinatário. Proteja
a API contra acesso externo não autorizado e use HTTPS quando ela estiver
exposta fora da rede local.

Se o WhatsApp Web retornar `No LID for user` ao iniciar uma conversa nova, a
API tenta primeiro obter o identificador registrado pelo método
`getNumberId()` do cliente e, se necessário, consulta a sincronização de
contatos do WhatsApp. Quando encontra um LID, tenta o envio novamente pelo
chat correspondente. Essa resolução só é usada para esse erro específico;
outras falhas são retornadas sem repetir o envio. Se o destino for a própria
conta WhatsApp conectada, a API compara o número configurado com o número de
telefone da sessão e envia pelo LID próprio da conta quando corresponderem.

## Testes

Execute `npm test`.
