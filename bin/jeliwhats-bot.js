#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function initializeConfig(directory = process.cwd()) {
  const envPath = path.join(directory, '.env');
  const templatePath = path.join(__dirname, '..', '.env.example');
  const template = fs.readFileSync(templatePath, 'utf8');
  const token = crypto.randomBytes(32).toString('hex');
  const config = template.replace(/^API_TOKEN=.*$/m, `API_TOKEN=${token}`);

  try {
    fs.writeFileSync(envPath, config, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Já existe um arquivo .env em ${directory}; nada foi alterado.`);
    }
    throw error;
  }
  console.log(`Configuração criada em ${envPath}. Ajuste WA_RECIPIENTS no arquivo.`);
}

function printUsage() {
  console.log(`Uso:
  jeliwhats-bot init    cria um .env neste diretório
  jeliwhats-bot         inicia a API e conecta ao WhatsApp`);
}

async function run(args = process.argv.slice(2)) {
  const [command, ...extraArgs] = args;
  if (!command) {
    const { start } = require('../src');
    await start();
    return;
  }

  if ((command === '--help' || command === '-h') && extraArgs.length === 0) {
    printUsage();
    return;
  }

  if (command === 'init' && extraArgs.length === 0) {
    initializeConfig();
    return;
  }

  console.error('Comando ou argumento inválido.');
  printUsage();
  process.exitCode = 1;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
