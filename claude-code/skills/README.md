# Claude Code Skills

这里保存 Claude Code 原始 Skill。

## 当前收录

| Skill | 来源 | 用途 |
| --- | --- | --- |
| `impeccable/4.8.2` | 固定上游快照，镜像 Codex 侧 | UI 审查；完整 Windows 离线安装见 [组件说明](../../components/impeccable/README.md) |
| `browser-proxy-access` | `codex/skills/browser-proxy-access/` | 通过浏览器/Ghelper 代理节点给 shell 网络命令提供代理访问 |
| `doc` | `codex/skills/doc/` | 读写和渲染校验 `.docx` 文档 |
| `spreadsheet` | `codex/skills/spreadsheet/` | 创建、编辑、分析和格式化 `.xlsx`/`.csv`/`.tsv` |
| `slides` | `codex/skills/slides/` | 创建和编辑可继续修改的 `.pptx` 幻灯片 |

## 同步说明

这些目录与 `codex/skills/` 下的同名 skill 保持快照同步。后续任一侧更新时，需要同步更新另一侧，或在 `docs/update-log.md` 和 `registry/artifacts.json` 中说明不适用原因。
