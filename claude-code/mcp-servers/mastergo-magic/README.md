# MasterGo Magic MCP for Claude Code

This directory mirrors the Codex-side `mastergo-magic` MCP snapshot so Claude Code deployments can review and reuse the same server launcher.

## Files

- `start_mastergo_magic_mcp.ps1`: PowerShell launcher copied from the current Codex MCP snapshot.

## Deployment Notes

- Keep `MG_MCP_TOKEN` outside the repository and provide it through the target machine environment.
- The launcher currently invokes `npx -y @mastergo/magic-mcp`, so offline deployment requires a preinstalled npm package, npm cache, or internal npm registry.
- Do not copy Codex TOML directly into Claude Code. Convert the launcher command and arguments to the MCP configuration format supported by the target Claude Code version.
- When the Codex-side `mastergo-magic` snapshot changes, update this Claude-side snapshot in the same change unless Claude Code cannot support that server.
