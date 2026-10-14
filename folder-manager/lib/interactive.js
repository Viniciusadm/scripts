const path = require('path');
const inquirer = require('inquirer').default;
const chalk = require('chalk').default;

const { collectFolders, archiveFolders, unarchiveFolders } = require('./operations');
const { formatStatus } = require('./format');

async function runInteractive(currentDir) {
  const { folders } = await collectFolders(currentDir);

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: `Gerencie suas pastas (${path.basename(currentDir)}):`,
      choices: folders.map((item) => ({
        name: `${item.name} (${item.state === 'active' ? 'ativo' : 'arquivado'}) [${formatStatus(item.status)}]`,
        value: item.name,
        checked: item.state === 'active',
      })),
    },
  ]);

  for (const item of folders) {
    const isSelected = selected.includes(item.name);

    try {
      // 🔴 ATIVO → DESMARCADO → ARQUIVAR
      if (item.state === 'active' && !isSelected) {
        await archiveFolders(currentDir, [item.name]);
        console.log(chalk.red(`Arquivado: ${item.name}`));
      }

      // 🟢 ARQUIVADO → MARCADO → RESTAURAR
      else if (item.state === 'archived' && isSelected) {
        await unarchiveFolders(currentDir, [item.name]);
        console.log(chalk.green(`Restaurado: ${item.name}`));
      }
    } catch (err) {
      console.log(chalk.yellow(`⚠ ${item.name}: ${err.message}`));
    }
  }

  console.log(chalk.blue('\n✔ Sincronizado com sucesso\n'));
}

module.exports = { runInteractive };
