# Claude Code MCP Servers

这里保存 Claude Code MCP server 的配置快照、启动脚本和离线部署说明。

## 当前收录

| MCP server | 路径 | 对应 Codex 快照 | 说明 |
| --- | --- | --- | --- |
| `mastergo-magic` | `mastergo-magic/` | `codex/mcp-servers/mastergo-magic/` | MasterGo Magic MCP，保留同一启动脚本快照；Claude Code 侧需要按目标版本官方 MCP 配置格式接入 |

## 兼容性原则

1. 不提交 token、账号或私有 endpoint。
2. 只保存可审查的启动脚本、配置说明和离线依赖要求。
3. 部署时按目标 Claude Code 版本的 MCP 配置格式迁移，不假设 Codex TOML 配置可直接复用。
4. 与 Codex 侧同源 MCP 更新时，必须同步更新本目录或在 `docs/update-log.md` 中说明不适用原因。
