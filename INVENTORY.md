# Inventory

| Area | Name | Version | Path | Source | Notes |
| --- | --- | --- | --- | --- | --- |
| Claude Code skill | browser-proxy-access | 1.0.0 | `claude-code/skills/browser-proxy-access/` | `codex/skills/browser-proxy-access/` | Mirrors Codex skill snapshot for Claude Code-side review/deployment |
| Claude Code skill | doc | snapshot-20260627 | `claude-code/skills/doc/` | `codex/skills/doc/` | Mirrors Codex `.docx` skill snapshot |
| Claude Code skill | spreadsheet | snapshot-20260627 | `claude-code/skills/spreadsheet/` | `codex/skills/spreadsheet/` | Mirrors Codex `.xlsx`/`.csv`/`.tsv` skill snapshot |
| Claude Code skill | slides | snapshot-20260627 | `claude-code/skills/slides/` | `codex/skills/slides/` | Mirrors Codex `.pptx` skill snapshot |
| Codex skill | browser-proxy-access | 1.0.0 | `codex/skills/browser-proxy-access/` | `E:\AllWorkspace\Trade\.codex\scripts\ghelper-proxy.*` | Route shell network commands through browser-discovered Ghelper proxy nodes on Windows |
| Codex skill | doc | snapshot-20260627 | `codex/skills/doc/` | `C:\Users\Administrator\.codex\skills\doc` | Create, edit, and visually validate `.docx` documents |
| Codex skill | spreadsheet | snapshot-20260627 | `codex/skills/spreadsheet/` | `C:\Users\Administrator\.codex\skills\spreadsheet` | Create, edit, analyze, and format `.xlsx`/`.csv`/`.tsv` files |
| Codex skill | slides | snapshot-20260627 | `codex/skills/slides/` | `C:\Users\Administrator\.codex\skills\slides` | Create and edit editable PowerPoint `.pptx` decks |
| Claude Code MCP server | mastergo-magic | config-snapshot-20260627 | `claude-code/mcp-servers/mastergo-magic/` | `codex/mcp-servers/mastergo-magic/` | Mirrors MasterGo Magic launcher; Claude Code config must be adapted to target client version |
| Codex MCP server | mastergo-magic | config-snapshot-20260627 | `codex/mcp-servers/mastergo-magic/` | `C:\Users\Administrator\.codex\config.toml` + `E:\py_workspace\knowledge-service\Workflow\.ai\tools\start_mastergo_magic_mcp.ps1` | MasterGo Magic MCP launcher and Codex config snippet; offline use requires preinstalled Node/npm package cache |
| Claude Code plugin | design-session | 1.0.5 | `claude-code/plugins/design-session/1.0.5/` | `codex/plugins/design-session/1.0.5/` | Mirrors current Codex App business rules, including MasterGo fallback, while retaining Claude Code manifest and command syntax |
| Codex plugin | design-session | 1.0.5+codex.20261010.mastergo | `codex/plugins/design-session/1.0.5/` | `C:\Users\Administrator\.codex\plugins\cache\claude2codex-local\design-session\1.0.5+codex.20261010.mastergo` | Installed Codex snapshot; includes automatic MasterGo/SeerDesign PNG fallback |

## 待补充

- Claude Code -> Codex 转换脚本或规则的源位置。
- 每个版本的兼容性说明和安装方式。
