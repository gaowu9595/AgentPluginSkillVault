---
name: vault-playwright
description: Execute existing browser test cases or plan, generate and diagnose repeatable Playwright tests with the independently installed Vault offline component. Preserve truthful failures and screenshot, video and trace evidence.
metadata:
  version: "1.0.0"
---

# Vault browser testing

Use the installed `vault_playwright` MCP and the current project's
`.agent-vault-tests` workspace. This is the independent Vault component; its
installation, configuration and data are separate from SwitchAI's testing tools.
Do not install packages, download browsers, change accounts/models/permissions
or edit MCP settings during a testing task. Report missing capabilities instead.

## Start with the user's cases

Read existing cases, relevant project guidance, application URL, authorized
credentials and expected outcomes. If TP tools are available, read complete cases
including prerequisites, steps and expected results. Do not invent inaccessible
business facts or silently replace existing cases with generated alternatives.
Identify missing prerequisites and uncertain expectations before execution.

Read `.agent-vault-tests/tests/fixtures.ts` and the workspace marker. Generated
tests must import `test` and `expect` from `./fixtures`, or the correct relative
fixture path in a nested directory. Preserve managed config, fixture and seed.
For custom authentication/setup, create a separate user-owned seed and pass its
explicit path to planner/generator setup. The default seed requires an authorized
`VAULT_TEST_BASE_URL`; it is setup, never a business acceptance case.

## Plan, execute and preserve evidence

1. Save case mappings and executable plans under `.agent-vault-tests/specs/`.
2. If tests already exist, run them first. Generate code only for missing cases.
3. With Claude Code, use `vault-playwright-test-planner`,
   `vault-playwright-test-generator` and `vault-playwright-test-healer` when useful.
   With Codex, follow the corresponding role references under `references/`;
   these files are workflow guidance, not registered native Codex agent profiles.
4. Use tools named `mcp__vault_playwright__*`. Pass the explicit seed
   `.agent-vault-tests/tests/seed.spec.ts` to setup tools. Browser actions can
   change the target application; native permissions and the user's scope apply.
5. Save tests under `.agent-vault-tests/tests/`. Keep real business assertions.
6. For the final repeatable acceptance run, resolve `runtimeRoot` from
   `.agent-vault-tests/.vault-workspace.json` and execute from the project root:

```powershell
$vaultRuntime = (Get-Content .agent-vault-tests/.vault-workspace.json -Raw | ConvertFrom-Json).runtimeRoot
& (Join-Path $vaultRuntime 'bin/node.exe') (Join-Path $vaultRuntime 'scripts/run.cjs') --project (Get-Location).Path -- '.agent-vault-tests/tests/example.spec.ts'
```

Set `VAULT_TEST_BASE_URL` only to the authorized application URL when needed.
For MCP setup, an authorized URL can also be saved as `baseURL` in the ignored
`.agent-vault-tests/environment.local.json`; preserve other local values.
Use the actual test file in place of the example. Never run `npx`, replace PATH,
or use a separately installed Node/Playwright to make this component pass.

The runner saves JSON/HTML reports, screenshots, video and trace in a unique
`.agent-vault-tests/runs/<run-id>/` directory and emits a summary. An MCP browser
interaction or a browser self-check alone is not business acceptance evidence.

## Failure integrity

Never weaken assertions, delete steps, swallow errors, add `skip`/`fixme`, focus
tests, change expected results to observed defects, or label an unrun case passed.
Distinguish product defect, test defect, environment blockage and unclear case.
The runner rejects zero/skipped/flaky/error runs as an all-passed result.

For every repair, append original error, evidence, diagnosis, exact changes,
reasoning and rerun result to `.agent-vault-tests/specs/healing-log.md`. Preserve
earlier entries. Only fix locators/setup when evidence supports the intended
behavior; product changes require the user's task scope.

Report exact case coverage and actual passed/failed/skipped counts with evidence
paths. Check that cited files exist. Unknown or incomplete evidence stays unknown.
Installation does not provide company TP tools, business knowledge or credentials.
