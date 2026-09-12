# PSTACK readiness against the requested bug-fix routing diagram

Assessment date: 2026-09-10. Scope: the current repository's implementation of the user's
`poteto-mode` diagram and readiness on Claude, Codex and Copilot. This is a repository assessment,
not a new live model benchmark or a fresh audit of every upstream principle and playbook.

**Verdict: suitable for supervised trials; not yet validated for reliable autonomous completion
or equivalent outcomes across hosts.** The routing instructions and supporting implementation
have advanced substantially. The remaining completion-check defects and missing behavioral
evidence prevent a stronger readiness claim. A percentage would conflate installed instructions,
executable checks and demonstrated agent behavior.

## Coverage of the diagram

| Diagram stages | What is implemented | What remains unproven or incomplete |
|---|---|---|
| A–B: activation, host, models, principles | Sticky activation, host binding, matching-host profile override, configurable roles, principles index and relevant leaf reads. Profile validation and host switching have tests. | Actual capability and model availability still depend on the running host/session. Build presence alone does not demonstrate correct live routing. |
| C–D: intent/state and six-step playbook | Intent/state routing, bug-fix selection, six steps with gates at their point of use; other playbooks have run-record phases. | Behavioral coverage is concentrated on one bug-fix scenario; this assessment does not establish conformance for every playbook. |
| R: failing baseline | Executable reproduction before implementation, separate failing-check commit, frozen harness, output hashes and tree identity checks. | The agent supplies the command output and its classification. The recorder checks consistency, not whether the failure demonstrates the claimed defect. |
| H–W–M: investigation and runtime mechanism | Simple/complex `how`, source-based `why`, parent hypothesis testing, grounding records. The current source graph also names investigation substeps. | Completing a broad phase is still possible without recording every investigation substep or demonstrating the quality of the runtime conclusion. |
| T–X–AR–AB–AC: census, checkpoint and design | Conditional census, throughput checkpoint, function-boundary rule, Architect caller boundary, sketch-based Arena, caller roster precedence, judge and synthesis, optional approval. | Parent execution must honor these instructions. Architect may reuse unchanged grounding, so AR should say “reuse valid grounding or rerun how,” rather than always calling it again. |
| I–N–V: implementation, cleanup and review | One scoped implementation delegate, owner/model record, cleanup and no-comments before parent review, conditional interrogate, accepted findings routed back for implementation. | Failed or stale review evidence can still pass the completion checker. |
| P and return paths | Frozen/current harness verification, stale verification rejection, instructions to return to diagnosis on failure and verify again after edits. Graph and run records represent return activity. | A skipped mandatory verification can produce `complete`. The generated checker also retains a historical-skip bypass fixed in the newer source. |
| K–PR–F: commits, PR and final evidence | Failing-check-before-fix ordering, writing passes, check before PR, verification after PR preparation edits, final checklist, owner/model/tier and evidence. | The completion verdict inherits the defects below. Presence of the final audit block does not establish that the live host followed every gate. |

Primary routing sources: [bug-fix playbook](../core/playbooks/bug-fix.md),
[poteto-mode](../core/skills/poteto-mode/SKILL.md),
[Architect](../core/skills/architect/SKILL.md),
[delegation](../core/runtime/delegation.md), and
[run-record checker](../core/skills/poteto-mode/scripts/run-record.py).

## Verification performed

| Check | Observed result | Meaning |
|---|---|---|
| `make verify` | Passed: 46 routing contracts across five host builds; 23/23 run-record cases; structural/link checks; 271 valid YAML blocks | Tests installation/text contracts and existing checker scenarios, not a complete agent run |
| `packaging/.venv/bin/python -m pytest packaging/tests -q` | 58 passed | Packaging/CLI/profile/observer tests, including UI coverage |
| `python3 evals/test_harness.py` | 10 passed, 3 skipped, 0 failed | Real fixture oracle checks and preparation of both arms were skipped because `~/testpstack` is absent |
| Additional source checker probes | Three incorrect completion reports out of four negative scenarios | Existing tests miss relevant review and verification failures |
| Same probes against generated Claude checker | Four incorrect completion reports | Generated artifacts still contain the older checker; all five packaged hosts contain that same checker hash |

