# Codex init assessment

Checked 2026-09-10 with the installed `pstack 1.0.0` and `codex-cli 0.153.4`.

**Verdict: `pstack init --host codex` implements file installation, but the Codex runtime
integration is incomplete.** The earlier routing-readiness assessment established substantial
instruction coverage; it did not establish that this command configures usable native roles and
their permissions. These additional findings narrow that assessment.

## Actual installation result

Ran the installed `~/.local/bin/pstack` against a fresh temporary git repository:

```text
pstack init --host codex --target <temporary repository>
exit: 0
wrote 216 file(s)
AGENTS.md: created
Next: open a session ... and run $setup-pstack
```

`pstack status` reported 216 intact files, mode off, and Tier 2 as a build default.
`pstack doctor` exited 1 with:

```text
setup-pstack has not run, so capabilities are build-time guesses
Run $setup-pstack in a session
```

| Installed item | Observed |
|---|---|
| `.agents/skills/poteto-mode/SKILL.md` | Present |
| `.agents/skills/setup-pstack/SKILL.md` | Present |
| `.agents/skills/pstack-runtime/host-binding.md` | Present |
| `AGENTS.md` | Present |
| `.pstack/receipt.json`, `.pstack/mode.md` | Present |
| `.pstack/host.json`, `.pstack/models.md` | Absent; deliberately deferred to in-session setup |
| `.codex/config.toml.example` | Present |
| `.codex/config.toml` | Absent |
| `.codex/agents/*.toml` | None |

The skill directory is supported by current Codex. Repository skills are discovered under
`.agents/skills`. [Official skill documentation](https://learn.chatgpt.com/docs/build-skills).

## Confirmed integration gaps

1. **The reviewer configuration is ignored by the actual Codex runtime.**
   The generated example contains `[agents.pstack-reviewer]` with only `sandbox_mode` and a
   misplaced `model_reasoning_effort`. A startup check of the corresponding reviewer override
   emitted:

   ```text
   Ignoring malformed agent role definition: agent role `pstack-reviewer` must define a description
   ```

   Reproduction, which starts no model turn or delegate:

   ```sh
   codex app-server --strict-config \
     -c 'agents.pstack-reviewer.sandbox_mode="read-only"' \
     --listen stdio:// </dev/null
   ```

   The same startup without that override did not emit the malformed-role error. Both exited 0;
   checking the process exit code alone would miss it. Unrelated startup plugin/network warnings
   were not treated as evidence for this finding. The user config file was not edited.

2. **Native PSTACK agents are not generated.**
   The port puts personas in `.agents/skills/pstack-runtime/personas/` and tells the parent to
   paste their contents into generic delegate prompts. `core/runtime/delegation.md` and generated
   usage documentation say Codex has no named-agent definition facility. That statement is
   outdated. Current Codex supports project `.codex/agents/*.toml` definitions with `name`,
   `description` and `developer_instructions`; sandbox settings can be configured there.
   [Official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
   Generic persona prompting can still work, but it does not supply the native role and
   configuration guarantees the port advertises.

3. **Init ships an example instead of completing host configuration.**
   It does not create or merge an active `.codex/config.toml`. The generated guide asks users to
   copy or merge the example into their global config. Codex supports project configuration,
   subject to project trust. Existing configuration and runtime permission overrides must be
   respected when implementing this integration.
   [Official config documentation](https://learn.chatgpt.com/docs/config-file/config-basic).

4. **The example also has a TOML scope error.**
   Its final `model_reasoning_effort = "medium"` is inside `[agents.pstack-reviewer]`, although
   its comment presents it as a general model-class setting. Parsing with Python `tomllib`
   confirms the nesting. It is not a root setting.

5. **Doctor does not validate these Codex runtime requirements.**
   `packaging/src/pstack_cli/cli.py:245` checks receipts, installed paths, the memory file and
   PSTACK profile validity. It does not establish that Codex loads the role definitions or applies
   their intended settings. The fresh-install warning about missing setup is correct, but it does
   not diagnose the malformed reviewer example.

6. **Generated entry-point guidance is inconsistent.**
   Codex `AGENTS.md` uses `$poteto-mode` but still advertises `/setup-pstack` and `/how`, `/why`,
   etc. The CLI's own next-step output correctly says `$setup-pstack`. This can confuse the
   exact setup the user needs to perform after installation.

The all-host install test in `packaging/tests/test_lifecycle.py:126` checks successful exit and
more than 100 receipt files. Other profile tests cover host switching and profile validation.
These are useful, but none of those assertions proves native Codex role loading or enforcement.

## Concrete implementation needed

- Generate supported native definitions for `pstack-worker`, `pstack-reviewer` and `comment-sicko`,
  carrying the existing persona instructions into the appropriate Codex configuration format.
- Replace the malformed reviewer example and correct the TOML scope. Configure necessary
  project defaults without clobbering existing user/project settings or overriding user permission
  choices. Validate the effective settings rather than promising an unconditional read-only guard.
- Make initialization's two stages explicit: installed files versus capabilities verified in a live
  Codex session. Keep capability provenance truthful until `$setup-pstack` observes it.
- Extend doctor and installation checks to cover native agent loading and configuration errors;
  update Codex invocation strings and remove the outdated named-agent limitation.
- Rebuild/package and verify discovery, explicit activation, role selection, delegation and a full
  bug-fix route in Codex. This assessment did not start a model turn and does not claim those
  behavioral checks have passed.

Primary implementation sources: [host registry](../packaging/src/pstack_cli/hosts.py),
[CLI](../packaging/src/pstack_cli/cli.py), [generator](../build/build.mjs), and
[delegation binding](../core/runtime/delegation.md).

This assessment changed only this audit document. Installation occurred in a temporary repository;
no project/global Codex configuration was installed or rewritten.
