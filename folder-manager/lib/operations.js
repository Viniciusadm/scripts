const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

const {
  getProjectPaths,
  loadMetadata,
  saveMetadata,
  loadIgnored,
  saveIgnored,
  FOLDER_STATUSES,
  loadStatuses,
  saveStatuses,
  generateId,
  getCurrentFolders,
  isCloneName,
  findAvailableCloneName,
} = require('./store');

class CommandError extends Error {
  constructor(message, showUsage = false) {
    super(message);
    this.name = 'CommandError';
    this.showUsage = showUsage;
  }
}

function assertPlainName(name) {
  if (!name || name !== path.basename(name) || name === '.' || name === '..') {
    throw new CommandError(`Nome de pasta inválido: "${name}"`);
  }
}

function assertNoDuplicates(names) {
  const seen = new Set();

  for (const name of names) {
    if (seen.has(name)) {
      throw new CommandError(`Pasta "${name}" informada mais de uma vez`);
    }
    seen.add(name);
  }
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function collectFolders(currentDir) {
  const { projectDir, metadataFile, ignoredFile, statusFile } = getProjectPaths(currentDir);

  await fs.ensureDir(projectDir);

  const metadata = await loadMetadata(metadataFile);
  const ignored = await loadIgnored(ignoredFile);
  const ignoredNames = new Set(ignored);
  const statuses = await loadStatuses(statusFile);
  const currentFolders = await getCurrentFolders(currentDir);

  const map = new Map();

  // 📁 Pastas atuais (ativas)
  for (const folder of currentFolders) {
    map.set(folder, {
      name: folder,
      state: 'active',
    });
  }

  // 📦 Pastas arquivadas desse projeto
  for (const item of metadata) {
    if (!map.has(item.name)) {
      map.set(item.name, {
        ...item,
        state: 'archived',
      });
    }
  }

  const folders = Array.from(map.values())
    .filter((folder) => !ignoredNames.has(folder.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of folders) {
    if (folder.state === 'archived') {
      folder.missing = !(await fs.pathExists(folder.archivedPath));
    }

    folder.status = statuses[folder.name]?.status ?? 'free';
    folder.statusSince = statuses[folder.name]?.updatedAt;
  }

  return {
    folders,
    metadata,
    metadataFile,
    projectDir,
    ignored,
    ignoredFile,
    statuses,
    statusFile,
  };
}

async function archiveFolders(currentDir, names, options = {}) {
  const { folders, metadata, metadataFile, projectDir } = await collectFolders(currentDir);

  if (options.all) {
    names = folders.filter((folder) => folder.state === 'active').map((folder) => folder.name);

    if (names.length === 0) {
      throw new CommandError('Nenhuma pasta ativa para arquivar neste projeto');
    }
  }

  assertNoDuplicates(names);

  const archivedNames = new Set(metadata.map((item) => item.name));
  const sources = [];

  for (const name of names) {
    assertPlainName(name);

    const source = path.join(currentDir, name);

    if (!(await isDirectory(source))) {
      throw new CommandError(`Pasta "${name}" não encontrada em ${currentDir}`);
    }

    if (archivedNames.has(name)) {
      throw new CommandError(`Já existe uma versão arquivada de "${name}"`);
    }

    sources.push({ name, source });
  }

  const entries = [];

  for (const { name, source } of sources) {
    const id = generateId();
    const dest = path.join(projectDir, `${name}__${id}`);

    await fs.move(source, dest);

    entries.push({
      id,
      name,
      archivedPath: dest,
      createdAt: new Date().toISOString(),
    });
  }

  await saveMetadata(metadataFile, [...metadata, ...entries]);

  return entries;
}

async function unarchiveFolders(currentDir, names, options = {}) {
  const { metadata, metadataFile } = await collectFolders(currentDir);

  if (options.all) {
    const requested = [...new Set(metadata.map((item) => item.name))];

    if (requested.length === 0) {
      throw new CommandError('Nenhuma pasta arquivada neste projeto');
    }

    return restoreEntries(currentDir, metadata, metadataFile, requested);
  }

  assertNoDuplicates(names);

  return restoreEntries(currentDir, metadata, metadataFile, names);
}

async function restoreEntries(currentDir, metadata, metadataFile, requested) {
  const targets = [];

  for (const name of requested) {
    assertPlainName(name);

    const entry = metadata.find((item) => item.name === name);

    if (!entry) {
      throw new CommandError(`"${name}" não está arquivada neste projeto`);
    }

    if (!(await fs.pathExists(entry.archivedPath))) {
      throw new CommandError(
        `Conteúdo arquivado de "${name}" não existe mais em ${entry.archivedPath}`
      );
    }

    const dest = path.join(currentDir, name);

    // evita sobrescrever sem querer
    if (await fs.pathExists(dest)) {
      throw new CommandError(`Já existe "${name}" em ${currentDir}`);
    }

    targets.push({ entry, dest });
  }

  for (const { entry, dest } of targets) {
    await fs.move(entry.archivedPath, dest);
  }

  const restoredIds = new Set(targets.map(({ entry }) => entry.id));

  await saveMetadata(
    metadataFile,
    metadata.filter((item) => !restoredIds.has(item.id))
  );

  return targets.map(({ entry }) => entry);
}

async function ignoreFolders(currentDir, names) {
  assertNoDuplicates(names);

  const { metadata, ignored, ignoredFile } = await collectFolders(currentDir);
  const archivedNames = new Set(metadata.map((item) => item.name));
  const ignoredNames = new Set(ignored);

  for (const name of names) {
    assertPlainName(name);

    if (ignoredNames.has(name)) {
      throw new CommandError(`"${name}" já está ignorada neste projeto`);
    }

    if (!archivedNames.has(name) && !(await isDirectory(path.join(currentDir, name)))) {
      throw new CommandError(`Pasta "${name}" não encontrada em ${currentDir} nem entre os arquivados`);
    }
  }

  await saveIgnored(ignoredFile, [...ignored, ...names]);

  return names;
}

async function unignoreFolders(currentDir, names) {
  assertNoDuplicates(names);

  const { ignored, ignoredFile } = await collectFolders(currentDir);
  const ignoredNames = new Set(ignored);

  for (const name of names) {
    assertPlainName(name);

    if (!ignoredNames.has(name)) {
      throw new CommandError(`"${name}" não está ignorada neste projeto`);
    }
  }

  const removed = new Set(names);

  await saveIgnored(
    ignoredFile,
    ignored.filter((name) => !removed.has(name))
  );

  return names;
}

async function setFolderStatus(currentDir, names, status) {
  if (!FOLDER_STATUSES.includes(status)) {
    throw new CommandError(`Estado inválido: "${status}"`);
  }

  assertNoDuplicates(names);

  const { metadata, statuses, statusFile } = await collectFolders(currentDir);
  const archivedNames = new Set(metadata.map((item) => item.name));

  for (const name of names) {
    assertPlainName(name);

    const isKnown =
      archivedNames.has(name) ||
      (await isDirectory(path.join(currentDir, name))) ||
      (status === 'free' && name in statuses);

    if (!isKnown) {
      throw new CommandError(`Pasta "${name}" não encontrada em ${currentDir} nem entre os arquivados`);
    }
  }

  const updated = { ...statuses };
  const updatedAt = new Date().toISOString();

  for (const name of names) {
    if (status === 'free') {
      delete updated[name];
    } else {
      updated[name] = { status, updatedAt };
    }
  }

  await saveStatuses(statusFile, updated);

  return names;
}

async function clearStatuses(statusFile, statuses, names) {
  const remaining = { ...statuses };
  let changed = false;

  for (const name of names) {
    if (name in remaining) {
      delete remaining[name];
      changed = true;
    }
  }

  if (changed) {
    await saveStatuses(statusFile, remaining);
  }
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function getFolderSize(target) {
  if (!target) {
    return null;
  }

  const { code, stdout } = await runCommand('du', ['-sh', target]);

  if (code !== 0) {
    return null;
  }

  return stdout.split('\t')[0].trim() || null;
}

async function cloneFolder(currentDir, name) {
  assertPlainName(name);

  if (isCloneName(name)) {
    throw new CommandError(`"${name}" já é um clone descartável — clone a pasta original`);
  }

  const source = path.join(currentDir, name);

  if (!(await isDirectory(source))) {
    throw new CommandError(`Pasta "${name}" não encontrada em ${currentDir}`);
  }

  const { metadata } = await collectFolders(currentDir);
  const takenNames = new Set(metadata.map((item) => item.name));
  const cloneName = await findAvailableCloneName(currentDir, name, takenNames);

  if (!cloneName) {
    throw new CommandError(`Não há nome de clone livre para "${name}"`);
  }

  const clonePath = path.join(currentDir, cloneName);
  const { code, stderr } = await runCommand('cp', ['-a', source, clonePath]);

  if (code !== 0) {
    await fs.remove(clonePath).catch(() => {});
    throw new CommandError(
      `Falha ao clonar "${name}": ${stderr.trim() || `cp terminou com código ${code}`}`
    );
  }

  return { sourceName: name, cloneName, clonePath };
}

async function resolveClone(currentDir, name) {
  assertPlainName(name);

  if (!isCloneName(name)) {
    throw new CommandError(
      `"${name}" não é um clone descartável — o drop só apaga pastas no padrão <nome>.tmp`
    );
  }

  const { metadata, metadataFile, statuses, statusFile } = await collectFolders(currentDir);
  const activePath = path.join(currentDir, name);

  if (await isDirectory(activePath)) {
    return {
      name,
      targetPath: activePath,
      entry: null,
      metadata,
      metadataFile,
      statuses,
      statusFile,
    };
  }

  const entry = metadata.find((item) => item.name === name);

  if (!entry) {
    throw new CommandError(
      `Clone "${name}" não encontrado em ${currentDir} nem entre os arquivados`
    );
  }

  const targetPath = (await fs.pathExists(entry.archivedPath)) ? entry.archivedPath : null;

  return { name, targetPath, entry, metadata, metadataFile, statuses, statusFile };
}

async function dropClone(clone) {
  if (clone.targetPath) {
    await fs.remove(clone.targetPath);
  }

  if (clone.entry) {
    await saveMetadata(
      clone.metadataFile,
      clone.metadata.filter((item) => item.id !== clone.entry.id)
    );
  }

  await clearStatuses(clone.statusFile, clone.statuses, [clone.name]);

  return clone;
}

async function resolveAllClones(currentDir) {
  const { folders, metadata, metadataFile, statuses, statusFile } =
    await collectFolders(currentDir);

  const clones = folders
    .filter((folder) => isCloneName(folder.name))
    .map((folder) => {
      if (folder.state === 'active') {
        return { name: folder.name, targetPath: path.join(currentDir, folder.name), entry: null };
      }

      return {
        name: folder.name,
        targetPath: folder.missing ? null : folder.archivedPath,
        entry: metadata.find((item) => item.id === folder.id),
      };
    });

  if (clones.length === 0) {
    throw new CommandError('Nenhum clone descartável neste projeto');
  }

  return { clones, metadata, metadataFile, statuses, statusFile };
}

async function dropAllClones({ clones, metadata, metadataFile, statuses, statusFile }) {
  for (const clone of clones) {
    if (clone.targetPath) {
      await fs.remove(clone.targetPath);
    }
  }

  const droppedIds = new Set(clones.filter((clone) => clone.entry).map((clone) => clone.entry.id));

  if (droppedIds.size > 0) {
    await saveMetadata(
      metadataFile,
      metadata.filter((item) => !droppedIds.has(item.id))
    );
  }

  await clearStatuses(
    statusFile,
    statuses,
    clones.map((clone) => clone.name)
  );

  return clones;
}

module.exports = {
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
};
