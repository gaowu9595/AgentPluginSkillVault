# Offline Component Foundation Implementation Plan

> **For agentic workers:** Execute inline against the user-approved independent-Vault design. Track completion below; use isolated component fixtures and verification-before-completion.

**Goal:** Persist ownership/version constraints and ship the first independently installable Impeccable Windows x64 component.

**Architecture:** Keep source snapshots and licenses in both native-client trees. A deterministic Python build bundles the pinned native engine and a PowerShell management entry point; the target needs no SwitchAI, Python or Node. Immutable release metadata is separate from the existing source registry.

**Tech Stack:** Python standard library for build/tests; Windows PowerShell 5.1+ and the pinned upstream native engine on targets.

## Tasks

- [x] Inspect the clean Vault, existing registry and pinned upstream provenance.
- [x] Add AGENTS/CLAUDE entry points, component boundaries and version policy.
- [x] Vendor the unchanged 4.8.2 Skill for both clients; pin engine 0.1.22 and licenses.
- [x] Add component-local `manage.ps1` and deterministic `build.py`.
- [x] Cover isolated install/reinstall/upgrade, unmanaged and edited files, corruption, extra-file preservation and self-check with executable tests.
- [x] Build twice; verify stable ZIP hash and real native detector output from both installed copies.
- [x] Add release metadata, inventory, compatibility limits and user/AI installation instructions.
- [x] Record the Vault boundary in SwitchAI documentation without changing its runtime.
- [x] Review diffs and credentials, commit and sync the independently versioned source.

## Verification

Run from this repository:

```powershell
python -B -m unittest discover -s tests -p 'test_impeccable_component.py' -v
python -B components/impeccable/build.py --engine <verified-impeccable.exe>
python -B scripts/validate-components.py
git diff --check
```

Installation tests use temporary client homes/projects only. Native detector checks
are local tool tests, not a full design review, upstream model test or physical
network-disconnection test. Existing SwitchAI-managed memory/testing ZIPs remain
unchanged; this work does not claim they are already portable.
