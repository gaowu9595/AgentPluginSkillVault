---
name: status
description: 快速查看项目当前进展。读取 context.md 的"当前进展"部分，输出精简状态。用法：/design-session:status <项目目录>
---

# status（查看状态）

**参数**：`$ARGUMENTS` = `<项目目录>`

**REQUIRED BACKGROUND:** Read `shared/design-session-engine.md` for path conventions.

**目标**：快速查看当前进展，不读全部文档。

1. 读 `<项目>/.ai/context.md` 的"当前进展"部分
2. 输出精简状态
