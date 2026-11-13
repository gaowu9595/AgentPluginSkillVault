# Instructions For AI Coding Tools

Read [README.md](README.md), [current context](docs/project-context.md),
[component rules](docs/component-rules.md), and
[version management](docs/component-versioning.md) before changing this repository.

- Check `git status --short`; preserve unrelated edits and existing snapshots.
- Vault must build, install, check and remove its components without SwitchAI.
  Do not import SwitchAI code, use its private data, or require its install path.
  A UI host may consume the versioned component interface; it is optional.
- Keep upstream assets, licenses and provenance. Record every adaptation. Never
  claim Claude Code and Codex compatibility from copying files alone.
- Preserve payload bytes with `.gitattributes`; check a fresh Git checkout build
  before release. Do not reformat upstream whitespace to satisfy diff checks.
- Preserve credentials, native configuration, user edits, memories and sessions.
  Install only the requested capability and scope; no automatic Hooks, model
  calls, account changes or background services during installation.
- Keep source artifact snapshots in `registry/artifacts.json`. Record offline
  releases separately in `registry/components.json` and immutable release records.
  Upstream, engine, component, manifest schema and management protocol versions
  are different things. Changed released bytes require a new component version.
- Never use `latest` for offline dependencies. Keep generated ZIPs, runtimes,
  private configuration and test output outside Git; do not fetch on the target.
- Check both clients on every capability change. Record unsupported or untested
  behavior explicitly. Test with temporary homes/projects, never personal data.
- Run focused checks and real component self-checks before claiming completion.
  Report local tool checks separately from model-directed or intranet validation.
- Keep documentation and release records current. Publishing a Git commit does
  not mean an offline binary was uploaded or a host integration was implemented.

For the first component, see [Impeccable](components/impeccable/README.md).
