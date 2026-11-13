---
name: next
description: 根据项目阶段和证据状态计算缺失、过期的检查及下一步；在询问下一步、是否可编码或担心遗漏审核时使用。
---

# next（下一步行动建议）

**参数**：`$ARGUMENTS` = `<项目目录>`

**REQUIRED BACKGROUND:** Read `shared/design-session-engine.md` for path conventions.

**目标**：根据当前项目状态，主动给出最该执行的指令建议，不需要用户记住所有指令。

**步骤**：

1. 读 `shared/workflow.md` 和 `<项目>/.ai/context.md`，定位当前迭代范围及状态文件。
2. 运行 `python <插件根>/shared/scripts/workflow_gate.py evaluate <项目>`；多迭代使用已登记的 `--state`。保留输出与退出码。
3. 读 `<项目>/架构设计/变更追踪.md`，把仍影响当前范围的 P0/P1 纳入阻塞结论。状态不存在时先核验已有报告并登记；没有证据则保持 unknown，不把整个项目自动重新审查。
4. 输出“检查项 / 状态 / 依据或缺口 / 下一动作”表，包含模板、数据库、安全、内容四项；不适用项也显示原因和依据。按脚本 next_action 选择最早缺项，产品阻塞优先处理。
5. 含当前新增/变更接口时，核对content_gate报告是否实际覆盖可读契约、接口复用取舍、适用的源码下钻、字段来源/消费者/删除影响、正常/失败复述及唯一维护位置（执行细则见 `../write/references/interface-review.md`）。缺少时只补该范围核对，不能仅凭Schema存在或ready结果宣称接口完整；已有等价证据直接复用，不因插件更新重开全部历史审查。
6. 只有 ready=true 且变更追踪无遗漏阻塞，才建议保留基线并编码。其他情况说明缺哪项；save/estimate 是附加建议，不能替代检查。已有有效检查复用，过期只做受影响范围的复查。

完整分支图见 `shared/workflow-flowchart.md`。下方规则用于补充说明，不覆盖脚本的结果。check database 和 database-review 为同一检查的两个入口，不串行重复执行。

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
| 概要设计含数据库变更，且 database-review 标记缺失/stale/摘要不匹配 | 🚨 立即：`/design-session:database-review <概要设计路径>`；数据库审核优先于 estimate、save 和普通 consistency，低于尚未处理的产品 P0 |
| 有 P1 未完成 checkbox（评审后=编码阶段） | 🚨 立即：`change --pending --scope=p1`（评审后详细设计升为P0） |
| 对话较长（本轮讨论了多个变更）| 📋 建议：`audit` |
| 距上次 save 有新讨论 | 📋 建议：`save` |
| 跨多个 session / 手动改过文档 / 变更追踪可能不完整 | ⚠️ 额外建议：`/design-session:check consistency`（兜底扫描） |
| 里程碑节点（编码完成、上线前） | ⚠️ 建议：`/design-session:check consistency`（全量验证） |
| 有新资料未分析 | 📋 建议：`analyze` |
| `input_status=analyzed` 但 `journey_status` 不是 `confirmed` | 🚨 立即：`requirements-clarify` |
| `journey_status=confirmed` 但 `p0_status=open` | 🚨 立即：处理产品 P0，不得写系统需求 |
| 审查输入指纹变化但状态仍为 `passed` | 🚨 立即：将受影响审查标记为 `stale`，执行对应增量审核 |
| 不知道当前状态 | 📋 建议：`status` 或 `resume` |
| 设计文档已完成（概设或总设存在）且无 `.ai/工作量评估-*.md` | 📋 建议：`estimate`（非强制，可跳过） |
