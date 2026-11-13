# Independent claude-mem Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the disjoint builder, runtime and integration tasks; the controller owns lifecycle, native configuration and final verification. The user approved prioritizing claude-mem independent delivery in this conversation.

**Goal:** Provide a Windows x64 memory extension installable without SwitchAI, preserving upstream collection, SQLite/FTS retrieval and Viewer, with honest client support and retained user data.

**Architecture:** Reuse the explicitly supplied hash-pinned prepared claude-mem 15.17.0 runtime archive, including Node/Bun/licenses. New Vault lifecycle and client adapters own only their generated files. Shared immutable runtime and project-specific private data are separate. No SwitchAI imports, private data migration, global model changes or target downloads.

**Tech Stack:** PowerShell management with bundled Node 24.11.1, Bun 1.4.4, upstream claude-mem 15.17.0, project JSON/TOML, development-only Python standard-library builder and isolated SDK/MCP fixtures.

## Decisions

- Deliver claude-mem first. Office and DesignSession offline completion remain separate iterations.
- Component `claude-mem`, Vault `1.0.0`, Windows x64, management/manifest protocol 1.
- Explicit install/status/check/enable/disable/uninstall, configure, start/stop/viewer. Install/check do not activate observation or model requests. Enable controls native integrations; service start has an explicit observer mode.
- Project integration rather than global plugin/account rewrites. Preserve unrelated JSON/TOML/Hooks and user edits; reject unowned conflicts and duplicated native claude-mem installation. Capability files describe actual supported behavior per client.
- Claude collection uses native project Hooks invoking pinned upstream hook actions with a bounded adapter. Codex support follows verified installed-client public mechanisms; never claim auto capture from MCP registration alone. If native Hooks cannot be verified, support retrieval/manual memory and record that boundary.
- Models remain external. Native Claude configuration may be read through explicit allowlisted resolution; no arbitrary credential helper execution or secret stdout. Viewing/checking runs observer-disabled. No existing memory, credentials or transcript copying.
- Memory databases remain outside Git and immutable runtime, keyed by normalized project path. Stop removes only owned workers; uninstall retains data and shared runtime. No automatic import from old SwitchAI/native databases.
- Reuse upstream Viewer through its loopback URL; no new dedicated SwitchAI UI or memory implementation. Document local-only exposure and upstream controls.
- Reject linked paths, traversal, tampered payload and modified owned files. Configuration actions use preflight and atomic replacement with rollback. Native trust/permission approvals remain with the client.

## Tasks

1. [x] Builder/provenance: deterministic builder, complete fixed input verification, source/namespace checks, supplemental NOTICE/licenses and release identity guard. Builder 32 cases: 31 passed, one Windows symlink privilege skip. Port-fix ZIP and independent Git-index build match at 258381073 bytes, SHA256 `044690d4df0b58a164c1092315c53449aeb503ac6cc7c7abc8ebd41d484a4e43`.
2. [x] Runtime: owned hidden supervisor with atomic Windows Job assignment, bounded startup cancellation, serialized checks, native allowlisted connection, private credential DACL/cleanup, upstream local Hook spool and filtered MCP. Before the final port fix, 27 tests passed without skips and capture-i persisted an observation through two loopback model requests. After the fix, two additional real lifecycle tests passed separately; one persistent real MCP session survived promotion on the same URL with two saves and three searches. Its seven adapter hashes match the final ZIP. These are separate runs, not a new full 29-test run. No live model calls.
3. [x] Native/lifecycle: project install/config ownership, immutable shared cache, project Skill/MCP, explicit Claude Hooks, conflict refusal and retained data. Management 69 cases: 68 passed, one Windows file-symlink privilege skip. Native initialization .04 passed all six checks without a model turn.
4. [x] Integration: fresh installation from the actual port-fix ZIP passed all seven memory-smoke checks at `.ui_test/memory-smoke-port-final/`, exit 0. Real Viewer HTML, MCP save/SQLite FTS search, same-PID reuse, owned-process stop and retained database after uninstall passed. Native discovery separately passed all six checks before this port-only fix. Synthetic capture used only a loopback model fixture; all fixture-owned workers were stopped. No new UI was designed.
5. [x] Review/local candidate: scoped lifecycle, credential and build review fixes verified; independent Git-index build reproduced the ZIP exactly; full catalog/member validation passed. Version records and documentation distinguish the local verification candidate from public binary distribution. Source publication is recorded by Git history; binary upload and the complete third-party source companion are separate remaining work.

## Verification Commands

```powershell
python -B -m unittest discover -s tests -p test_memory_build.py -v
node --test tests/memory-management.test.cjs tests/memory-runtime.test.cjs
python -B components/claude-mem/build.py --runtime-archive '<verified prepared archive>'
python -B scripts/validate-components.py --archive '<final Vault archive>'
```

Additional concrete native fixture commands will be recorded with actual executable paths in the report. Unit fixtures, local worker calls, model execution and intranet acceptance are separate evidence. There is no automatic claim of business correctness, data migration or all-client Hook support.

## Integration Rulings

- `enable` registers manual save/search MCP and the project Skill only. Claude automatic capture requires `enable -Capture`; install and checks never opt in implicitly.
- Codex gets manual save/search in 1.0.0. Upstream supplies Codex Hooks, but this investigation did not verify native registration, trust, execution and event delivery. Those Hooks are not installed by this adapter.
- Runtime file verification belongs at installation, explicit checks, enablement and actual service startup. Active worker reuse performs identity/health checks without repeatedly reading large executables for every tool event.
- Use a dedicated Windows Job Object supervisor for each owned worker tree. A tokenized stop request and recorded process identities identify the worker; process-name cleanup is prohibited.
- Preserve the upstream NOTICE and include third-party license texts and source/replacement information. Source/license obligations for redistributed dependency binaries remain distinct from functional verification.
