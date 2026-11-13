# design-session 外部资源索引

> 本文件声明 design-session 插件的资源架构。
> **核心原则：插件自带所有必需模板，不依赖外部知识库即可运行。**

## 资源架构（v2.0 — 无状态化）

各 skill 自带 `references/` 目录，存放该 skill 运行所需的模板和参考文件：

```
skills/
├── write/references/
│   ├── design-template.md          # 概要设计模板（701 行）
│   └── design-guide.md             # 概要设计编写指南（263 行）
├── write-overall/references/
│   ├── overall-design-template.md  # 总体设计模板（900 行）
│   └── overall-design-guide.md     # 总体设计编写指南（726 行）
├── write-spec/references/
│   ├── dfx-requirements.md         # DFX 需求格式（96 行）
│   ├── testability.md              # 可测试性 4 维度（131 行）
│   ├── dfx-baseline.md             # DFX 基线指标（205 行）
│   └── quality-criteria.md         # 质量评估标准（192 行）
└── check/references/
    └── quality-criteria.md         # 质量评估标准（192 行）
```

## 加载策略

1. **skill 内嵌核心规则**：每个 skill 的 SKILL.md 中已内嵌最关键的规则（禁止项、模板骨架、检查清单），无需读取任何文件即可开始工作
2. **按需 Read 加载**：到特定步骤时（如 DFX 编写），Read 加载 `references/` 下的详细格式文件
3. **不依赖知识库**：即使 `knowledge/` 目录不存在，插件也能正常运行

## 与知识库的关系

`knowledge/公共知识/` 下的原始文件是这些 references 的**来源**。如果知识库中的模板更新了，需要同步更新插件 references：

| 知识库原始文件 | 插件 references 副本 |
|--------------|---------------------|
| `知识库/系统需求/2-DFX需求.md` | `write-spec/references/dfx-requirements.md` |
| `知识库/系统需求/3-可测试性.md` | `write-spec/references/testability.md` |
| `知识库/系统需求/5-DFX基线指标.md` | `write-spec/references/dfx-baseline.md` |
| `知识库/系统需求/6-质量评估标准.md` | `write-spec/references/quality-criteria.md` |
| `知识库/设计文档/概要设计模板.md` | `write/references/design-template.md` |
| `知识库/设计文档/概要设计编写指南.md` | `write/references/design-guide.md` |
| `知识库/设计文档/总体设计模板.md` | `write-overall/references/overall-design-template.md` |
| `知识库/设计文档/总体设计编写指南.md` | `write-overall/references/overall-design-guide.md` |

---

## 工具依赖

本插件的部分子命令依赖以下外部工具（缺失时自动退化）：

| 工具 | 用途 | 使用者 | 缺失影响 |
|------|------|--------|---------|
| Figma MCP | 拉取 Figma 结构数据和图片 | `analyze` | 退化为 REST API + curl |
| MasterGo MCP（可选） | 拉取 MasterGo / SeerDesign 节点与分区 | `mastergo`、`analyze` | 无 MCP 时使用 skill 自带只读接口与浏览器脚本；PNG 由浏览器运行时导出 |
| Node.js + Playwright + Chrome/Edge/Chromium | 导出 MasterGo PNG，读取浏览器运行时结构 | `mastergo` | 先发现已有运行时/npm 缓存或本地安装依赖，仍无法取得时说明阻塞；详见 `skills/mastergo/references/runtime.md` |
| drawio skill | 生成架构图 | `write-overall`、`write` | 退化为 Mermaid |
| markmap-cli | 生成思维导图 HTML | `estimate` | 退化为 Markdown 表格 |
