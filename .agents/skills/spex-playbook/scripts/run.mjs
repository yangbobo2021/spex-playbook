import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorktreeHostCapabilities } from '@sublang/playbook/host-capabilities';
import { findWorkflow, projectStore, writeJson } from './catalog.mjs';
import { createHostBridge, emit } from './host-bridge.mjs';

export async function loadRuntime(entryPath, cwd, effectLedger) {
  const { default: entry } = await import(pathToFileURL(entryPath).href);
  if (typeof entry?.id !== 'string' || !Array.isArray(entry.requiredRoleIds)
      || typeof entry.createRuntime !== 'function') {
    throw new Error('Playbook 编译入口缺少工作流标识、角色或运行工厂。');
  }
  const concurrentRoleSets = entry.concurrentRoleSets ?? [];
  const capabilities = await createWorktreeHostCapabilities({
    cwd, playbookId: entry.id, requiredRoleIds: entry.requiredRoleIds,
    concurrentRoleSets, effectLedger,
  });

  if (entry.artifactSchema === 3) {
    return { entry, capabilities, runtime: entry.createRuntime({}, capabilities) };
  }

  // SLC 0.22 can emit a legacy registration wrapper for role-free schema-3
  // bundles. The linked factory advertises its actual construction contract.
  const stem = basename(entryPath, '.ts');
  const { default: linkedFactory } = await import(pathToFileURL(
    join(dirname(entryPath), stem + '.playbook', stem + '.playbook.ts'),
  ).href);
  if (entry.requiredRoleIds.length === 0 && linkedFactory.compat?.artifactSchema === 3) {
    return { entry, capabilities, runtime: linkedFactory({
      configuredOptions: {}, hostCapabilities: capabilities,
    }) };
  }
  throw new Error('编译产物与当前 Playbook 宿主接口不兼容。');
}

async function modelResult(bridge, details) {
  const result = await bridge.request(details);
  if (!['ok', 'error', 'aborted'].includes(result.status)) throw new Error('无效的 Agent 结果状态。');
  if (result.status === 'ok' && typeof result.finalText !== 'string') {
    throw new Error('Agent 结果缺少 finalText。');
  }
  if (result.resumeToken !== undefined && typeof result.resumeToken !== 'string') {
    throw new Error('无效的原生子 Agent 续接标识。');
  }
  return result;
}

function sessionFor(runId, entry, bridge, observe, cwd) {
  const roleBindings = Object.fromEntries(entry.requiredRoleIds.map((role) =>
    [role, { playerId: role, promptIdentity: 'codex' }]));
  return {
    sessionId: runId, rootSessionId: runId, depth: 0,
    playbookId: entry.id, roleBindings,
    ports: {
      async callPlayer(role, prompt, signal, options) {
        observe.role = role;
        return modelResult(bridge, { kind: 'player', role, prompt, signal, options, cwd });
      },
      async callCaptain(prompt, signal, options) {
        return modelResult(bridge, { kind: 'captain', prompt, signal, options, cwd });
      },
      async callJudge(prompt, signal) {
        const reply = await modelResult(bridge, { kind: 'judge', prompt, signal, cwd });
        if (reply.status !== 'ok') throw new Error(reply.error ?? '宿主判定未完成。');
        return reply.finalText;
      },
      async callPlaybook(request) {
        throw new Error('当前 Skill 的执行入口无法派发子工作流：' + request.playbookId);
      },
      async emitStatus(message, data) {
        bridge.output({ type: 'progress', message, data });
      },
      async emitTelemetry(event) {
        if (event.topic === 'playbook.trace' && event.payload?.type === 'fsm.transition') {
          const transition = { type: 'transition', trace: event.payload };
          await bridge.log(transition);
          bridge.output(transition);
        }
      },
    },
  };
}

