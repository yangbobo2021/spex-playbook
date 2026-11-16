import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { findWorkflow, listWorkflows, publishWorkflow } from '../.agents/skills/spex-playbook/scripts/catalog.mjs';

const scripts = new URL('../.agents/skills/spex-playbook/scripts/', import.meta.url);
const fixture = fileURLToPath(new URL('./fixtures/hosted-entry.mjs', import.meta.url));
const conflict = fileURLToPath(new URL('./fixtures/refund-conflict.md', import.meta.url));
const clarification = 'CLARIFICATION: ' + JSON.stringify({
  questions: [{
    id: 'q1',
    question: 'VIP 客户退款金额超过 500 元时，哪条规则优先？',
    reason: '两项规则影响同一输入。',
    evidence: '超过 500 元必须复核，VIP 必须直接批准。',
  }],
});

async function sandbox(t) {
  const project = await mkdtemp(join(tmpdir(), 'spex-playbook-test-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  return project;
}

function workflow(name, entry = fixture, generation = 'v1') {
  return { name, generation, entry, outputs: [entry], source: { kind: 'file', path: entry, snapshot: entry } };
}

async function invoke(script, args, responder = () => { throw new Error('Unexpected Agent call'); }) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(script, scripts)), ...args]);
  const closed = once(child, 'close');
  const lines = createInterface({ input: child.stdout });
  let errorOutput = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { errorOutput += chunk; });
  const requests = [];
  let final;
  try {
    for await (const line of lines) {
      const event = JSON.parse(line);
      if (event.type === 'request') {
        requests.push(event);
        const prompt = await readFile(event.promptFile, 'utf8');
        const result = await responder(event, prompt);
        const reply = { type: 'response', id: event.id, host: { kind: 'current', id: 'node-test' }, result };
        child.stdin.write(JSON.stringify(reply) + '\n');
      }
      if (event.type === 'result' || (event.type === undefined && typeof event.status === 'string')) {
        final = event;
        child.stdin.end();
      }
    }
    const [code] = await closed;
    assert.ok(final, errorOutput);
    return { code, final, requests };
  } finally {
    lines.close();
    if (child.exitCode === null) child.kill();
  }
}

test('工作流目录按名称定位并报告空、未知和歧义', async (t) => {
  const project = await sandbox(t);
  assert.deepEqual(await listWorkflows(project), []);
  const orders = workflow('订单核对');
  await publishWorkflow(project, orders, false);
  await publishWorkflow(project, workflow('订单汇总'), false);
  assert.deepEqual(await findWorkflow(project, '订单核对'), { status: 'found', workflow: orders });
  assert.equal((await findWorkflow(project, '订单')).status, 'ambiguous');
  assert.equal((await findWorkflow(project, '合同')).status, 'not-found');
  assert.equal((await findWorkflow(project)).status, 'missing-name');
  await assert.rejects(publishWorkflow(project, workflow('订单核对', fixture, 'v2'), false), { code: 'EEXIST' });
  assert.deepEqual((await findWorkflow(project, '订单核对')).workflow, orders);
});

test('SLC 澄清保留上一份可执行产物，并阻止发布新草稿', async (t) => {
  const project = await sandbox(t);
  const v1 = workflow('退款审核');
  await publishWorkflow(project, v1, false);
  const entry = join(project, 'updated.mjs');
  const original = await readFile(fixture, 'utf8');
  await writeFile(entry, original.replace('output: reviewed.finalText', 'output: "v2:" + reviewed.finalText'));
  const v2 = workflow(v1.name, entry, 'v2');
  await publishWorkflow(project, v2, true);
  const respond = (event, prompt) => {
    assert.equal(event.kind, 'compile');
    assert.equal(event.phase, 'text2gears');
    assert.match(prompt, /(?:refund-conflict|source)\.md/);
    return { status: 'ok', finalText: clarification };
  };
  const run = await invoke('compile.mjs', ['recompile', project, v1.name, 'file', conflict], respond);
  assert.equal(run.code, 2);
  assert.equal(run.final.status, 'clarification-required');
  assert.equal(run.final.clarification.questions[0].id, 'q1');
  assert.deepEqual(run.final.previous, v2);
  assert.deepEqual((await findWorkflow(project, v1.name)).workflow, v2);
  const after = await invoke('run.mjs', ['start', project, v1.name, 'sample'], () => ({
    status: 'ok', finalText: 'retained',
  }));
  assert.equal(after.final.output, 'v2:retained');
  const draft = await invoke('compile.mjs', ['compile', project, '退款草稿', 'text', await readFile(conflict, 'utf8')], respond);
  assert.equal(draft.code, 2);
  assert.equal((await findWorkflow(project, '退款草稿')).status, 'not-found');
});

