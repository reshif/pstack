# Poteto-mode workflow contract audit

This is the pre-fix audit. See the [implemented fixes and validation](2026-09-11-poteto-contract-fixes.md) for the subsequent state.

Date: 2026-09-11. Scope: the current PSTACK checkout, its recorder and generated route definitions, host instructions, behavioral evaluation harness, and the previously supplied IPAM Codex session.

**Verdict: poteto-mode can select a playbook and create a checklist. The stronger promise that it reliably executes a complete engineering workflow and demands evidence before reporting success is not supported today.** There are reproducible gaps in the completion checker, separate representations of tasks and progress, and insufficient behavioral coverage across playbooks and hosts.

The clearest result is that **22 of the 23 bundled routes accepted completion after their phases were marked done with zero evidence and zero delegates**. This is a recorder experiment, not a measured failure rate for agents. Some read-only routes legitimately need no test execution. Feature, however, expressly requires implementation delegation and verification, and it accepted the same empty record.

Production code was not changed. No new agent sessions, model requests, or servers were launched for this audit. Reproductions used temporary directories, including small Git repositories for the Bug fix cases.

## What the quoted promise currently means

| Promise | Implemented mechanism | Evidence and limit |
|---|---|---|
| Chooses a playbook | The parent model matches the request against intent descriptions and reads the selected Markdown file. | The IPAM session selected Investigation appropriately. There is no routing accuracy evaluation covering the full catalog or ambiguous requests. |
| Creates a task list | Instructions require the model to copy the complete playbook steps into a host task tool or a Markdown checklist. | The IPAM transcript contains the four Investigation steps verbatim and a later progress update. Recorder initialization does not itself create or synchronize the host's task list. |
| Calls other skills | Routing explicitly means reading a skill's `SKILL.md` and following it. | This is a supported model-led composition mechanism. File access alone cannot establish that the skill's required work was performed. |
| Delegates to suitable models | The model follows role mappings, project overrides, host bindings, and capability fallback instructions. | This can work when the session exposes the required tools and models. Local profile validation does not establish model availability or successful delegation. |
| Demands evidence before success | Instructions require completion checks; the recorder validates selected evidence and state rules. | Several mandatory requirements are absent from those checks, and the checked code contains no host completion interlock that requires a passing record before the model replies. |

Sources: [router and task instructions](../core/skills/poteto-mode/SKILL.md), [host task bindings](../core/runtime/interaction.md), [role mappings](../core/runtime/roles.md), and [recorded IPAM checklist excerpts](2026-09-11-ipam-checklist-evidence.json).

## Findings

### 1. High: completion requirements are tied to phase names, leaving most routes without their semantic gates

`problems()` applies verification requirements only when a required phase is literally named `verify`. Review and implementation delegation similarly depend on `review` and `implement`. The hardcoded `ROUTES` contracts and ordering requirements cover Bug fix. Generated Feature phases are named `step-1` through `step-8`; Opening a PR uses `reverify` instead of `verify`.

The Feature playbook requires an implementation delegate in step 4 and matching-surface verification in step 5. Neither becomes a checker requirement. Generated edges describe intended flow but are not a general transition or dependency validator.

Measured results:

- All phases marked done, no evidence or delegates: 22 routes returned exit 0 and “has current evidence for every required phase.” Bug fix correctly returned incomplete.
- Feature phases explicitly started and completed in reverse order: exit 0.
- Every Feature phase skipped with a generic reason: exit 0, including its mandatory implementation step.
- Control route with a phase literally named `verify`, marked done without evidence: exit 1, “no verification recorded.”

This is a missing executable contract, not a missing workflow diagram. The diagram can show a verification node while the completion checker never requires its evidence.

Sources: [checker](../core/skills/poteto-mode/scripts/run-record.py), `problems()` at line 484 and the verification condition at line 544; [route generation](../build/gen-routes.py), lines 86–122; [Feature requirements](../core/playbooks/feature.md), steps 4–5.

### 2. High: a caller can replace a built-in route's required phases

`init --route bug-fix --phases plan` is accepted. After `phase plan --done`, `check` reports complete without reproduction, implementation, review, or verification.

The initializer trusts `--phases` even for a known route. When its list differs from the bundled route, `route_graph()` builds a replacement graph. This allows a record still labeled Bug fix to discard that playbook's contract. Custom phases are useful for bespoke work, but a built-in route's mandatory obligations should not disappear through the same option.