Source changed during this assessment. The final source probe ran against SHA-256
`2653d45bcb0f4b45a88305115cb305ef3afa09d7f5665f466f0911d6ea6dd499` at
12:49:55 UTC. The generated checker probe ran against
`f76e78ae595c9e9532085392dffcebd88dd0045fc857c1a5828184ddc1990ce1` at
12:51:04 UTC. Both files remained unchanged during their respective probes. Package indexes
matched their generated host trees, but their checkers differed from current source. No build or
installation was performed by this assessment.

## Reproduced completion defects

The probes use temporary git repositories, an actual failing executable check committed before
the fix, and real passing/failing verification commands where applicable. Review verdicts are
controlled inputs to exercise validation; no model reviewers were called.

| Scenario | Expected | Current source | Generated/packaged checker |
|---|---|---|---|
| Passing review recorded, then code edited; current tests pass | Require review of the changed artifact | Incorrectly `complete` | Incorrectly `complete` |
| Review explicitly recorded as `fail`, without resolution; tests pass | Incomplete until review is resolved | Incorrectly `complete` | Incorrectly `complete` |
| Mandatory verification marked skipped; no verification run | Report incomplete/unverified | Incorrectly `complete` | Incorrectly `complete` |
| Old verification skip, followed by a real failing verification and a done mark | Incomplete | Correctly incomplete | Incorrectly `complete` |

The review branch in `problems()` checks for the existence of any review evidence, but does not
require a current passing or explicitly resolved verdict. The verification branch permits the
last phase mark to skip the entire verification check. The older generated version bypasses
verification whenever *any historical mark* skipped it.

Reproduce:

```sh
python3 audits/readiness-probes.py
python3 audits/readiness-probes.py dist/claude/.claude/skills/poteto-mode/scripts/run-record.py
```

Captured results: [source](2026-09-10-readiness-probes.json) and
[generated build](2026-09-10-readiness-built-probes.json).

## Work needed before a stronger readiness claim

1. **Make the completion verdict reliable.** Require current review evidence and explicit
   disposition of failed reviews. Distinguish optional gates from mandatory verification: inability
   to verify must remain incomplete. Add the reproduced cases to the checker regression suite.
   Ensure returning for edits invalidates the affected evidence and requires renewed review and
   verification on the final artifact.
2. **Regenerate and validate what users install.** Bring all generated host trees and package
   data up to the corrected source, and run completion probes against the packaged helpers too.
3. **Make behavioral evaluation reproducible.** Replace the missing personal `~/testpstack`
   dependency with an available, pinned fixture. Require the buggy/reference oracle checks and
   both-arm preparation to run before reporting evaluation readiness.
4. **Validate each host's actual invocation and event capture.** Exercise full `poteto-mode`
   activation and delegation on Claude, Codex and Copilot. The evaluation analyzer explicitly
   leaves Copilot transcripts unparsed. The observer's separate Copilot reader does not close
   that evaluation gap. All three CLIs are now present here, despite older README wording.
5. **Measure the intended payoff.** Run repeated paired PSTACK/plain-agent trials on the same
   fixtures, plus representative routing branches and failure-return cases. Compare independent
   correctness results, routing compliance, elapsed time, cost/tokens, and recovery. No complete
   new benchmark results were found in the inspected repository. A 40–45 minute run alone proves
   neither failure nor benefit.

Delegate time budgets, retry limits and pause/resume are implemented as instructions and records.
The record detects an overdue open delegate when checked; it does not itself terminate the host
task. Actual cancellation and timing behavior need host-specific validation, especially where a
host executes delegates synchronously.

The routing trace is useful as an audit specification. Readiness now depends on corrected
completion semantics and demonstrated behavior across hosts, rather than another trace document.
This assessment added only the audit report, diagnostic script and captured outputs; it did not
modify the PSTACK implementation.
