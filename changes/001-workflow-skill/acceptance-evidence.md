# spex-playbook 首版验收证据

验收编号 AT-spex-playbook。代码版本 7bb18ef。范围来自 [已确认规格](spec.md)。

便于在 GitHub 复核，下文附上 Codex CLI 对话中的工具输出及独立复审的原始输出摘录。JSON 只保留判定所用字段。机器路径和完整的会话、请求及产物标识以占位符或短标识呈现。同一短标识对应同一个原始标识。验收使用合成订单和退款样本，覆盖当前 Codex 宿主及 Codex CLI 0.166.0-alpha.5.1。部分模型产物经过纠正和重新编译，构建记录以最终成功结果为准。

## 1. 自然语言编译

分别用普通消息提供规程正文和规程文件。两次的编译入口都能从目录查到。

```json
[
  {
    "status": "compiled",
    "workflow": {
      "name": "问候",
      "entry": "<workspace>/source.ts",
      "source": {
        "kind": "text",
        "path": "<workspace>/source.md"
      }
    }
  },
  {
    "status": "compiled",
    "workflow": {
      "name": "文件问候",
      "entry": "<workspace>/greeting.ts",
      "source": {
        "kind": "file",
        "path": "<workspace>/greeting.md"
      }
    }
  }
]
```

## 2. 冲突澄清

将 VIP 大额退款的冲突规程用于重编译。SLC 返回结构化澄清。

```json
{
  "status": "clarification-required",
  "phase": "text2gears",
  "question": "VIP 客户的退款金额超过 500 元时，应交由 Boss 人工复核，还是跳过复核直接批准？",
  "choices": [
    "交由 Boss 人工复核",
    "跳过复核直接批准"
  ]
}
```

## 3. 查看与定位

全新安装的目录为空。已保存的工作流返回源文和当前入口。缺失名称得到明确的未找到结果。

```json
[
  {
    "status": "listed",
    "workflows": []
  },
  {
    "status": "found",
    "workflow": {
      "name": "订单核对",
      "entry": "<workspace>/order-check.ts",
      "source": {
        "kind": "file",
        "path": "<workspace>/order-check.md"
      }
    }
  },
  {
    "status": "not-found",
    "name": "离线发票"
  }
]
```

## 4. 重新编译与保留上一份产物

「问候」从旧规则更新到「欢迎」。随后提交冲突规程，编译停在待澄清。用同一工作流名称和同一输入再次运行，仍得到之前成功编译的结果。

```json
{
  "successfulRecompile": {
    "status": "compiled",
    "generation": "a6780b4f"
  },
  "firstRun": {
    "status": "terminal",
    "workflow": "问候",
    "outcome": {
      "stateId": "done",
      "kind": "success"
    },
    "output": {
      "response": "欢迎，小林"
    }
  },
  "failedRecompile": {
    "status": "clarification-required",
    "previousGeneration": "a6780b4f"
  },
  "nextRun": {
    "status": "terminal",
    "workflow": "问候",
    "outcome": {
      "stateId": "done",
      "kind": "success"
    },
    "output": {
      "response": "欢迎，小林"
    }
  }
}
```

## 5. 订单核对的通过与退回

两条请求都通过普通 Codex 消息提交。测试输入为 [合规 CSV](../../tests/fixtures/valid.csv) 和 [重复订单 CSV](../../tests/fixtures/duplicate.csv)。退回使用已重编译的从 0 开始的数据行号。

```json
[
  {
    "status": "terminal",
    "workflow": "订单核对",
    "outcome": {
      "stateId": "approved",
      "kind": "success"
    },
    "output": {
      "status": "通过",
      "reviewResult": "有效订单数：3 条\n按币种汇总金额：\n- CNY 13.25\n- USD 2.50"
    }
  },
  {
    "status": "terminal",
    "workflow": "订单核对",
    "outcome": {
      "stateId": "rejected",
      "kind": "failure"
    },
    "output": {
      "status": "退回",
      "duplicateOrderReport": "发现重复订单号 A01，出现在第 0、1 条数据行（从 0 开始，对应 CSV 文件第 2、3 行）。两条记录的金额分别为 10.00 CNY 和 3.25 CNY。"
    }
  }
]
```

## 6. 目标与输入不明确

对歧义名称返回两个候选。收到选择后，订单核对才进入终态。缺少输入的对话先问了 CSV 路径。

```json
[
  {
    "status": "ambiguous",
    "candidates": [
      "订单复核",
      "订单核对"
    ]
  },
  {
    "status": "terminal",
    "workflow": "订单核对",
    "outcome": {
      "stateId": "approved",
      "kind": "success"
    },
    "output": {
      "status": "通过",
      "reviewResult": "有效订单数为 3 笔。按币种汇总为 CNY 13.25，USD 2.50。"
    }
  }
]
```