Sources: [initializer and graph fallback](../core/skills/poteto-mode/scripts/run-record.py), lines 245–277. Probe key: `narrowed-bug-fix`.

### 3. High: Bug fix can accept skipped verification and an explicitly failed review

Two additional probes used an actual failing Python assertion committed before a one-line code fix. The baseline and its failing output were real, so these cases exercise the stronger Bug fix path.

| Case | Recorded state | Result |
|---|---|---|
| Verification omitted | Failing baseline committed; code changed and committed; verification explicitly skipped with “Audit: no verification executed.” | Complete, exit 0. |
| Review failed | Failing baseline committed; code fixed; original test actually passed; review evidence explicitly recorded with `--result fail` and an unresolved blocking verdict. | Complete, exit 0. |

The first result follows from excluding skipped verification from evidence checks. The second follows from requiring only the existence of review evidence, regardless of its result. No separate finding row was created in the failed-review probe: separately recorded open actionable findings do block completion, but the failed verdict itself does not.

The fixture recorded parent implementation with an explicit note and skipped PR creation because it had no remote. Those supported escape paths isolated the checks under examination. These probes do not claim a real delegate or reviewer ran.

Sources: [verification, review, and finding checks](../core/skills/poteto-mode/scripts/run-record.py), lines 544–594; [Bug fix verification obligation](../core/playbooks/bug-fix.md), step 4. Probe keys: `bugfix-skipped-verification` and `bugfix-failed-review`.

### 4. High for observability: checklist, execution record, and completion are separate responsibilities

The router tells the model to maintain a verbatim checklist and separately invoke recorder commands. `cmd_init()` stores a request string, route graph, and initially empty event collections. It does not materialize native tasks or connect their statuses to phase transitions.

The IPAM transcript demonstrates successful routing and checklist creation. The first list contains all four Investigation steps verbatim; a later list marks the first two done. There were no native task calls in the inspected parent transcript, which is compatible with the documented Markdown fallback. This is positive evidence of capability, not proof that native task creation failed.

That session used a manual Markdown run record after an earlier recorder error and had no linked structured run. The previously fixed non-Git initialization error is historical; this audit does not report it as a current defect. The remaining design issue is that manual task progress and formal phase records can diverge, and a model can finish a turn without invoking the completion checker.

The observer reads session events and run records. Its `Checker` calls the same `problems()` function and maps an empty problem list to `complete: true`. It can display these records, including their gaps, but cannot supply evidence the execution never recorded. The checker defects therefore also affect the UI's completion judgment.

There is a smaller instruction gap here: `runtime/interaction.md` contains task-tool bindings, but the router's lazy-loading table only tells the model to open it when asking the user something. Task creation should itself trigger reading the applicable binding.

Sources: [router](../core/skills/poteto-mode/SKILL.md), lines 30–39 and 184–186; [record initialization](../core/skills/poteto-mode/scripts/run-record.py), lines 272–277; [observer checker](../packaging/src/pstack_cli/observe/runs.py), lines 156–195; [IPAM excerpts](2026-09-11-ipam-checklist-evidence.json).

### 5. Medium: Opening a PR conflicts with the generic tracking instructions

The router instructs runs to use `phase step-<N>` and names Bug fix as the exception. Opening a PR also has named phases: `worktree`, `commits`, `cleanup`, `reverify`, `write`, `create`, and `readiness`.

Following the generic instruction after `init --route opening-a-pr` produces:

```text
run-record: step-1 is not a phase of opening-a-pr: worktree, commits, cleanup, reverify, write, create, readiness
```

The command exits 2. A model may recover by inspecting the record, but the published instructions should not require that repair. Native phase IDs should come from the selected contract rather than being reconstructed from prose.

Sources: [router tracking instructions](../core/skills/poteto-mode/SKILL.md), line 186; [named PR route](../build/gen-routes.py), lines 61–66. Probe key: `opening-pr-step-1`.

### 6. Medium: model validation and task-tool documentation overstate or disagree about host readiness

The setup skill says `pstack doctor` rejects a model the host cannot address. The local `check_model()` validator detects vendor mismatches; it does not query model availability. The invented value `gpt-imaginary-audit-only` for Codex produced no errors or warnings. This does not mean it can be invoked. Runtime capability probes and fallback remain necessary.

