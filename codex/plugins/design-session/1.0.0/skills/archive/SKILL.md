---
name: archive
description: 冻结一轮迭代的资料/摘要/决策/交付索引到 .ai/iterations/<iter-id>/。用法：/design-session:archive <项目目录> <iter-id>
---

# archive（迭代归档）

**参数**：`$ARGUMENTS` = `<项目目录> <iter-id>`，如 `OverseaPartner iter-1-release-20260430`。iter-id 建议格式：`iter-<序号>-<里程碑或分支>`

**REQUIRED BACKGROUND:** Read `shared/design-session-engine.md` for path conventions.

**目标**：在不污染团队知识库的前提下，把单轮迭代的原始输入、摘要、关键决策和交付索引冻结下来，供新终端和后续迭代按需恢复。

**步骤**：

1. **确认迭代标识**
   - 让归档目录落到 `<项目>/.ai/iterations/<iter-id>/`
   - `iter-id` 不要用模糊命名，至少要能体现序号和里程碑

2. **创建固定骨架**
   - `INDEX.md`
   - `00-iteration-summary.md`
   - `01-raw-input/`
   - `02-source-summaries/`
   - `03-decisions.md`
   - `04-deliverables-index.md`
   - `05-closure.md`

3. **冻结原始资料**
   - 默认来源是 `<项目>/资料/`
   - 复制当前活跃资料到 `01-raw-input/`，保留目录结构
   - **默认不删除源文件**；如需切换到下一迭代，再单独确认是否清空/重建 `<项目>/资料/`

4. **冻结理解证据**
   - 把本轮相关 `.ai/*-摘要.md` 复制到 `02-source-summaries/`
   - 如果摘要很多，先放最关键的一批；其余在 `INDEX.md` 标注来源即可

5. **写归档索引**
   - `00-iteration-summary.md`：本轮范围、结果、关键风险、下一轮接力点
   - `03-decisions.md`：只保留对后续开发仍有约束力的决策，不抄全部讨论过程
   - `04-deliverables-index.md`：列出正式设计文档、对接文档、测试报告、交接文档
   - `05-closure.md`：确认哪些已闭环，哪些只是临时冻结

6. **刷新第 1 层路由**
   - 更新 `.ai/README.md`，让新 session 知道最新归档在哪
   - 如本轮形成了新的长期规则/恢复提示，补进 `.ai/context.md`

7. **为下一轮留干净入口**
   - 归档完成后，提醒用户把 `<项目>/资料/` 恢复为"当前迭代收件箱"
   - 新迭代输入不要继续堆在旧资料之上
