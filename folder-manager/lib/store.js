const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// 🔑 cria um identificador único por projeto
function getProjectId(dir) {
  return crypto.createHash('md5').update(dir).digest('hex');
}

const BASE_ARCHIVE_DIR = path.join(os.homedir(), '.folder-archive');

function getProjectPaths(currentDir) {
  const projectId = getProjectId(currentDir);
  const projectDir = path.join(BASE_ARCHIVE_DIR, projectId);

  return {
    projectDir,
    metadataFile: path.join(projectDir, 'metadata.json'),
    ignoredFile: path.join(projectDir, 'ignored.json'),
    statusFile: path.join(projectDir, 'status.json'),
  };
}

async function loadMetadata(metadataFile) {
  await fs.ensureFile(metadataFile);
  try {
    return await fs.readJson(metadataFile);
  } catch {
    return [];
  }
}

async function saveMetadata(metadataFile, data) {
  await fs.writeJson(metadataFile, data, { spaces: 2 });
}

async function loadIgnored(ignoredFile) {
  try {
    const data = await fs.readJson(ignoredFile);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveIgnored(ignoredFile, names) {
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  await fs.writeJson(ignoredFile, unique, { spaces: 2 });
}

const FOLDER_STATUSES = ['free', 'busy', 'freeing'];

async function loadStatuses(statusFile) {
  try {
    const data = await fs.readJson(statusFile);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

async function saveStatuses(statusFile, statuses) {
  const sorted = Object.fromEntries(
    Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b))
  );
  await fs.writeJson(statusFile, sorted, { spaces: 2 });
}

function generateId() {
  return crypto.randomUUID();
}

async function getCurrentFolders(dir) {
  const items = await fs.readdir(dir);
  const folders = [];

  for (const item of items) {
    const full = path.join(dir, item);
    try {
      if ((await fs.stat(full)).isDirectory()) {
        folders.push(item);
      }
    } catch {
      // ignora erros (ex: permissão)
    }
  }

  return folders;
}

const CLONE_PATTERN = /^(.+)\.tmp(\d+)?$/;
const MAX_CLONE_SLOTS = 99;

function isCloneName(name) {
  return CLONE_PATTERN.test(name);
}

async function findAvailableCloneName(currentDir, sourceName, takenNames) {
  for (let index = 1; index <= MAX_CLONE_SLOTS; index += 1) {
    const candidate = index === 1 ? `${sourceName}.tmp` : `${sourceName}.tmp${index}`;

    if (takenNames.has(candidate)) {
      continue;
    }

    if (!(await fs.pathExists(path.join(currentDir, candidate)))) {
      return candidate;
    }
  }

  return null;
}

module.exports = {
  BASE_ARCHIVE_DIR,
  getProjectId,
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
};