export async function executeTurn({ project, runId, workflow, snapshot, effectLedger, input, bridge, signal, directory }) {
  const { entry, runtime, capabilities } = await loadRuntime(workflow.entry, project, effectLedger);
  const observe = {};
  const session = sessionFor(runId, entry, bridge, observe, project);
  const statePath = join(directory, 'state.json');
  try {
    if (snapshot) await runtime.restore(session, snapshot);
    else await runtime.init(session);
    const result = await runtime.handleBossInput({ text: input, signal });
    if (result.outcome === 'terminal') {
      const final = {
        status: 'terminal', runId, workflow: workflow.name,
        outcome: result.terminal, state: result.state, output: result.output,
        description: result.stateDescription,
      };
      await writeJson(statePath, final);
      return final;
    }

    const view = runtime.describe?.();
    const ledger = capabilities.effectLedger.snapshot();
    if (view?.pendingQuestions.length) {
      const saved = runtime.exportSnapshot?.();
      if (!saved || typeof runtime.restore !== 'function') {
        throw new Error('当前运行时无法保存等待答复的流程状态。');
      }
      await writeJson(statePath, { status: 'waiting', runId, workflow, snapshot: saved, effectLedger: ledger });
      return { status: 'waiting', runId, workflow: workflow.name, questions: view.pendingQuestions };
    }
    const problem = result.error ?? view?.lastError;
    const failure = {
      status: 'failed', runId, workflow: workflow.name, step: result.state,
      role: observe.role, description: view?.stateDescription,
      error: problem?.message ?? problem?.reason ?? '流程未到达结束状态：' + result.outcome,
    };
    await writeJson(statePath, failure);
    return failure;
  } finally {
    await runtime.dispose();
  }
}

async function runCommand([operation, location, target, input]) {
  if (!location || !target) throw new Error('用法：run.mjs <start|resume> <项目目录> <工作流名称或运行 ID> <输入或答复>');
  if (!['start', 'resume'].includes(operation)) throw new Error('无法识别运行操作。');
  const project = resolve(location);
  let workflow;
  let runId;
  if (operation === 'start') {
    const found = await findWorkflow(project, target);
    if (found.status !== 'found') return found;
    workflow = found.workflow;
    runId = randomUUID();
  } else {
    if (!/^[a-f0-9-]{36}$/.test(target)) throw new Error('无效的运行 ID。');
    runId = target;
  }
  if (typeof input !== 'string' || !input.trim()) return { status: 'missing-input' };

  process.chdir(project);
  const directory = join(projectStore(project), 'runs', runId);
  if (operation === 'start') {
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory);
  }
  const lease = join(directory, 'active');
  await mkdir(lease);
  let bridge;
  let exchange;
  try {
    let previous;
    if (operation === 'resume') {
      previous = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
      if (previous.status !== 'waiting' || previous.runId !== runId) {
        throw new Error('该运行当前未等待用户答复。');
      }
      workflow = previous.workflow;
    }
    // The runtime observes the worktree around callbacks. Keep bridge writes
    // outside it until the turn has finished.
    exchange = await mkdtemp(join(tmpdir(), 'spex-playbook-turn-'));
    bridge = await createHostBridge(exchange);
    return await executeTurn({
      project, runId, workflow, input, bridge, directory,
      snapshot: previous?.snapshot, effectLedger: previous?.effectLedger, signal: new AbortController().signal,
    }).catch(async (error) => {
      const failure = { status: 'failed', runId, workflow: workflow.name, error: error.message };
      await writeJson(join(directory, 'state.json'), failure);
      return failure;
    });
  } finally {
    bridge?.close();
    try {
      if (exchange) {
        await cp(exchange, join(directory, basename(exchange)), { recursive: true });
        await rm(exchange, { recursive: true });
      }
    } finally {
      await rmdir(lease);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runCommand(process.argv.slice(2));
    emit({ type: 'result', ...result });
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) {
    emit({ type: 'result', status: 'failed', error: error.message });
    process.exitCode = 1;
  }
}
