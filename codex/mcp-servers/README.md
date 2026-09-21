# Codex MCP Servers

这里保存 Codex MCP server 的配置快照、启动脚本和离线部署说明。

## 当前收录

| MCP server | 路径 | 本机配置来源 | 说明 |
| --- | --- | --- | --- |
| `mastergo-magic` | `mastergo-magic/` | `C:\Users\Administrator\.codex\config.toml` | MasterGo Magic MCP，当前通过 PowerShell 启动 `@mastergo/magic-mcp` |

## 兼容性原则

1. 不写入或解析 Codex/Claude 的私有状态数据库。
2. 优先保存可人工审查的配置片段和启动脚本。
3. 目标环境安装时，先查看目标版本官方配置格式，再把本目录中的配置片段迁移进去。
4. 内网环境需要提前准备 MCP server 的运行时依赖，例如 Node.js、npm 包缓存或离线 npm 包。
