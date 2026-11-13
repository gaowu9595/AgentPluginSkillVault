# Codex Skills

这里保存 Codex standalone Skill。

## 当前收录

| Skill | 来源 | 用途 |
| --- | --- | --- |
| `impeccable/4.8.2` | 固定上游快照，镜像 Claude 侧 | UI 审查；完整 Windows 离线安装见 [组件说明](../../components/impeccable/README.md) |
| `browser-proxy-access` | 本机脚本整理 | 通过浏览器/Ghelper 代理节点给 shell 网络命令提供代理访问 |
| `doc` | `C:\Users\Administrator\.codex\skills\doc` | 读写和渲染校验 `.docx` 文档 |
| `spreadsheet` | `C:\Users\Administrator\.codex\skills\spreadsheet` | 创建、编辑、分析和格式化 `.xlsx`/`.csv`/`.tsv` |
| `slides` | `C:\Users\Administrator\.codex\skills\slides` | 创建和编辑可继续修改的 `.pptx` 幻灯片 |

## 内网复用说明

Impeccable 优先使用上述完整组件安装。其余目录是 skill 快照，离线环境可按目标客户端的
目录结构复制需要的内容；依赖工具和 Python/Node 包仍需按各自 `SKILL.md` 的说明预置。
