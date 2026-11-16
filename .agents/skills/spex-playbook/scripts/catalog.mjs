import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function projectStore(project) {
  return resolve(project, '.spex-playbook');
}

function key(name) {
  return name.trim().normalize('NFC').toLowerCase();
}

export function workflowId(name) {
  const normalized = key(name);
  if (!normalized || /[\r\n\0]/.test(name)) throw new Error('请提供有效的工作流名称。');
  return createHash('sha256').update(normalized).digest('hex');
}

export function workflowDir(project, name) {
  return join(projectStore(project), 'workflows', workflowId(name));
}

async function current(directory) {
  try {
    return JSON.parse(await readFile(join(directory, 'current.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function listWorkflows(project) {
  const root = join(projectStore(project), 'workflows');
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const records = await Promise.all(entries.filter((entry) => entry.isDirectory())
    .map((entry) => current(join(root, entry.name))));
  return records.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

export async function findWorkflow(project, query) {
  const normalized = query === undefined ? '' : key(query);
  if (!normalized) return { status: 'missing-name' };
  const records = await listWorkflows(project);
  const exact = records.find((record) => key(record.name) === normalized);
  if (exact) return { status: 'found', workflow: exact };
  const matches = records.filter((record) => key(record.name).startsWith(normalized));
  if (matches.length === 1) return { status: 'found', workflow: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches.map(({ name }) => name) };
  return { status: 'not-found', name: query };
}

export async function findExactWorkflow(project, name) {
  return current(workflowDir(project, name));
}

export async function writeJson(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp);
    throw error;
  }
}

export async function publishWorkflow(project, record, replacing) {
  const directory = workflowDir(project, record.name);
  const path = join(directory, 'current.json');
  await mkdir(directory, { recursive: true });
  if (replacing) {
    await writeJson(path, record);
    return;
  }
  const temp = join(directory, randomUUID() + '.json');
  await writeJson(temp, record);
  try {
    await link(temp, path);
  } finally {
    await unlink(temp);
  }
}

export async function catalogCommand([operation, project, name]) {
  if (!project) throw new Error('用法：catalog.mjs <list|locate> <项目目录> [工作流名称]');
  if (operation === 'list') return { status: 'listed', workflows: await listWorkflows(project) };
  if (operation === 'locate') return findWorkflow(project, name);
  throw new Error('无法识别管理操作。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await catalogCommand(process.argv.slice(2))));
  } catch (error) {
    console.log(JSON.stringify({ status: 'failed', error: error.message }));
    process.exitCode = 1;
  }
}
