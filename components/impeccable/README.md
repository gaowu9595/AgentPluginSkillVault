# Impeccable 离线组件

Vault 组件 **1.0.0**，上游 Skill **4.8.2**，原生引擎 **0.1.22**。
目标为 Windows x64；安装只需要系统自带 Windows PowerShell 5.1+。
不依赖 SwitchAI、Node 或 Python，不修改模型、MCP、原生设置或 Hooks。

## 给用户和内网 AI 的安装步骤

1. 获取 `impeccable-1.0.0-windows-x64.zip` 及可信分发方提供的 SHA256。
   版本与哈希在仓库 `registry/releases/impeccable/1.0.0/windows-x64.json`。
2. 用 `Get-FileHash <ZIP绝对路径> -Algorithm SHA256` 比对后，解压到独立目录。
   不把密钥、配置或其他文件放入解压目录；安装会核对整个包的清单。
3. 在该目录执行下面的命令；将示例项目路径换为实际已有项目。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\manage.ps1 -Action status -Client claude -Project 'D:\Codes\my-project'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\manage.ps1 -Action install -Client claude -Project 'D:\Codes\my-project'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\manage.ps1 -Action check -Client claude -Project 'D:\Codes\my-project'
```

Codex 将 `-Client claude` 换成 `-Client codex`。项目安装目录分别为
`.claude/skills/impeccable` 和 `.agents/skills/impeccable`。
用户范围加 `-Scope user -ClientHome <原生客户端配置根目录>`，不会猜测自定义配置位置。
该目录的 `skills/` 将用于安装；原生客户端本身须另外安装。

4. 开启新的原生客户端会话，确认技能可见。Claude Code 通常使用 `/impeccable critique <目标>`，
   Codex 使用 `$impeccable critique <目标>`，也可在对话中明确要求使用 Impeccable。
   菜单展示、模型选择和原生子 Agent 机制受客户端版本影响；安装不会注册其他 Agent。

给内网 AI 的任务示例：

> 读取这个包的 README，先核对可信版本记录中的 ZIP SHA256，再为当前项目安装
> Impeccable。保留已有技能与配置，不启用 Hooks。执行自检，告诉我安装位置、
> 包/Skill/引擎版本、如何使用，以及哪些检查还没有做。

## 使用、自检与限制

`check` 校验安装文件及真实引擎握手，不调用模型，也不代表用户界面审查已经通过。
需要一次本地规则扫描时，在项目根目录调用已安装的启动器：

```powershell
& '.claude/skills/impeccable/scripts/impeccable.cmd' detect --no-config --json 'app.js'
```

Codex 项目将 `.claude` 换成 `.agents`。有规则发现项不等于工具损坏。
完整评审仍需模型读取项目并查看实际界面；浏览器实时审查、截图、图片生成或其他模式
可能需要额外浏览器、转换工具和模型服务。本包不提供这些附加能力。
上游启动器仍尊重用户显式设置的 `IMPECCABLE_BIN`；本包自检直接核对随包引擎。

管理命令输出单个 JSON，非零退出码表示操作失败。支持 `install/status/check/uninstall`，
`status` 不执行引擎，不用“已安装”代替“已检查”或“模型已加载”。

## 升级、恢复和卸载

- 用新包的同一命令升级。若已有手工安装或受管文件被修改，拒绝覆盖，先备份并处理冲突。
- 附加个人文件会保留；新版本若与其同名会拒绝升级。
- 项目状态保存在 `.agent-vault/impeccable/<client>/project`；用户范围保存在
  `<ClientHome>/.agent-vault/impeccable/<client>/user`。备份在其 `previous/`，不参与 Skill 发现。
- 成功升级保留前一份安装并输出备份位置。下一次升级会核验并轮换这一份备份；
  修改过的备份会阻止轮换，不静默删除。需要长期留存时先复制到自己管理的位置。
- 恢复优先使用保留的旧 ZIP，核对哈希后显式指定 `-AllowDowngrade` 安装。
  也可以先备份并移走当前目录，再将 `previous/` 恢复到输出的安装位置；不得带着两份
  `SKILL.md` 留在原生扫描目录。此组件没有记忆数据库迁移，也不提供自动回滚按钮。
- `-Action uninstall` 仅移除未被修改的受管文件。个人附加文件、原生设置、项目设计文档
  和先前备份保留；修改过的受管文件会阻止卸载，由用户先行处理。

## 开发构建

构建机需要 Python 3.9+。先准备与 `component.json` 哈希一致的上游 Windows x64 引擎：

```powershell
python -B components/impeccable/build.py --engine '<已核验的impeccable.exe绝对路径>'
python -B -m unittest discover -s tests -p 'test_impeccable_component.py' -v
python -B scripts/validate-components.py
```

默认输出到忽略的 `dist/components/impeccable/`，不下载任何文件。包内有上游许可证、
固定引擎、双端共用的原样 Skill、管理脚本及逐文件 manifest；源快照分别保存在两侧目录。
构建生成 ZIP、`.zip.sha256` 与发行记录候选。验证后才将候选记录纳入
`registry/releases/`，不自动发布、不自动更新推荐版本。