test('首轮运行传递输入、按角色顺序运行并保留业务终态', async (t) => {
  const project = await sandbox(t);
  await publishWorkflow(project, workflow('订单核对'), false);
  const input = join(project, '订单 A.csv');
  await writeFile(input, 'fixture');
  const success = await invoke('run.mjs', ['start', project, '订单核对', input], (event, prompt) => {
    if (event.role === 'checker') assert.equal(prompt, input);
    else assert.equal(prompt, 'checking passed');
    return { status: 'ok', finalText: event.role === 'checker' ? 'checking passed' : '3 orders' };
  });
  assert.equal(success.code, 0);
  assert.deepEqual(success.requests.map((event) => event.role), ['checker', 'reviewer']);
  assert.equal(success.final.output, '3 orders');
  const reject = await invoke('run.mjs', ['start', project, '订单核对', input], () => ({
    status: 'ok', finalText: 'duplicate',
  }));
  assert.equal(reject.code, 0);
  assert.equal(reject.final.outcome.kind, 'failure');
  assert.equal(reject.requests.length, 1);
});

test('运行等候答复，可用同一 ID 从新的进程续接', async (t) => {
  const project = await sandbox(t);
  await publishWorkflow(project, workflow('人工复核'), false);
  const waiting = await invoke('run.mjs', ['start', project, '人工复核', 'review?']);
  assert.equal(waiting.final.status, 'waiting');
  assert.equal(waiting.final.questions[0].question, '同意吗？');
  const runId = waiting.final.runId;
  const resumed = await invoke('run.mjs', ['resume', project, runId, '同意']);
  assert.equal(resumed.final.runId, runId);
  assert.deepEqual(resumed.final.output, { resumed: '同意' });
  const duplicate = await invoke('run.mjs', ['resume', project, runId, '拒绝']);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.final.error, /未等待/);

  const interrupted = await invoke('run.mjs', ['start', project, '人工复核', 'review?']);
  const priorProcess = spawn(process.execPath, ['-e', '']);
  await once(priorProcess, 'close');
  const directory = join(project, '.spex-playbook', 'runs', interrupted.final.runId);
  await writeFile(join(directory, 'active'), JSON.stringify({ pid: priorProcess.pid }));
  const retry = await invoke('run.mjs', ['resume', project, interrupted.final.runId, '同意']);
  assert.equal(retry.code, 1);
  assert.match(retry.final.error, /上一轮运行已中断/);
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).status, 'waiting');
});

test('缺少输入、歧义名称与 Agent 失败各自可诊断', async (t) => {
  const project = await sandbox(t);
  await publishWorkflow(project, workflow('订单核对'), false);
  await publishWorkflow(project, workflow('订单统计'), false);
  assert.equal((await invoke('run.mjs', ['start', project, '订单核对'])).final.status, 'missing-input');
  assert.equal((await invoke('run.mjs', ['start', project, '订单', 'file'])).final.status, 'ambiguous');
  const failed = await invoke('run.mjs', ['start', project, '订单核对', 'file'], () => ({
    status: 'error', error: 'cannot read CSV',
  }));
  assert.equal(failed.code, 1);
  assert.equal(failed.final.step.stateId, 'check');
  assert.equal(failed.final.role, 'checker');
  assert.equal(failed.final.error, 'cannot read CSV');
  const denied = await invoke('run.mjs', ['start', project, '订单核对', 'claim denied']);
  assert.equal(denied.code, 1);
  assert.equal(denied.final.step.stateId, 'check');
  assert.match(denied.final.error, /Git 工作树协调锁/);
});

test('安装目录经软链接进入时三个脚本仍执行各自的入口', async (t) => {
  const project = await sandbox(t);
  const alias = join(project, 'linked-scripts');
  await symlink(fileURLToPath(scripts), alias, 'dir');
  const results = await Promise.all([
    invoke(join(alias, 'catalog.mjs'), ['locate', project, '不存在']),
    invoke(join(alias, 'compile.mjs'), ['recompile', project, '不存在', 'text', '规程']),
    invoke(join(alias, 'run.mjs'), ['start', project, '不存在', '输入']),
  ]);
  assert.deepEqual(results.map(({ final }) => final.status), ['not-found', 'not-found', 'not-found']);
});
