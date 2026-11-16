---
name: spex-playbook
description: 在当前 Codex 会话中编译自然语言规程为 SPEX Playbook，查看、定位、重新编译已保存的工作流，或运行已编译的工作流。用户要求把规程做成工作流、查看工作流产物或用已有工作流处理本次输入时使用。
---

# SPEX 工作流

在用户指定的项目目录中工作。默认使用当前项目根目录。工作流保存在该项目的 `.spex-playbook/workflows/` 下。

- 用户问「有哪些工作流」或「这个工作流在哪里」时，执行 `catalog.mjs list` 或 `locate`。
- 用户提供规程正文或文件并要求编译时，取得工作流名称，执行 `compile.mjs compile`。更新已有工作流时使用 `recompile`。编译成功后报告名称、源文及产物入口。遇到澄清或失败时，报告具体问题和现有产物的可用状态。
- 用户要求运行时，用 `catalog.mjs locate` 解析名称，取得该工作流需要的输入，再执行 `run.mjs start`。名称有多个候选时请用户选择。运行结果取自 Playbook 的终态或失败信息。
- 运行返回 `waiting` 时，把问题带回当前会话。用户回复后，用同一个运行 ID 执行 `run.mjs resume`。

编译、运行及答复的参数和宿主协议见 [宿主接入](references/host-bridge.md)。使用当前 Codex 或由它创建的原生子 Agent 处理每条 Agent 请求。Playbook 决定角色顺序、分支和结束结果。用户的普通自然语言消息可以触发上述操作。
