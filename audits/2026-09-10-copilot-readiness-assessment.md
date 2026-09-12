# Copilot readiness assessment

Checked 2026-09-10, specifically for PSTACK in Copilot within VS Code.

**Verdict: usable for supervised trials; pending work remains.** Installation and generated agent
configuration are implemented. Correct autonomous completion and live cross-vendor routing have
not been established by the checks performed here.

## Verified in this assessment

- The installed `pstack 1.0.0` successfully initialized a temporary project for Copilot, writing
  171 payload files and creating `.github/copilot-instructions.md`.
- The installation includes `pstack.agent.md` plus `pstack-worker`, `pstack-reviewer` and
  `comment-sicko`. The coordinator includes the `agent` tool and explicitly allows those three
  delegates. The delegates are hidden from the user picker and remain available as subagents.
- The generated structures match the documented coordinator/worker configuration pattern.
  [VS Code subagents](https://code.visualstudio.com/docs/agents/run/subagents).
- `node build/check-routing.mjs` passed 46 instruction contracts across all five host builds.
- The installed Copilot completion checker matched the generated build byte-for-byte, SHA-256
  `783252ddcfc056bdda9478845468bd609ee57fd3b4d6509be1d0d85d975a62bd`.
- Additional probes against that checker found three incorrect completion verdicts:
  a stale review, an explicitly failed review without resolution, and skipped mandatory
  verification all returned `complete`. The historical-skip-then-failed-verification scenario
  correctly returned incomplete in this newer package.

Results: [Copilot checker probes](2026-09-10-copilot-readiness-probes.json).
Reproduction: `python3 audits/readiness-probes.py dist/copilot/.github/skills/poteto-mode/scripts/run-record.py`.
The probes exercise the helper in temporary git repositories using real failing/passing test
commands and controlled review inputs. They do not run a Copilot model session.

## Pending work and limits

1. **Completion validation needs fixing.** Require current, resolved review evidence and keep a
   bug-fix run incomplete when mandatory verification cannot run. Add the reproduced cases to the
   regression suite and verify the packaged artifact after rebuilding.
2. **Cross-vendor model selection needs live validation.** The delegate definitions do not pin
   models. This is not inherently a defect: VS Code supports a model argument on `runSubagent`,
   then an agent-configured model, then inheritance from the parent. The PSTACK binding tells the
   parent to request the configured model in its delegation instructions. Record the actual model
   selected for each job and check unavailable-model/cost-tier fallback before claiming a Tier 3
   panel. A model picker alone does not prove that the requested models ran.
   [Documented model selection](https://code.visualstudio.com/docs/agents/run/subagents#select-the-model-for-a-subagent).
3. **The evaluation harness does not yet score Copilot transcripts.** `evals/run.py` emits
   `copilot-unparsed`, and `evals/analyze.py` explicitly skips parsing that format. It launches host
   CLIs, so it also does not directly exercise the user's VS Code workflow. The observer has
   separate readers; its display tests are not a replacement for workflow conformance checks.
   Capture and evaluate a real VS Code run covering activation, role selection, investigation,
   implementation, review returns, final verification and reporting.
4. **Reviewer access is a limited contract.** Its whitelist excludes edit tools but retains terminal
   execution, which can write files. The usage guide discloses this correctly. Treat read-only as
   an instruction boundary with this configuration; any stronger isolation claim needs an enforced
   boundary and an appropriate test. The fixed tool lists also need validation against the actual
   project's verification and source-access needs; no MCP tools are explicitly included.
5. **The guide overstates readiness.** The Copilot usage section says a full panel runs with nothing
   degrading. Replace this unconditional claim with the observed session capabilities and model
   results. Runtime binding already qualifies some of the requirements; documentation should agree.

The next readiness gate is corrected completion checks plus a recorded, independently verified
Copilot VS Code run. No model turn was started, no user project was switched to Copilot, and no
PSTACK implementation files were changed during this assessment.
