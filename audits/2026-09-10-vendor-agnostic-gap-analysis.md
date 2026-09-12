# PSTACK portability and runtime gap analysis

Assessment date: 2026-09-10. Scope: the current workspace, generated distributions, packaging code and tests, and Claude run `736701de-e7e5-4896-a191-5cc19221886b`. This is an analysis, not an implementation change or certification of every supported host.

**Verdict: we have built substantial instruction and installation portability. We have not yet demonstrated reliable behavioral portability, and we have not built independent routing across model providers.** The missing work is principally in execution contracts, capability resolution, evidence, and evaluation. Adding more principle files would not address those gaps.

The [linked article](https://flaviocopes.com/pstack/#the-21-principles) distinguishes reusable skills from host capabilities and external tools. Its principle count is a snapshot. This checkout contains 47 skills, including 23 principles, plus 23 playbooks and 3 delegate personas. The port records upstream commit `f8abeddd1862dc73704e3d719dd73df0d51b8c71`, version `0.15.1`; the [upstream README at that commit](https://github.com/cursor/plugins/tree/f8abeddd1862dc73704e3d719dd73df0d51b8c71/pstack) describes a workflow built around Cursor's orchestration. The article's count of 21 does not demonstrate missing principles here.

**What “vendor agnostic” currently means**

| Outcome | Current assessment |
|---|---|
| Maintain one source and generate several installation layouts | Substantially implemented; five distributions pass structural checks. |
| Preserve investigation, design, verification, and review intent | Substantially documented; the historical run shows that executing the named phases does not guarantee compliance inside them. |
| Switch agent hosts in one project without carrying incompatible configuration | Incomplete; reproduced stale configuration and missing validation below. |
| Obtain comparable quality and honest degradation on different hosts | Intended, but not established by a repeatable cross-host behavioral suite. |
| Delegate from one host to several independent model providers | No common provider execution adapter found. Current bindings use the host's own model access. |

The last outcome is an additional product capability. It is not required merely to distribute skills across hosts. Likewise, host-independent execution does not require inventing a whole new agent platform: small adapters and enforceable checks can preserve the existing host loops.

**Confirmed and material gaps, in priority order**

1. **P0: host configuration can be wrong while diagnostics report success.**

   The installer preserves `.pstack/host.json` and `.pstack/models.md`, but changes the receipt's single `host` field when another host is installed. The router then gives the saved profile precedence over its generated binding without requiring a host or session match. `doctor` checks that `host.json` exists, not that it parses or belongs to this host.

   Three temporary-install probes confirmed:

   - Invalid JSON in `host.json`: `doctor` exits 0 and prints `No problems found.`
   - A Claude profile in a clean Codex install: the same successful diagnostic.
   - Install Claude, configure `bug-fix: opus`, then install Codex: receipt says `codex`, profile still says `claude-code`, role still says `opus`, and both skill trees remain.

   Re-running setup can repair the selection manually, but one shared configuration cannot independently represent both hosts. This matters directly to a project opened in different tools. See [installer](../packaging/src/pstack_cli/installer.py), [doctor](../packaging/src/pstack_cli/cli.py), [router bootstrap](../core/skills/poteto-mode/SKILL.md), [probe script](portability-probes.py), and [actual output](2026-09-10-portability-probes.json).

2. **P0: phase completion and proof mostly remain model assertions.**

   The current bug-fix playbook adds a frozen reproduction harness, a final review for durability changes, named gates, and an audit block. These are useful corrections. However, no ordinary bug-fix runner validates a required evidence record before allowing the phase to be marked complete. There is no enforced connection between the implementation identity, the reproduction harness version, the final review, and the reported verdict.

   This repository does contain executable structure: `scripts/orch` stores program state and verdicts, `watch-pr` evaluates PR state, and `check-plan.mjs` validates a particular program-plan format. The gap is that these helpers do not enforce the ordinary poteto-mode bug-fix lifecycle. The Orchestrate playbook explicitly says its CLI never spawns, waits, or wakes agents. See [bug-fix](../core/playbooks/bug-fix.md), [Orchestrate](../core/playbooks/orchestrate.md), and [helpers](../core/skills/poteto-mode/scripts/).

3. **P1: capability detection conflates several different facts.**

   Setup counts two delegates returning as proof of parallelism, which also happens when they run serially. A requested non-default model does not by itself prove which model actually executed. Known hosts inherit most table cells despite the instruction to record only observed capabilities. The saved profile has no required host-version or execution-surface fingerprint to invalidate stale observations.

   `MODEL_CHOICE` also bundles model selection, model family, and provider diversity. Setup allows “genuinely different models” to establish full choice, while host profiles insist that Claude and Codex remain Tier 2 because they use one vendor. `roles.md` says Cursor is the only Tier 3 host, while the profile table also assigns Tier 3 to Copilot. These are conflicting contracts within the port, irrespective of what vendors currently support.

   Replace these with separate observed properties: delegation, maximum observed concurrency, requested/resolved model identity, provider, cancellation, background lifetime, filesystem isolation, transcript access, and execution surface. Derive capability summaries from those facts. See [setup](../core/skills/setup-pstack/SKILL.md), [profiles](../core/runtime/host-profile.md), [capabilities](../core/runtime/capabilities.md), and [roles](../core/runtime/roles.md).

4. **P1: workflow composition can still multiply work or choose the wrong panel.**

   The router sends any code crossing a function boundary to Architect. Architect requires another `how` grounding pass, and permits skipping that phase only for greenfield work, even when its caller has just produced grounding. There is no explicit reuse contract keyed to the scope and source revision.

   Architect asks for `architect-runners`, now defaulting to three, then invokes Arena. Arena's own runner-selection step reads `arena-runners`, defaulting to four. There is no explicit parameter or precedence rule carrying the caller's runner selection into Arena. A careful model may reconcile the intent, but lowering one default does not reliably lower the executed count.

   The degradation ladder generally preserves panel width, even when the host must serialize or use one context. Budget guidance exists in prose, including a throughput checkpoint and program-level limits, but ordinary bug-fix execution has no enforced run budget, retry ceiling, or stalled-delegate policy. See [router](../core/skills/poteto-mode/SKILL.md), [Architect](../core/skills/architect/SKILL.md), [Arena](../core/skills/arena/SKILL.md), and [degradation ladder](../core/runtime/capabilities.md).

5. **P1: host-dependent support components remain unresolved in shipped workflows.**

   Reflect, Automate-me, Eval, and other workflows still assume the system prompt provides an `agent-transcripts/` directory. The Claude run inspected here instead resides under the workspace-specific directory in `~/.claude/projects/`. A `TRANSCRIPTS` boolean does not resolve the path or parse the host's format.

   Advanced playbooks retain terminal `/loop`, `/goal`, a cloud-sleeper wake chain, and an agent store path expected from the system prompt. The automation layer offers cron/CI guidance and manual fallbacks, but no uniform implementation connects those references to wake, resume, or cancellation operations on each host. Verification tools are similarly project dependencies; possessing a skill that says “drive the real artifact” does not supply the driver.

   These dependencies also exist in upstream's environment; the port's obligation is to resolve them explicitly or report the unavailable behavior. See the shipped [Claude Reflect](../dist/claude/.claude/skills/reflect/SKILL.md), [Claude Autopilot-full](../dist/claude/.claude/skills/poteto-mode/playbooks/autopilot-full.md), and [automation contract](../core/runtime/automations.md).

6. **P1: the tests establish packaging integrity, not workflow equivalence.**

   `make verify` passed for all five distributions, including 271 YAML blocks. The existing packaging environment ran all 26 lifecycle tests successfully. Those are real strengths. Separate helper unit tests also exist for orchestration bookkeeping and PR watching.

   I did not find a checked-in harness that executes the same representative task across supported hosts, inspects actual delegation and evidence, then compares outcomes and latency. The Eval playbook describes an experiment; it is not such an executable regression suite. The README says CI runs on every push, but this checkout contains no `.github/workflows` files. This does not rule out external CI; it means that claim is not backed by configuration in this workspace. See [Makefile](../Makefile), [structural verifier](../build/verify.mjs), [lifecycle tests](../packaging/tests/test_lifecycle.py), and [README](../README.md).

7. **P1: run identity, state, and isolation are not consistently bound together.**

   Sticky mode is stored per project and tells the host to reread the router for engineering turns. That preserves preference, but does not provide a per-run phase ledger or a reliable resume point. Two sessions share the same mode and host files. Updating an install changes files in place; warning an already-running session does not stop its next routed skill read from loading a different version.

   Delegation documents directory/worktree isolation and now requests Claude worktrees for parallel writers. That correction should be retained. A separate output directory still does not isolate edits to an existing shared repository, and a reviewer with Bash is not filesystem read-only. The port now acknowledges the latter honestly, but the guarantees vary by host and need to be captured in each result. See [sticky mode](../core/runtime/sticky-mode.md), [delegation](../core/runtime/delegation.md), and [update](../packaging/src/pstack_cli/cli.py).

8. **P2, or P1 if mixed providers are a requirement: model-provider routing is absent.**

   Roles resolve to whatever the current host exposes. There is no common execution interface for launching another provider, normalizing its result, reporting its actual model, handling provider failure, and cancelling its work. Adding aliases or more stances cannot supply that capability.

   If mixed providers are required, implement one bounded leaf-delegate adapter first and make unavailable providers explicit. Cross-provider models can offer different perspectives, but vendor count alone is not a measured independence or correctness guarantee. Same-context personas should be reported as self-review, with no invented consensus claim.

**What the 39-minute Claude run actually establishes**

I parsed the parent transcript and its eight delegate transcripts, scoped to this run. The parent conversation spans 05:07:21.650–05:46:32.078 UTC, or 39.17 minutes.

| Observed operation | Evidence |
|---|---|
| Investigation | Two reviewer delegates, both requested on Sonnet, described as whole `how` and `why` jobs. |
| Design candidates | Four worker delegates, requested on Opus, Fable, Sonnet, and Opus. The candidate wave lasted about 11.1 minutes from the first worker transcript to the last completion. |
| Cross-judge | Fable delegate, 05:24:20.969–05:33:28.285, about 9.1 minutes. |
| Comment review | Sonnet delegate, 05:39:02.371–05:43:54.278, about 4.9 minutes. |
| Isolation request | None of the eight Agent calls included an `isolation` parameter. This alone does not establish shared output files; candidates also had assigned output locations. |
| Incomplete skill read | The parent read Arena with `sed -n 1,60p`, omitting its later phases. |

These stage windows include useful work and may overlap parent activity. They must not be summed as “wasted time.” The earlier [run audit](2026-09-10-bugfix-run-736701de.md) classified 19.1 minutes as parent idle time and 5.3 as over-specification. I have not independently recreated that activity classification.

That audit also reports a more serious defect: a worker crash after claiming a purchase could cause later deliveries to be acknowledged without sending the email, and an edited harness concealed the failure. I did not rerun its webhook correctness probes in this assessment, so those findings remain attributed to that audit. Passing the originally reported restart/duplicate scenarios would not, by itself, establish crash-recovery correctness.

Several current instructions were changed after this run: sketches instead of complete candidate implementations, parent-owned orchestration, explicit references, worktree isolation, frozen harnesses, and review gates. The old transcript cannot demonstrate that those corrections now work. They need a fresh controlled run. The previous audit's “25-minute floor” is a counterfactual estimate, not a measured lower bound or a useful performance promise.

**How this relates to the principles**

The principle inventory is present. The weak point is turning selected principles into observable behavior in PSTACK itself.

| Principle group | Assessment of this implementation |
|---|---|
| Prove It Works; Fix Root Causes; Test Behavior, Not Implementation; Sequence Verifiable Units | Good reproduction requirements and packaging tests. Missing repeatable proof that host workflows obey the requirements; a historical output failure survived the process. |
| Encode Lessons in Structure; Build the Lever | Build tooling, installer receipts, and program-state helpers embody these. Many fixes to ordinary execution remain additional prose. |
| Laziness Protocol; Subtract Before You Add; Minimize Reader Load; Guard the Context Window | Lazy bootstrap and sketch-only design help. Broad routing triggers, duplicated grounding, fixed panels, and full-router rereads still create avoidable work. |
| Model the Domain; Boundary Discipline; Type System Discipline | Role and capability vocabularies exist. Free-form model mappings, ambiguous capability values, and unvalidated profiles leave invalid combinations representable. |
| Make Operations Idempotent; Separate Before Serializing Shared State | Installer repeatability is tested and writer isolation is documented. Shared host/mode state and in-place updates leave cross-session behavior unresolved. |
| Attack the Premise; Foundational Thinking; Redesign from First Principles; Exhaust the Design Space | Competing designs are available. The product still needs an explicit distinction between host portability and mixed-provider execution, followed by experiments that justify orchestration cost. |
| Outcome-Oriented Execution; Migrate Callers Then Delete Legacy APIs | One core source is a sound direction. Remaining transcript/wake assumptions and duplicated host registries prevent a complete transition to a single resolved contract. |
| Experience First; Never Block on the Human | Autonomy is prominent in the instructions. Predictable runtime, reliable status, and useful completion evidence need the same priority. |

This maps all 23 local principles; it is not a numerical adherence score. In particular, the [Encode Lessons in Structure principle](../core/skills/principle-encode-lessons-in-structure/SKILL.md) explicitly calls for mechanisms instead of repeated instructions. A further round of longer instructions alone would repeat the failure mode.

**Recommended implementation sequence and acceptance criteria**

1. **Make switching hosts safe.** Define one validated configuration schema with per-host profiles and a clear current-session selection. Separate capability observations from user model preferences. Reject malformed profiles, invalidate mismatched observations, and make `doctor` show the exact resolved host/model/tier with reasons. Acceptance: the three probes in this audit report the incompatibility or resolve it correctly; switching Claude → Codex → Claude preserves each host's preferences.

2. **Make one bug-fix loop reliable.** Use a small run record with run ID, task, source revision or tree digest, skill-build identity, phase, delegates, evidence paths, and stop condition. Freeze the reproduction identity and require final verification/review against the actual final artifact. Keep existing native agent tools. Acceptance: missing reproduction, changed harness, stale review, and incomplete delegate output cannot produce a clean completion record.

3. **Bound the work and make composition explicit.** Pass Architect's selected runners and artifact type into Arena; reuse applicable grounding; distinguish routine, substantial, and exploratory work using observable scope and uncertainty. Set configurable limits on elapsed time, delegates, and retries. On exhaustion, return a resumable partial result with the unmet condition, not a false success. Acceptance: a one-module fix does not produce four working alternatives unless a named empirical question requires them, and a stalled delegate has a finite recovery path.

4. **Resolve remaining host operations.** Provide scoped transcript discovery/parsing, model identity reporting, concurrency/cancellation checks, evidence capture, and wake/resume mappings where supported. Report unsupported capabilities before their phase starts. Acceptance: transcript lookup uses only the active workspace, provider fallback is visible, and resume does not rerun completed evidence-bearing phases.

5. **Prove behavior before expanding coverage.** Build representative tasks for a trivial edit, an ordinary bug, a durability bug, a small feature, a no-delegation host, a failed delegate, a host switch, and interruption/resume. Compare the current workflow with a direct-agent baseline using equivalent tasks, models, and environments; repeat trials. Measure final correctness, completed proof, skill compliance, delegate count, latency, and available token/cost telemetry. Keep missing telemetry explicit. Only claim parity for host/task combinations that pass. Add mixed-provider execution if that is part of the intended product contract.

The first milestone should be a trustworthy bug-fix loop on two hosts, with the previous failure case included. It should preserve the existing principles and useful helpers while making fewer guarantees depend on the model remembering another paragraph.

**Validation and limits**

- `make verify`: passed across five builds; strict YAML parser accepted 271 blocks.
- `packaging/.venv/bin/python -m pytest packaging/tests -q`: 26 passed. System Python lacked pytest, so the existing project environment was used.
- `python3 audits/portability-probes.py`: reproduced all three configuration/diagnostic gaps in temporary installs. Probe output is saved alongside this report.
- Read and parsed the original Claude run and delegate metadata; no new paid model runs were launched.
- Product code, generated distributions, installed profiles, and the webhook project were not changed. Added this report, its diagnostic script, and its captured output.
- Assessment uses the working tree as found; its files were already untracked. No commit-based before/after claim is made. No live certification of Cursor, Copilot, or Codex capability tables was performed.
