#!/usr/bin/env node

const path = require('path');
const chalk = require('chalk').default;
const inquirer = require('inquirer').default;

const { version } = require('./package.json');
const {
  CommandError,
  collectFolders,
  archiveFolders,
  unarchiveFolders,
  ignoreFolders,
  unignoreFolders,
  setFolderStatus,
  cloneFolder,
  resolveClone,
  dropClone,
  resolveAllClones,
  dropAllClones,
  getFolderSize,
} = require('./lib/operations');
const { runInteractive } = require('./lib/interactive');
const { formatStatus, formatDate, formatStatusBadge } = require('./lib/format');

const USAGE = `
${chalk.bold('fm')} — arquiva e restaura pastas do diretório atual

${chalk.bold('Uso:')}
  fm                        abre o modo interativo
  fm archive <pasta...>     arquiva uma ou mais pastas
  fm archive --all          arquiva todas as pastas ativas (exceto ignoradas)
  fm unarchive <pasta...>   restaura uma ou mais pastas
  fm unarchive --all        restaura tudo que está arquivado neste projeto
  fm list                   lista as pastas ativas e arquivadas
  fm ignore <pasta...>      esconde pastas da lista e do modo interativo
  fm unignore <pasta...>    volta a mostrar pastas ignoradas
  fm busy <pasta...>        marca pastas como ocupadas
  fm freeing <pasta...>     marca pastas como em desocupação
  fm free <pasta...>        marca pastas como livres
  fm clone <pasta>          cria uma cópia descartável (<pasta>.tmp)
  fm drop <pasta.tmp>       apaga um clone descartável de vez
  fm drop --all             apaga todos os clones descartáveis (exceto ignorados)
  fm drop ... -y, --yes     apaga sem pedir confirmação
  fm --help, -h             mostra esta ajuda
  fm --version, -v          mostra a versão
`;

function printUsage() {
  console.log(USAGE);
}

function assertNoOptions(args, command) {
  const option = args.find((arg) => arg.startsWith('-'));

  if (option) {
    throw new CommandError(`Opção desconhecida para "${command}": ${option}`, true);
  }
}

async function runList(currentDir) {
  const { folders, ignored } = await collectFolders(currentDir);

  console.log(chalk.bold(`\nPastas em ${path.basename(currentDir)}:\n`));

  if (folders.length === 0) {
    console.log(chalk.gray('  nenhuma pasta encontrada'));
  }

  for (const folder of folders) {
    const badge = formatStatusBadge(folder);

    if (folder.state === 'active') {
      console.log(`  ${chalk.green('●')} ${folder.name} ${chalk.gray('(ativo)')} ${badge}`);
    } else if (folder.missing) {
      console.log(
        `  ${chalk.yellow('○')} ${folder.name} ${chalk.yellow('(arquivado — conteúdo não encontrado)')} ${badge}`
      );
    } else {
      console.log(
        `  ${chalk.red('○')} ${folder.name} ${chalk.gray(`(arquivado em ${formatDate(folder.createdAt)})`)} ${badge}`
      );
    }
  }

  if (ignored.length > 0) {
    const label = ignored.length === 1 ? 'pasta ignorada' : 'pastas ignoradas';
    console.log(chalk.gray(`\n  ${ignored.length} ${label}: ${ignored.join(', ')}`));
  }

  console.log();
}

async function runArchive(currentDir, args) {
  const all = args.includes('--all');
  const names = args.filter((arg) => arg !== '--all');

  assertNoOptions(names, 'archive');

  if (all && names.length > 0) {
    throw new CommandError('Use "fm archive --all" sem nomes de pasta', true);
  }

  if (!all && names.length === 0) {
    throw new CommandError(
      'Informe ao menos uma pasta: fm archive <pasta...> ou fm archive --all',
      true
    );
  }

  const entries = await archiveFolders(currentDir, names, { all });

  for (const entry of entries) {
    console.log(chalk.red(`Arquivado: ${entry.name}`));
  }
}

async function runUnarchive(currentDir, args) {
  const all = args.includes('--all');
  const names = args.filter((arg) => arg !== '--all');

  assertNoOptions(names, 'unarchive');

  if (all && names.length > 0) {
    throw new CommandError('Use "fm unarchive --all" sem nomes de pasta', true);
  }

  if (!all && names.length === 0) {
    throw new CommandError(
      'Informe ao menos uma pasta: fm unarchive <pasta...> ou fm unarchive --all',
      true
    );
  }

  const entries = await unarchiveFolders(currentDir, names, { all });

  for (const entry of entries) {
    console.log(chalk.green(`Restaurado: ${entry.name}`));
  }
}

