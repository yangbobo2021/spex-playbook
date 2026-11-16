# spex-playbook

在 Codex 中用自然语言编译、查看、定位、重新编译和执行 SPEX Playbook。SLC 生成并检查编译产物，Playbook 根据产物驱动工作流。Agent 请求由当前 Codex 会话或它创建的原生子 Agent 处理。

## 安装

需要 Node.js 23.6 或更新版本。将仓库中的 `.agents/skills/spex-playbook/` 整个目录放到目标项目的 `.agents/skills/`，或放到用户的 `~/.agents/skills/`。在 Skill 目录运行 `npm ci`，然后从目标项目开启 Codex 会话。

## 使用

在本仓库可使用 `tests/fixtures/` 中的规程和 CSV 发出以下普通消息：

- 「把 `tests/fixtures/order-check.md` 编译为『订单核对』工作流。」
- 「列出这个项目的工作流，并告诉我『订单核对』的源文和当前产物在哪。」
- 「用『订单核对』检查 `tests/fixtures/valid.csv`。」
- 「规程更新了，用同一个名称重新编译『订单核对』。」

项目的工作流和编译产物位于 `.spex-playbook/`。重新编译成功后，同名工作流采用新产物。重新编译失败时继续使用上一份成功的产物。执行结果可提供本机临时目录中的运行记录位置。

在 Git 项目中运行受仓库约束的角色时，Playbook 需要在该工作树的 Git 元数据目录创建 `playbook-effect-claims` 协调锁。部分 Codex 权限配置会保护该目录。遇到协调锁写入失败时，Skill 会报告失败步骤和原因。可用相同的 Codex 宿主在项目权限允许的环境中运行，纯数据流程也可在独立的非 Git 工作目录运行。

Codex 自然语言是常规入口。本次验收使用 Codex CLI `0.166.0-alpha.5.1`，该版本将 `/playbook.workflows1` 识别为未知命令。

从仓库根目录运行 `node --test tests/workflow.test.mjs` 可复测目录、编译澄清、产物保留、执行和续接。

协议和脚本用法见 [宿主接入](.agents/skills/spex-playbook/references/host-bridge.md)。