Task-tool documents also disagree internally: the host profile describes a Copilot `todos` tool, while the interaction table selects a Markdown checklist. No live Copilot capability claim is made here; the inconsistency is in the shipped instructions themselves.

The one-command example also needs host-specific spelling. The local host profile documents `$poteto-mode` for Codex, while slash syntax applies on other named surfaces. Installation, activation, and usable session capabilities remain prerequisites.

Sources: [setup claim](../core/skills/setup-pstack/SKILL.md), lines 115–116; [model validator](../packaging/src/pstack_cli/profile.py), lines 59–70; [host profile](../core/runtime/host-profile.md); [interaction table](../core/runtime/interaction.md). Probe key: `imaginary-model-profile`.

### 7. High for the product claim: behavioral validation does not cover the promised breadth

The repository has one behavioral evaluation task, `webhook-durable-idempotence`, focused on Bug fix. Its phase-order scoring covers five Bug fix findings. It does not establish correct playbook selection across intents, verbatim task materialization and progress across hosts, or completion requirements for all 23 routes.

The harness documents that its real trivial Claude invocation validated event shapes, not full `/poteto-mode` execution. Synthetic conforming and violating transcripts are useful parser tests, but cannot demonstrate how a model follows instructions. The host-adapter status notes are historical documentation, not a fresh determination of installed host capabilities.

Checks executed during this audit:

| Check | Result | What it establishes |
|---|---|---|
| `node build/check-routing.mjs` | 46 static contracts across five hosts; zero issues. | Required text and composition rules are present. |
| `python3 build/test-run-record.py` | 23 cases passed. | Existing recorder behaviors satisfy their current tests. |
| `python3 evals/test_harness.py` | 10 passed, 3 skipped, zero failures. | Available harness tests pass; full fixture-dependent validation was unavailable. |
| `python3 audits/poteto-contract-probes.py` | Results listed above, saved as JSON. | Concrete false-completion paths and a tracking instruction mismatch exist in the current recorder. |

The three skipped tests cover the oracle against the buggy commit, the oracle against the reference fix, and preparation of both evaluation arms. They require the original `~/testpstack` Git fixture, which was absent. No new paid or unattended model runs were performed. Existing green checks must not be presented as evidence of reliable execution across all modes.

Sources: [evaluation scope and limits](../evals/README.md), [task fixture](../evals/tasks/webhook-durable-idempotence.json), [static checker scope](../build/check-routing.mjs), and [harness tests](../evals/test_harness.py).

## Reproduction artifacts

- [Executable probes](poteto-contract-probes.py). Run from the repository with `python3 audits/poteto-contract-probes.py`. They require Python and Git, use temporary workspaces, and clean them up after execution.
- [Measured results](2026-09-11-poteto-contract-probes.json). Includes recorder and route-definition SHA-256 hashes, exit codes, and checker output.
- [IPAM checklist evidence](2026-09-11-ipam-checklist-evidence.json). Contains only relevant checklist excerpts and source positions, rather than the full project transcript.

The probes deliberately construct incomplete or contradictory records through the public recorder commands. They establish acceptance bugs, not the probability of a model producing those records naturally. The checker already acknowledges that it cannot prove evidence is true; these findings concern missing required evidence and ignored explicit outcomes, which it can validate.

## Work needed before making the stronger promise

1. Define an executable contract for each route: stable phase IDs, dependencies, conditional applicability, permitted skip reasons, required evidence types, acceptable results, and freshness scope. Permit bespoke contracts without allowing a known route to silently drop mandatory gates.
2. Materialize the checklist and run graph from that contract. Give tasks, nested skill invocations, delegates, attempts, evidence, and transitions shared IDs. The UI and host task adapters should consume the same state.
3. Make completion depend on those contracts. Reject omitted mandatory verification, failed review verdicts, and unsupported skips. Apply available host completion controls; where a host cannot enforce them, explicitly distinguish a model's final reply from PSTACK-verified completion.
4. Validate behavior with representative routing cases and real runs on supported host surfaces, including ambiguous intent, rerouting, unavailable models, interrupted/resumed work, retries, stale evidence, and missing task updates. Restore a portable evaluation fixture so required tests cannot silently disappear with a local directory.

Until those changes are implemented and exercised, describe poteto-mode as a model-led workflow that selects playbooks, maintains checklists, and requests evidence, with partial mechanical validation. It has useful working pieces; the universal completion guarantee is ahead of the implementation.
