import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export function emit(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

export async function createHostBridge(directory, { input = process.stdin, output = emit } = {}) {
  await mkdir(directory, { recursive: true });
  const pending = new Map();
  const receipt = join(directory, 'calls.jsonl');
  const log = (record) => appendFile(receipt, JSON.stringify(record) + '\n');
  let closed = false;
  const lines = createInterface({ input, terminal: false });

  function close() {
    if (closed) return;
    closed = true;
    for (const reply of pending.values()) reply.reject(new Error('Codex 宿主连接已关闭。'));
    lines.close();
    input.pause();
  }
  lines.on('close', close);

  async function accept(line) {
    let message;
    let reply;
    try {
      message = JSON.parse(line);
      if (message?.type !== 'response' || typeof message.id !== 'string') throw new Error('需要带请求 ID 的 response。');
      reply = pending.get(message.id);
      if (!reply || reply.receiving) throw new Error('请求已处理或 ID 未匹配。');
      if (!['current', 'subagent'].includes(message.host?.kind)
          || typeof message.host.id !== 'string' || !message.host.id.trim()) {
        throw new Error('需要当前 Codex 会话或原生子 Agent 的标识。');
      }
      reply.receiving = true;
      const result = message.file ? JSON.parse(await readFile(message.file, 'utf8')) : message.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('需要 Agent 结果对象。');
      await log({ type: 'response', id: message.id, host: message.host, result });
      reply.resolve(result);
    } catch (error) {
      if (reply) reply.receiving = false;
      output({ type: 'protocol-error', id: message?.id, error: error.message });
    }
  }
  lines.on('line', (line) => { void accept(line); });

  async function request({ prompt, signal, ...details }) {
    signal?.throwIfAborted();
    const id = randomUUID();
    const promptFile = join(directory, id + '.txt');
    const event = { type: 'request', id, promptFile, ...details };
    await writeFile(promptFile, prompt, 'utf8');
    await log(event);
    signal?.throwIfAborted();
    if (closed) throw new Error('Codex 宿主连接已关闭。');
    const abort = () => pending.get(id)?.reject(signal.reason);
    try {
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        signal?.addEventListener('abort', abort, { once: true });
        output(event);
      });
    } finally {
      signal?.removeEventListener('abort', abort);
      pending.delete(id);
    }
  }

  return { request, close, output, log };
}