```text
已找到「订单核对」工作流。每次运行需要指定一个 CSV 文件。请告诉我这次要核对 `valid.csv`、`duplicate.csv`，还是其他路径下的 CSV。
```

## 7. 同一运行续接与失败诊断

退款测试的两个回合对应同一个运行。独立复审保留真实 Git 工作树身份，复现权限拒绝并核对了失败来源步骤。

```json
[
  {
    "status": "waiting",
    "runId": "fca52932",
    "questions": [
      {
        "questionId": "manualReview",
        "asker": {
          "kind": "captain"
        },
        "question": "是否批准这笔退款？请回复「同意」或「拒绝」。如拒绝，请附上原因。",
        "sourceItem": "refund-explicit-7"
      }
    ]
  },
  {
    "runId": "fca52932",
    "status": "terminal",
    "workflow": "退款人工复核",
    "outcome": {
      "stateId": "approved",
      "kind": "success"
    },
    "output": {
      "response": "通过"
    }
  }
]
```

```json
{
  "status": "failed",
  "step": {
    "stateId": "checking"
  },
  "error": "当前 Codex 权限无法写入 Playbook 的 Git 工作树协调锁。EPERM: operation not permitted, mkdir '<git-dir>/playbook-effect-claims/.stage-<id>'"
}
```

### 原 Git 工作区的定向放行复跑

在前次失败的 Git 工作区中，使用同一个 `live/valid.csv` 和同一个工作流产物 `acdc837c` 复跑。CSV 与仓库的[合规测试样本](../../tests/fixtures/valid.csv)逐字节相同。Codex CLI 版本为 `0.166.0-alpha.5.1`。本次 CLI 调用使用继承 `:workspace` 的一次性权限配置，新增的唯一写权限为实际仓库的 `<repo>/.git/playbook-effect-claims`。Git 仍解析到原仓库的 Git 元数据目录。

实际运行记录依次请求核对员和复核员，状态经过 `ready → checking → reviewing → approved`。CLI 退出码为 `0`。

```json
{
  "status": "terminal",
  "workflow": "订单核对",
  "outcome": {
    "stateId": "approved",
    "kind": "success"
  },
  "output": {
    "status": "通过",
    "reviewResult": "有效订单数为 3 笔。\n按币种汇总为CNY 13.25，USD 2.50。"
  }
}
```

## 8. 当前 Codex 宿主与原生子 Agent

以下字段来自桥接请求和原生子会话元数据的关联结果。七个请求均来自同一父会话。核对和复核由两个不同的子会话承担。

| 阶段或角色 | 请求 | 原生子会话 | 父会话 | 深度 |
| --- | --- | --- | --- | --- |
| text2gears | 9a75a6e7 | 01a1e397-4b73 | 01a1e308-a3e6 | 1 |
| optimize | 4456a864 | 01a1e397-4b73 | 01a1e308-a3e6 | 1 |
| prefix | a6ea199a | 01a1e397-4b73 | 01a1e308-a3e6 | 1 |
| gears2fsm | f087ae1c | 01a1e397-4b73 | 01a1e308-a3e6 | 1 |
| link | 1e9a80f4 | 01a1e397-4b73 | 01a1e308-a3e6 | 1 |
| 核对员 | 8a1b6de1 | 01a1e391-2421 | 01a1e308-a3e6 | 1 |
| 复核员 | 35b2b759 | 01a1e397-6a9b | 01a1e308-a3e6 | 1 |

## 9. 条件性斜杠命令

当前 CLI 将目标形式判为未知命令。同版本的自然语言运行记录见第 5 项。

```text
Codex CLI v0.166.0-alpha.5.1, installed with the desktop app.
Submitted in the interactive composer: /playbook.workflows1 acceptance.csv
Observed: Unrecognized command '/playbook.workflows1'. Type "/" for a list of supported commands.
```

## 独立复审与回归

同一个只读订单流程单独运行成功。第二个工作流在第一个仍在执行时进入等待，订单流程仍返回相同结果。以下摘自 7bb18ef 的独立复跑。

```json
[
  {
    "probe": "order alone",
    "status": "terminal",
    "output": {
      "status": "通过",
      "reviewResult": "有效订单 3 笔。CNY 13.25，USD 2.50。"
    }
  },
  {
    "probe": "overlap waiting",
    "status": "waiting",
    "output": null
  },
  {
    "probe": "order with overlap",
    "status": "terminal",
    "output": {
      "status": "通过",
      "reviewResult": "有效订单 3 笔。CNY 13.25，USD 2.50。"
    }
  }
]
```

从仓库根目录运行以下命令可复测目录、SLC 澄清、上一份产物保留、角色执行、答复续接、中断诊断与符号链接入口。

```sh
npm ci --prefix .agents/skills/spex-playbook
node --test tests/workflow.test.mjs
```

Node.js 23.6.0

```text
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Node.js 25.5.0

```text
ℹ tests 6
ℹ pass 6
ℹ fail 0
```
