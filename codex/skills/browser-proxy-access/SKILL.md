---
name: browser-proxy-access
description: Route shell network commands through browser-discovered Ghelper proxy nodes on Windows. Use when Codex or shell commands need external network access, direct shell access fails or is not proxied, the browser can access the site through Ghelper, or a workspace mentions using .codex/scripts/ghelper-proxy.ps1, Chrome/Edge PAC data, proxy node selection, or low-risk one-shot network fetches.
---

# Browser Proxy Access

Use this skill to run one shell command with temporary `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` values discovered from the current shell, Windows proxy settings, common local proxy ports, or browser Ghelper PAC data. The helper does not change the user's persistent proxy settings.

## Quick Start

Prefer the workspace-local helper when present:

```powershell
.\.codex\scripts\ghelper-proxy.ps1 -Fastest -RunCommand "curl.exe https://www.google.com/generate_204"
```

If the workspace has no helper, use this skill's bundled helper:

```powershell
& "<skill-dir>\scripts\ghelper-proxy.ps1" -Fastest -RunCommand "curl.exe https://www.google.com/generate_204"
```

Replace `<skill-dir>` with the installed skill directory, such as:

```powershell
C:\Users\Administrator\.codex\skills\browser-proxy-access
```

## Workflow

1. Check for a workspace helper first:

```powershell
Test-Path .\.codex\scripts\ghelper-proxy.ps1
```

2. List available browser proxy candidates when diagnosing connectivity:

```powershell
.\.codex\scripts\ghelper-proxy.ps1 -List
.\.codex\scripts\ghelper-proxy.ps1 -Profile Chrome -List
.\.codex\scripts\ghelper-proxy.ps1 -Profile Edge -List
```

3. Run one command through the fastest working candidate:

```powershell
.\.codex\scripts\ghelper-proxy.ps1 -Fastest -RunCommand "<command> <args>"
```

The helper checks, in order, existing proxy environment variables, Windows proxy settings, common local proxy ports, and browser PAC nodes. To diagnose browser PAC only:

```powershell
.\.codex\scripts\ghelper-proxy.ps1 -List -NoExistingEnv -NoSystemProxy -NoCommonLocal
```

4. Pin a known candidate only for the current command when needed:

```powershell
.\.codex\scripts\ghelper-proxy.ps1 -Index 3 -RunCommand "<command> <args>"
```

5. Use `-Run` only for simple commands without PowerShell-sensitive flags:

```powershell
.\.codex\scripts\ghelper-proxy.ps1 -Fastest -Run curl.exe https://www.google.com/generate_204
```

6. If browser PAC nodes return `CONNECT tunnel failed, response 403`, do not keep retrying them. That usually means the browser extension adds authentication or dynamic authorization that shell `curl` cannot replay from PAC data alone. Prefer `-NoBrowserPac` to use existing env/system/local candidates, or configure a stable local proxy such as `127.0.0.1:7890`.

```powershell
.\.codex\scripts\ghelper-proxy.ps1 -Fastest -NoBrowserPac -RunCommand "curl.exe https://api.github.com/rate_limit"
```

## Quoting Rules

Use `-RunCommand` when child command arguments contain `-o`, `-w`, `--flag`, `&`, `?`, quoted URLs, or other PowerShell-sensitive characters.

Avoid passing raw URLs containing `&` directly to PowerShell. Wrap the whole child command in a string passed to `-RunCommand`.

## Safety Rules

- Do not hardcode old proxy nodes.
- Do not print full proxy hostnames unless the user explicitly asks.
- Do not assume shell commands can use a browser extension's remote PAC node just because the browser can access a site; the extension may be adding auth inside the browser.
- Keep fetches low-frequency and one-shot by default.
- If proxy selection fails with CONNECT 403, report the auth/dynamic-authorization limitation and ask whether to configure a stable local proxy such as `127.0.0.1:7890`.

## Bundled Scripts

- `scripts/ghelper-proxy.ps1`: PowerShell wrapper.
- `scripts/ghelper-proxy.py`: Decodes current Ghelper browser PAC data, tests candidates, and runs the child command with proxy environment variables.

Requirements: Windows PowerShell and Python on PATH.
