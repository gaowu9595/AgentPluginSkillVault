---
name: next
description: 根据当前项目状态，主动给出最该执行的指令建议（分级：立即处理/当前阶段/下一阶段准备）。用法：/design-session:next <项目目录>
---

# next（下一步行动建议）

**参数**：`$ARGUMENTS` = `<项目目录>`

**REQUIRED BACKGROUND:** Read `shared/design-session-engine.md` for path conventions.

**目标**：根据当前项目状态，主动给出最该执行的指令建议，不需要用户记住所有指令。

**步骤**：

1. 读 `<项目>/.ai/context.md`（当前阶段、待确认项、下一步）
2. 读 `<项目>/架构设计/变更追踪.md`（未完成 checkbox 数量和优先级）
3. 综合判断，输出行动建议

**输出格式**：

```
## 建议的下一步行动

**🚨 立即处理**（阻塞当前阶段）：
→ /design-session change --pending --scope=p0
  原因：有 N 项 P0 变更未完成，评审前必须处理

**📋 当前阶段建议**：
→ /design-session audit
  原因：[具体原因]
→ /design-session save
  原因：[具体原因]

**⏳ 下一阶段准备**：
→ /design-session change --pending --scope=p1
  原因：有 N 项 P1 待处理，编码前完成

**💡 提示**：
- [当前阶段是什么，距离下一阶段还差什么]
```

**判断规则**：

| 条件 | 建议 |
|------|------|
| 有 P0 未完成 checkbox（评审前） | 🚨 立即：`change --pending --scope=p0` |
| 有 P1 未完成 checkbox（评审后=编码阶段） | 🚨 立即：`change --pending --scope=p1`（评审后详细设计升为P0） |
| 对话较长（本轮讨论了多个变更）| 📋 建议：`audit` |
| 距上次 save 有新讨论 | 📋 建议：`save` |
| 跨多个 session / 手动改过文档 / 变更追踪可能不完整 | ⚠️ 额外建议：`/design-session:check consistency`（兜底扫描） |
| 里程碑节点（编码完成、上线前） | ⚠️ 建议：`/design-session:check consistency`（全量验证） |
| 有新资料未分析 | 📋 建议：`analyze` |
| 不知道当前状态 | 📋 建议：`status` 或 `resume` |
| 设计文档已完成（概设或总设存在）且无 `.ai/工作量评估-*.md` | 📋 建议：`estimate`（非强制，可跳过） |
