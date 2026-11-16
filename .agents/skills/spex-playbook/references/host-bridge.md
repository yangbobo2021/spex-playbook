# Codex 宿主接入

从 Skill 自身位置解析 `scripts/`。从用户项目根目录执行以下形式的命令，给项目目录、工作流名和输入分别传单独参数。命令示例中的 `$scripts` 指向本 Skill 的 `scripts/`。

```sh
node "$scripts/catalog.mjs" list "$project"
node "$scripts/catalog.mjs" locate "$project" "$workflow"
node "$scripts/compile.mjs" compile "$project" "$workflow" file "$source_path"
node "$scripts/compile.mjs" compile "$project" "$workflow" text "$source_text"
node "$scripts/compile.mjs" recompile "$project" "$workflow" file "$source_path"
node "$scripts/run.mjs" start "$project" "$workflow" "$input"
node "$scripts/run.mjs" resume "$project" "$run_id" "$answer"
```

运行 `compile.mjs` 和 `run.mjs` 时，使用可以继续写入标准输入的终端会话，在同一进程回合内处理 JSONL。保持工作流输入原样。用户给出已有文件时，用该文件的绝对路径作为工作流输入。

## 回传 Agent 结果

1. 收到 `type: "request"` 后，读取它的 `promptFile`，按请求指定的 `cwd` 和提示处理。请求还有 `id` 和 `kind`。编译请求标记阶段，角色请求标记 `role`。
2. `compile` 和 `player` 可由当前宿主直接处理，或交给当前 Codex 的原生子 Agent。给子 Agent 完整提示和工作目录。按工作流角色保留各自的原生会话。`options.resume` 给出已有子 Agent 标识时，使用宿主的原生续接。会话不可用时，使用 `options.freshPrompt`（如有）或当前请求的完整提示。SLC 机械校验要求修正时，按提示要求回传完整的纠正结果对象，包括每项处置与 `result`。
3. `captain` 和 `judge` 仍由当前宿主处理。`judge` 以及明确要求空工具列表的控制请求按提示完成判定本身。把模型最终文本原样回传给运行时。
4. 向步骤 1 的进程标准输入发送一行 JSON，末尾加换行。填写真实请求 ID。每条响应提供 `host`，写明当前 Codex 会话或对应原生子 Agent 的调用标识。角色有可用的原生续接标识时，将它作为 `resumeToken` 回传。

```json
{"type":"response","id":"<request id>","host":{"kind":"subagent","id":"<native child id>"},"result":{"status":"ok","finalText":"<actual response>","resumeToken":"<native child id>"}}
```

`status` 为 `ok`、`error` 或 `aborted`。成功时提供 `finalText`。失败时提供 `error`。用当前会话处理时，`host.kind` 为 `current`，角色续接标识可以省略。回复文本较长时，把 `result` 对象写入本地 JSON 文件，使用 `file` 发送文件的绝对路径，保留外层的 `type`、`id` 和 `host`。

`progress` 和 `transition` 是观察事件。`protocol-error` 表示回复无法匹配或解析，按返回的 ID 修正后再提交。`result` 结束当前进程。终态返回后呈现业务结果。状态为 `waiting` 时保存其运行 ID，将问题交给用户，并在同一 Codex 会话用回复续接。编译待澄清时展示 SLC 给出的问题，待规程补全后重新发起编译。

续接回合中途退出时，如果运行报告上一轮已中断，先查看运行目录和工作流已经产生的操作，再决定是否发起新运行。

编译请求记录在对应候选产物目录的 `calls.jsonl`。执行请求记录在 `.spex-playbook/runs/<运行 ID>/` 的回合目录下。
