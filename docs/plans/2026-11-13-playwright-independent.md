# Independent Playwright Component Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the disjoint build/demo/documentation tasks; the controller owns lifecycle integration and final verification. The user approved the independent component and evidence-producing demo journey in this conversation.

**Goal:** Deliver an independently installable Windows x64 Playwright Test component and a repeatable defect-to-regression demonstration, with a source-grounded adaptation inventory.

**Architecture:** Reuse the existing hash-pinned Playwright 1.60.0 runtime distribution as a prepared dependency, preserving its licenses and provenance. Vault owns a separate adapter, project-scoped native capabilities and native MCP registration, with explicit enable/disable and protected file ownership. SwitchAI's existing runtime remains unchanged. Test evidence stays in `.agent-vault-tests`; installed runtime versions are immutable and shared only through an explicit runtime root.

**Tech Stack:** Bundled Node 24.11.1 and Playwright 1.60.0/Chromium 1223; Windows PowerShell entry point; Python standard-library builder; pinned BSD-3-Clause TOML parser for structured Codex configuration.

## Approved Design And Boundaries

- Package identity: `playwright-test`, Vault version `1.0.0`, Windows x64, manifest/protocol 1. It has a separate identity/hash from the existing SwitchAI package.
- Actions: install, status, check, enable, disable, uninstall. Preparation does not enable Hooks or call a model. Enable explicitly registers only this capability in native project config. Removal preserves scenarios, reports, credentials and shared runtime caches.
- Claude project integration: `.claude/skills/vault-playwright`, namespaced native agents and `.mcp.json`. Codex integration: `.agents/skills/vault-playwright` and `.codex/config.toml`; the three workflow roles are available as references rather than pretending Claude agent files are Codex native agent profiles.
- Native configuration uses structured JSON/TOML parsing, preserves unrelated values, rejects an existing unowned entry, and removes only a matching owned entry. Modified managed files/config entries block destructive changes. Never edit account, model, permissions, Hooks or global client settings.
- Project workspace: `.agent-vault-tests`. Explicit runtime root overrides make tests isolated. Config and fixtures resolve the bundled runtime without `npx`, global PATH changes or npm downloads. Project paths with spaces, Unicode and ESM must work.
- MCP uses the pinned official Test MCP tools with truthful write annotations and guarded plan/test output paths. It is a browser tool interface, not an OS sandbox. No permanent service is created.
- Evidence: screenshot/video/trace and JSON/HTML reports. The demonstration uses fixed business assertions, deliberately fails a defect, fixes the application rather than weakening the assertions, then reruns the same cases. Missing/zero/skipped tests cannot become an all-passed summary.
- Verify native discovery separately from browser replay and live model selection. No intranet TP, company accounts or business acceptance is available here.
- Alternatives considered: moving the current SwitchAI ZIP alone would preserve host coupling; building another framework would expand maintenance. Reuse pinned upstream runtime bytes and introduce a narrow independent adapter.

## Task 1: Source-Grounded Adaptation Inventory

- [x] Create `docs/adaptation-inventory.md` with exact components, changed behavior, source paths, versions and migration state. Include Impeccable, Playwright, claude-mem, DesignSession/MasterGo/Office, Paperclip and Hermes without conflating snapshots, full runtimes or UI integration.
- [x] Check links and source consistency. This task owns only this document.

## Task 2: Deterministic Independent Builder

- [x] Create `components/playwright-test/build.py`, `tests/test_playwright_build.py` and a dependency provenance snapshot. The builder takes `--runtime-archive` explicitly; it never reads a SwitchAI checkout by default.
- [x] Verify input archive SHA256, member paths, duplicates, symlinks and every manifest hash before selecting only `bin/`, `runtime/`, `browsers/`, `LICENSES/` and upstream provenance.
- [x] Add component-local sources and both checked Skill snapshots; generate sorted fixed-timestamp ZIP, per-file manifest, checksum and candidate release record. Reject changed bytes for an already recorded release version.
- [x] Run `python -B -m unittest discover -s tests -p test_playwright_build.py -v`. Build the real archive twice and compare SHA256 after integration.

## Task 3: Project Lifecycle And Native Configuration

- [x] Add `components/playwright-test/component.json`, `manage.ps1`, `scripts/manage.cjs`, `scripts/native-config.cjs`, `scripts/project.cjs`, `scripts/mcp.cjs`, `scripts/run.cjs` and a pinned TOML parser/license.
- [x] Test ownership, idempotency, configuration preservation/conflicts, edited files, corruption, traversal/links, enable/disable/re-enable and uninstall evidence retention with `node --test tests/playwright-management.test.cjs`.
- [x] Install only verified immutable runtime bytes. Copy native assets with receipts and rollback failed multi-file changes. Keep enabled clients separate while sharing the same project test workspace.
- [x] Run a real browser check and protocol tests using the installed runtime. Confirm target tools run without Python/Node installed separately and without downloading dependencies.

## Task 4: Evidence-Producing Demonstration

- [x] Create `examples/playwright-regression/` with a compact local task-tracking application, fixed external-style case document, deliberate product defect, application repair and replay driver. Use bundled Node/Playwright only, no model or external service required for deterministic replay.
- [x] Cover positive journey, business rule rejection and edge case. Preserve failed and passed evidence in separate run directories; output a machine-verifiable summary.
- [x] Run `node --test tests/playwright-demo.test.cjs` for demo logic, then run the complete replay from a separately installed component. The driver owns and closes its server/browser processes.

## Task 5: Native Discovery, Release And Handoff

- [x] Check both native clients using isolated project/config roots; record exact discovery and MCP initialization evidence, without claiming model selection from initialization alone.
- [x] Extend `scripts/validate-components.py` for generic components while retaining Impeccable checks. Add both Skill snapshots and native agent adaptations to the source inventory, with provenance and licenses.
- [x] Update registry/release records, context, README, usage/update log and `.gitattributes`. Verify a Git checkout rebuild and run the unchanged Impeccable regression checks appropriate to validator changes.
- [x] Write `docs/reports/2026-11-13-playwright-independent.md` with fresh commands, counts, screenshots, checksums and unverified intranet/live-model limits. Prepare scoped source publication after staged review; distribute ZIP separately.

## Execution Ledger

Ruling: Use the clean Vault checkout on `codex/playwright-vault-offline` with disjoint agent write scopes. SwitchAI is read-only because it has unrelated pending changes. No additional main-branch implementation or runtime migration is part of this plan.

Ruling: User-supplied TP cases are modeled by a checked-in complete case document in the demo. No synthetic fixture is reported as TP integration or real company acceptance.

Verification: 34 Node tests passed; 23 builder checks passed with one Windows symlink-privilege skip; 3 registry checks passed. Installed demo retained the same seven cases: broken 5 passed/2 failed, fixed 7 passed. All five native discovery/protocol checks passed without a model turn. Real PowerShell browser check and both archive validations passed. A fresh Git-index checkout reproduced the ZIP hash. See the report for exact scope and evidence; source publication is recorded by Git history, and binary upload remains separate.
