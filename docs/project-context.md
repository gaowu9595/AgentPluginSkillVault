# Current Project Context

Snapshot: 2026-11-13. Vault is independent of SwitchAI and publishes separately.
Read [AGENTS.md](../AGENTS.md), [component rules](component-rules.md), and
[version policy](component-versioning.md) before implementing changes.

The existing DesignSession 1.0.5, Office Skills and MasterGo launcher remain source
snapshots. Their runtime dependencies are not automatically provided by this repo.
Impeccable is the first complete Windows x64 offline component: Vault 1.0.0,
upstream Skill 4.8.2, native engine 0.1.22. See the
[component guide](../components/impeccable/README.md) and
[fresh validation report](reports/2026-11-13-impeccable-component.md).

Source inventory: `registry/artifacts.json`. Offline catalog:
`registry/components.json`. Immutable archive records:
`registry/releases/<id>/<version>/<platform>.json`. Binary archives stay under
ignored `dist/components/` locally and need separate distribution. Source commits
do not upload binary releases; only recorded real URLs may be advertised.
`.gitattributes` preserves upstream bytes and pins component-source LF endings;
a fresh staged checkout under Windows Git reproduced the recorded ZIP hash.

The component target uses Windows PowerShell, not Python/Node. The standard-library
Python build/test tools run on the development host. Run:

```powershell
python -B -m unittest discover -s tests -p 'test_impeccable_component.py' -v
python -B scripts/validate-components.py
```

Set `VAULT_IMPECCABLE_ENGINE` to the verified native executable to include the real
engine/launcher check. Without it that check is explicitly skipped. On this host
the default C: temporary directory fails minimal rename operations; verification
uses ignored `.ui_test/tmp` via task-local TEMP/TMP. This is a recorded environment
limit, not a reason to replace atomic publication with unsafe file copies.

SwitchAI still manages its existing Playwright and claude-mem ZIPs with dedicated
code. Those packages have not been migrated here. Its UI can later consume a
versioned component interface; no host integration is part of this release.
Model discovery/selection and full UI review require separate client/model
validation; local installation and detector results do not prove them.
