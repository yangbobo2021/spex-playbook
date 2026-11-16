# spex-playbook

在 Codex 中用自然语言编译、查看、定位、重新编译和执行 SPEX Playbook。SLC 生成并检查编译产物，Playbook 根据产物驱动工作流。Agent 请求由当前 Codex 会话或它创建的原生子 Agent 处理。

## 安装

需要 Node.js 23.6 或更新版本。将仓库中的 `.agents/skills/spex-playbook/` 整个目录放到目标项目的 `.agents/skills/`，或放到用户的 `~/.agents/skills/`。在 Skill 目录运行 `npm ci`，然后从目标项目开启 Codex 会话。

## 使用

向 Codex 发普通消息即可：

- 「把 `order-check.md` 编译为『订单核对』工作流。」
- 「列出这个项目的工作流，并告诉我『订单核对』的源文和当前产物在哪。」
- 「用『订单核对』检查 `orders.csv`。」
- 「规程更新了，用同一个名称重新编译『订单核对』。」

项目运行数据位于 `.spex-playbook/`。重新编译成功后，同名工作流采用新产物。重新编译失败时继续使用上一份成功的产物。

Codex 自然语言是常规入口。本次验收使用 Codex CLI `0.166.0-alpha.5.1`，该版本将 `/playbook.workflows1` 识别为未知命令。

从仓库根目录运行 `node --test tests/workflow.test.mjs` 可复测目录、编译澄清、产物保留、执行和续接。

协议和脚本用法见 [宿主接入](.agents/skills/spex-playbook/references/host-bridge.md)。
