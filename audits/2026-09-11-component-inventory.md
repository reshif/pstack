# PSTACK component inventory — 2026-09-11

The upstream component inventory is accounted for in this checkout and its five generated host packages. This establishes distribution coverage, not equivalent runtime behavior across vendors.

## Baseline and method

- Local pin: PSTACK 0.15.1, commit `f8abeddd1862dc73704e3d719dd73df0d51b8c71`, from `build/upstream.json`.
- Upstream main inspected: PSTACK 0.15.2, commit `f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d`.
- Enumerated GitHub recursive trees for both commits; neither response was truncated. Both contain 158 files under `pstack/`, with the same path inventory.
- Compared upstream paths with core, including explicit relocation, rename, and agent replacement mappings. Repository metadata maps to root files or generated Cursor metadata.
- Checked 155 mapped distribution paths per host: the 154 upstream files outside four repository/plugin metadata files, plus the added reviewer role. For Claude, Codex, Copilot, Cursor, and generic builds, every path exists, has a Python package index entry, and has a package blob whose SHA-256 matches both its index and the generated file.
- No model sessions, helper execution tests, automation events, or complete workflow evaluations were run for this inventory audit. Source presence does not demonstrate semantic equivalence.

Full paths, counts, mappings, package check results, and environment dependency probes are in [the JSON evidence](2026-09-11-component-inventory.json).

## Component coverage

| Component | Article headline | Inspected upstream and port | Assessment |
|---|---:|---|---|
| Non-principle skill definitions | 23 workflow skills | 24: 22 classified as workflow, `poteto-mode` router, `setup-pstack` setup | Every upstream definition and its support files is present in every host distribution. These are not necessarily 24 picker commands. |
| Engineering principles | 21 | 23 principle skill definitions | All present in core and every host distribution. |
| Task playbooks | 22 | 23 files, including internal `opening-a-pr` | All present. The article separately describes 22 user-facing playbooks plus the internal PR playbook, so counting conventions matter. |
| Specialized agents | 2 | Upstream `comment-sicko` and `poteto-agent`; port `comment-sicko`, `pstack-worker`, `pstack-reviewer` | Adapted rather than copied one-to-one. Copilot also has a host coordinator agent. |
| Helpers | Unnumbered | 21 files under upstream script directories | All shipped. This includes tests, manifests, and support modules, not 21 distinct executable programs. |
| Optional automation pack | 1 | Benny: 12 files, 3 embedded skills, 2 automation flows | All shipped as dormant setup material. Running the automations requires project configuration, a trigger, channel access, and verification adapters. |

The remaining upstream inventory comprises 31 skill reference files and 22 documentation, asset, and metadata files. All have local mappings. `bugbot-triage.md` is renamed `automated-reviewer-triage.md`; this is not a missing reference.

For Copilot, `typescript-best-practices` is emitted as `.github/instructions/typescript-best-practices.instructions.md`, with its reference directory, instead of a `SKILL.md`. Availability therefore cannot be assessed solely by counting slash commands.

## Material adaptations and readiness limits

1. **Agent orchestration differs.** Upstream `poteto-agent` is a background routing target whose instructions prefer resuming the conversation's existing agent. Here the parent owns routing and dispatches bounded worker/reviewer jobs. The runtime also prefers fresh delegates. Those choices can support portability, but counting three roles does not establish equivalence with the original two agents. The current Codex distribution contains three persona Markdown files under `pstack-runtime/personas`; it does not contain native `.codex/agents/*.toml` definitions. Whether the session can execute the intended delegation still needs host-level evidence.
2. **Helper distribution is complete; execution is unverified here.** The upstream helpers include `check-plan.mjs`, `orch/orch.ts`, `watch-pr/watch-pr`, `worktree-audit.sh`, `show-me-your-work/scripts/log.sh`, and the Bun bootstrap. In this audit environment, `bun` and `gh` are absent from PATH. Bun-backed helpers and the full GitHub-dependent helper behavior cannot be assumed ready here. The normal `make verify` target does not run the bundled `bun test orch watch-pr` suite or its TypeScript typecheck.
3. **Automation installation is not activation.** `core/automations/benny/README.md` explicitly calls its files dormant setup and automation sources. The triage and reproduction flows require a configured runner, source-channel integration, repository control/verification adapters, and a test event. `make-bot-ui` similarly requires an actual trigger; its fallback starts the run manually. These requirements are expected optional setup, but they prevent a blanket claim of automated parity after `pstack init`.
4. **The inventory is ahead of some port documentation.** `docs/PORTING.md` still says `make-bot-ui` ships only in Cursor. The current manifest and all five checked packages include it, with capability-dependent behavior. This audit follows emitted artifacts rather than that stale claim.
5. **Workflow correctness needs separate evidence.** File and package checks cannot establish that routing reads the applicable principles, chooses the right playbook, delegates with supported models, runs the required gates, and verifies the final artifact. Router, direct-skill, persistent-mode, and automation entry paths need execution evidence on each supported host surface. Earlier readiness findings are documented in the adjacent 2026-09-10 audits; they were not re-tested here.

A routing trace can record what happened and expose skipped steps. It does not itself implement host delegation, triggers, model selection, or verification enforcement.

## Upstream drift

The local pin is 0.15.1 while inspected upstream main is 0.15.2. No component paths were added or removed. Five files changed: the plugin manifest, `poteto-mode/SKILL.md`, and the `autopilot-full`, `autopilot-stack`, and `multi-phase-plan` playbooks. Inspection shows a version bump, operator wording changes, and a clarification to post a status message in chat. This is a small synchronization item, not evidence of missing component categories. This audit does not establish whether every wording change already has an equivalent in the adapted port.

## Sources

- [Article and its counts](https://flaviocopes.com/pstack/).
- [Pinned upstream PSTACK tree](https://github.com/cursor/plugins/tree/f8abeddd1862dc73704e3d719dd73df0d51b8c71/pstack).
- [Inspected upstream 0.15.2 tree](https://github.com/cursor/plugins/tree/f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d/pstack).
- [Original poteto-agent contract](https://github.com/cursor/plugins/blob/f8abeddd1862dc73704e3d719dd73df0d51b8c71/pstack/agents/poteto-agent.md).
