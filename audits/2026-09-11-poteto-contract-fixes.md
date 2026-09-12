# Workflow contract fixes

Follow-up to the [contract audit](2026-09-11-poteto-mode-contract-audit.md), implemented on 2026-09-11.

The reproduced false-completion paths are closed. All 23 bundled routes now have explicit
minimum completion requirements. This does not establish reliable model behavior across every
host or encode every requirement of the nested skills.

## Changes

- Added [route contracts](../build/route-contracts.json) for artifacts, verification, review,
  delegation, skips, and applicable ordering. Generation fails if any playbook lacks a contract.
- Required gates reject skips. Known playbooks reject `--phases` overrides, and previously
  narrowed records fail validation. Feature completion now requires its recorded implementation
  owner and current verification. Program playbooks with concurrent lifecycle rules keep their
  explicit requirements without imposing a false linear order on their numbered rules.
- Failed review verdicts block completion until replaced by a passing review. Verification and
  review freshness are checked, and scoped evidence and delegates from an old attempt cannot
  satisfy a new attempt. Existing baseline, frozen-harness, and actionable-finding checks remain.
- Added `run-record.py --run <id> tasks --json` and a Markdown export. Checklist text and recorded
  progress come from the same phase record. Host instructions now require synchronizing task
  tools from that export and using its exact IDs, including Opening a PR's named phases.
- Aligned task-tool guidance and made `doctor` report concrete model availability as unverified.
  Updated documentation to distinguish recorded completion requirements from model behavior.
- Added a [portable webhook fixture](../evals/tasks/webhook-portable.json), so the harness can
  exercise both oracle controls and prepare both evaluation arms without the missing local Git
  repository. It has a separate versioned task ID; the historical fixture was not replaced.

## Verification

| Check | Result |
|---|---|
| CLI suite, including browser integration and new contract regressions | 168 passed |
| Existing recorder suite with Git baselines and harness freshness | 23 passed |
| Build-lock suite | 4 passed |
| Static routing contracts | 46 contracts across five hosts, zero problems |
| Generated distribution links and YAML | Zero dead links; 271 YAML blocks valid |
| Evaluation harness | 13 passed, zero skipped |
| Portable oracle, intentionally broken baseline | 0/10 accepted, as required |
| Portable oracle, reference fix | 10/10 accepted |

The [new regression suite](../packaging/tests/test_run_contracts.py) rejects evidence-free
completion for every bundled route and exercises valid synthetic receipts for the 22 routes
other than Bug fix. Existing Bug fix cases cover its valid completion path. Other regressions
cover reversed Feature ordering, mandatory skips, modified legacy records, failed reviews,
staleness, attempt reuse, full checklist text, PR phase IDs, and model availability warnings.
Synthetic receipts test the recorder's contract; they are not evidence that an agent followed it.

The rebuilt CLI was installed. A separate [installed-package smoke check](2026-09-11-contract-fix-installed-check.json)
confirmed that its recorder and route hashes match the source, its checklist exports eight
Feature steps, and both its CLI checker and the observer's bundled checker reject an empty
Feature run. A built-in phase override was also rejected.

The IPAM project at `~/testpstack/ipam` received 11 managed-file updates. Its mode,
host profile, and model choices were kept. The existing viewer on port 7777 was restarted.
Start a fresh agent session there to load the updated instructions; an existing session can
retain instructions it read before the update.

## Remaining limits

The model still chooses the route, follows skill instructions, runs host tools, and synchronizes
the native task list. There is no cross-host hook preventing a final chat response before the
checker runs. The contracts validate minimum recorded evidence and state, not the truth of a
saved receipt, semantic correctness of every conditional skip, full panel composition, every
nested skill invocation, or live model availability.

No new model sessions were run. The portable harness repairs reproducibility for one Bug fix
scenario; routing accuracy and sustained execution across all playbooks and hosts still need
live behavioral evaluations. [Workflow contract documentation](../docs/workflow-contracts.md)
describes these boundaries and how records are checked after an update.
