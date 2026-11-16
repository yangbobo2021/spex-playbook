import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createInterpretedExecutor, createPipelineResolver, createReviewingAgent, runSlc, withReservedPipelines,
} from '@sublang/slc';
import { findExactWorkflow, findWorkflow, publishWorkflow, workflowDir } from './catalog.mjs';
import { createHostBridge, emit } from './host-bridge.mjs';
import { loadRuntime } from './run.mjs';

const modules = fileURLToPath(new URL('../node_modules', import.meta.url));

export async function compileWorkflow({ project, name, sourceKind, source, replacing = false }) {
  let previous;
  if (replacing) {
    const result = await findWorkflow(project, name);
    if (result.status !== 'found') return result;
    previous = result.workflow;
    name = previous.name;
  } else {
    previous = await findExactWorkflow(project, name);
    if (previous) return { status: 'exists', workflow: previous };
  }
  const generation = randomUUID();
  const directory = join(workflowDir(project, name), generation);
  await mkdir(directory, { recursive: true });
  const bridge = await createHostBridge(directory);
  let phase = 'source';
  try {
    const sourcePath = sourceKind === 'file' ? await realpath(resolve(project, source)) : undefined;
    const inputText = sourcePath ? await readFile(sourcePath, 'utf8') : source;
    if (!inputText.trim()) throw new Error('工作流规程为空。');
    const copy = join(directory, sourcePath ? 'source' + extname(sourcePath) : 'source.md');
    await writeFile(copy, inputText);
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    await symlink(modules, join(directory, 'node_modules'), 'dir');
    const executor = createInterpretedExecutor({
      agent: createReviewingAgent({ coder: {
        async run({ prompt, signal, allowedTools, resume }) {
          const reply = await bridge.request({
            kind: 'compile', phase, prompt, signal, cwd: directory, allowedTools,
            options: { resume },
          });
          if (!['ok', 'error', 'aborted'].includes(reply.status)) throw new Error('无效的编译 Agent 结果。');
          if (reply.status === 'ok' && typeof reply.finalText !== 'string') throw new Error('编译 Agent 缺少 finalText。');
          return {
            status: reply.status === 'ok' ? 'success' : reply.status === 'aborted' ? 'incomplete' : 'error',
            text: reply.finalText ?? reply.error ?? 'Agent 未完成编译阶段。',
            resumeToken: typeof reply.resumeToken === 'string' ? reply.resumeToken : undefined,
          };
        },
      } }),
      config: { cwd: directory },
    });
    // Resolve the published pipeline definitions without project-local pins, so
    // the compiler routes its Agent work through our interpreted executor.
    const result = await runSlc(['playbook', sourcePath ?? copy], {
      cwd: directory, executor,
      resolver: withReservedPipelines(createPipelineResolver([])),
      progress(event) {
        if (event.kind === 'phase-start') {
          phase = event.phase;
          bridge.output({ type: 'progress', phase, target: event.target });
        }
      },
    });
    if (!result.ok) {
      return {
        status: result.outcome === 'clarification-required' ? 'clarification-required' : 'failed',
        name, phase, clarification: result.clarification,
        diagnostics: result.diagnostics, previous,
      };
    }

    phase = 'entry';
    const entry = result.outputs.find((path) => dirname(path) === directory && path.endsWith('.ts'));
    if (!entry) throw new Error('SLC 未生成工作流注册入口。');
    const { runtime } = await loadRuntime(entry, project);
    await runtime.dispose();
    if (sourcePath && await readFile(sourcePath, 'utf8') !== inputText) {
      throw new Error('规程文件在编译期间发生变化，请使用当前版本重新编译。');
    }
    await Promise.all(result.outputs.map((path) => access(path)));
    const record = {
      name: name.trim(), generation, entry, outputs: result.outputs,
      source: { kind: sourceKind, path: sourcePath ?? copy, snapshot: copy },
    };
    await publishWorkflow(project, record, replacing);
    return { status: 'compiled', workflow: record };
  } catch (error) {
    return { status: 'failed', phase, name, diagnostics: [error.message], previous };
  } finally {
    bridge.close();
  }
}

async function compileCommand([operation, location, name, sourceKind, source]) {
  if (!['compile', 'recompile'].includes(operation) || !location || !name
      || !['file', 'text'].includes(sourceKind) || typeof source !== 'string') {
    throw new Error('用法：compile.mjs <compile|recompile> <项目目录> <工作流名称> <file|text> <源文件或正文>');
  }
  return compileWorkflow({
    project: resolve(location), name, sourceKind, source, replacing: operation === 'recompile',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await compileCommand(process.argv.slice(2));
    emit({ type: 'result', ...result });
    if (result.status === 'failed') process.exitCode = 1;
    if (result.status === 'clarification-required') process.exitCode = 2;
  } catch (error) {
    emit({ type: 'result', status: 'failed', diagnostics: [error.message] });
    process.exitCode = 1;
  }
}
