const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cliPath = path.join(__dirname, '..', 'bin', 'jeliwhats-bot.js');

test('init creates a configured .env with a generated API token', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyfin-whatsapp-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [cliPath, 'init'], {
    cwd: directory,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(directory, '.env'), 'utf8');
  assert.match(config, /^API_TOKEN=[a-f0-9]{64}$/m);
  assert.match(config, /^WA_RECIPIENTS=15550100101,15550100102$/m);
});

test('init refuses to overwrite an existing .env', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyfin-whatsapp-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, 'API_TOKEN=keep-this-secret\n');

  const result = spawnSync(process.execPath, [cliPath, 'init'], {
    cwd: directory,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(envPath, 'utf8'), 'API_TOKEN=keep-this-secret\n');
  assert.match(result.stderr, /nada foi alterado/);
});

test('CLI help displays the available commands', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /jeliwhats-bot init/);
  assert.match(result.stdout, /inicia a API/);
});