async function runIgnore(currentDir, args) {
  assertNoOptions(args, 'ignore');

  if (args.length === 0) {
    throw new CommandError('Informe ao menos uma pasta: fm ignore <pasta...>', true);
  }

  const names = await ignoreFolders(currentDir, args);

  for (const name of names) {
    console.log(chalk.gray(`Ignorada: ${name}`));
  }
}

async function runUnignore(currentDir, args) {
  assertNoOptions(args, 'unignore');

  if (args.length === 0) {
    throw new CommandError('Informe ao menos uma pasta: fm unignore <pasta...>', true);
  }

  const names = await unignoreFolders(currentDir, args);

  for (const name of names) {
    console.log(chalk.green(`Voltou a aparecer: ${name}`));
  }
}

async function runSetStatus(currentDir, args, command, status) {
  assertNoOptions(args, command);

  if (args.length === 0) {
    throw new CommandError(`Informe ao menos uma pasta: fm ${command} <pasta...>`, true);
  }

  const names = await setFolderStatus(currentDir, args, status);

  for (const name of names) {
    console.log(`${name} → ${formatStatus(status)}`);
  }
}

async function runClone(currentDir, args) {
  assertNoOptions(args, 'clone');

  if (args.length !== 1) {
    throw new CommandError('Informe uma pasta: fm clone <pasta>', true);
  }

  const { sourceName, cloneName } = await cloneFolder(currentDir, args[0]);

  console.log(
    `${chalk.blue(`✔ Clone criado: ${cloneName}`)} ${chalk.gray(`(cópia de ${sourceName})`)}`
  );
}

async function runDrop(currentDir, args) {
  const skipConfirm = args.includes('--yes') || args.includes('-y');
  const all = args.includes('--all');
  const names = args.filter((arg) => arg !== '--yes' && arg !== '-y' && arg !== '--all');

  assertNoOptions(names, 'drop');

  if (all && names.length > 0) {
    throw new CommandError('Use "fm drop --all" sem nomes de pasta', true);
  }

  if (all) {
    return runDropAll(currentDir, skipConfirm);
  }

  if (names.length !== 1) {
    throw new CommandError('Informe um clone: fm drop <pasta.tmp>', true);
  }

  const clone = await resolveClone(currentDir, names[0]);

  if (!skipConfirm) {
    const size = await getFolderSize(clone.targetPath);
    const label = size ? `${clone.name} (${size})` : clone.name;

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Apagar ${label} de vez? Isso não tem volta.`,
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.gray('Nada foi apagado'));
      return;
    }
  }

  await dropClone(clone);

  console.log(chalk.red(`✔ Descartado: ${clone.name}`));
}

async function runDropAll(currentDir, skipConfirm) {
  const resolved = await resolveAllClones(currentDir);
  const { clones } = resolved;

  if (!skipConfirm) {
    console.log(chalk.bold('\nClones que serão apagados:\n'));

    for (const clone of clones) {
      const size = await getFolderSize(clone.targetPath);
      const details = [clone.entry ? 'arquivado' : null, size].filter(Boolean).join(', ');
      console.log(`  ${chalk.red('✖')} ${clone.name}${details ? chalk.gray(` (${details})`) : ''}`);
    }

    console.log();

    const label = clones.length === 1 ? '1 clone' : `${clones.length} clones`;

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Apagar ${label} de vez? Isso não tem volta.`,
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(chalk.gray('Nada foi apagado'));
      return;
    }
  }

  await dropAllClones(resolved);

  for (const clone of clones) {
    console.log(chalk.red(`✔ Descartado: ${clone.name}`));
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const currentDir = process.cwd();

  if (!command) {
    return runInteractive(currentDir);
  }

  switch (command) {
    case '--help':
    case '-h':
      return printUsage();
    case '--version':
    case '-v':
      return console.log(version);
    case 'list':
      return runList(currentDir);
    case 'archive':
      return runArchive(currentDir, args);
    case 'unarchive':
      return runUnarchive(currentDir, args);
    case 'ignore':
      return runIgnore(currentDir, args);
    case 'unignore':
      return runUnignore(currentDir, args);
    case 'busy':
      return runSetStatus(currentDir, args, command, 'busy');
    case 'freeing':
      return runSetStatus(currentDir, args, command, 'freeing');
    case 'free':
      return runSetStatus(currentDir, args, command, 'free');
    case 'clone':
      return runClone(currentDir, args);
    case 'drop':
      return runDrop(currentDir, args);
    default:
      throw new CommandError(`Comando desconhecido: "${command}"`, true);
  }
}

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    return;
  }

  console.error(chalk.red(`✖ ${err.message}`));

  if (!(err instanceof CommandError)) {
    console.error(chalk.gray(err.stack));
  } else if (err.showUsage) {
    printUsage();
  }

  process.exitCode = 1;
});
