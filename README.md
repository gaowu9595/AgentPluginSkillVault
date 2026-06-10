# Agent Plugin Skill Vault

这个仓库用于持久化保存自己开发或转换过的 Agent 插件、Skill 和转换资料，覆盖 Claude Code 与 Codex 两套形态。

## 目录约定

- `claude-code/plugins/`：Claude Code 原始插件。建议路径：`<plugin-name>/<version>/`。
- `claude-code/skills/`：Claude Code 原始 Skill。
- `codex/plugins/`：Codex 插件或由 Claude Code 插件转换出的 Codex 版本。建议路径：`<plugin-name>/<version>/`。
- `codex/skills/`：Codex standalone Skill。
- `converters/claude-to-codex/`：Claude Code 到 Codex 的转换脚本、规则、提示词、映射说明。
- `docs/`：变更记录、迁移记录、兼容性说明。

## 当前快照

- `claude-code/plugins/design-session/1.0.0/`：从本机 Claude Code 本地 marketplace 导入的 `design-session` 原始版本。
- `codex/plugins/design-session/1.0.0/`：从本机 Codex 插件缓存导入的 `design-session` 转换版本。

导入来源：

```text
E:\py_workspace\knowledge-service\.claude\plugins\plugins\design-session
C:\Users\Administrator\.codex\plugins\cache\claude2codex-local\design-session\1.0.0
```

## 更新流程建议

1. 原始 Claude Code 版本更新时，先放入 `claude-code/plugins/<name>/<version>/`。
2. 转换规则或脚本更新时，放入 `converters/claude-to-codex/` 并记录原因。
3. 转换后的 Codex 版本放入 `codex/plugins/<name>/<version>/`。
4. 在 `docs/update-log.md` 记录来源、变更点、转换命令或手工处理点。
5. 每次稳定快照提交一次 git commit，方便回退和对比。
