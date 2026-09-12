# build/

Compiles `core/` into one distribution per host under `dist/`, then proves the output. Run
everything from the repository root through `make`; the Makefile stays at the root.

## Files

| file | purpose |
|---|---|
| `gen-routes.py` | Compiles every playbook's phase graph, with `route-contracts.json` and `workflow-blueprints.json`, into `core/skills/poteto-mode/scripts/routes.json` |
| `gen-manifest.py` | Rebuilds `core/manifest.json`: every skill, its kind and its capability requirements. Reads the upstream version and `port_owned` from `port/upstream.json` |
| `build.mjs` | Compiles `core/` into `dist/<host>/` for each host. No dependencies, deterministic |
| `verify.mjs` | Proves every host's build: frontmatter, vendor leaks, relative references, tables. Exits non-zero on failure |
| `check-routing.mjs` | Checks the bug-fix routing contract in every built host |
| `check-yaml.py` | Strict YAML parse of every emitted frontmatter block. Skipped when pyyaml is absent |
| `package.py` | Packs the host builds into `packaging/src/pstack_cli/data` as a content-addressed store |
| `build_lock.py`, `build-lock.mjs` | The checkout-wide lock that build, verify and package commands hold. The `.mjs` file is the Node entry point to the same lock |
| `route-contracts.json` | Per-route requirements: artifacts, verification, review, delegation, permitted skips. See [workflow-contracts.md](../docs/workflow-contracts.md) |
| `workflow-blueprints.json` | Diagram layouts for route flows, copied into `routes.json` |

## Folders

- `tests/`: `test-build-lock.py` runs overlapping build, verify and package commands in an isolated
  copy of the checkout. `test-run-record.py` runs the bug-fix completion checker against real git
  repositories. `make verify` runs both.
- `port/`: the one-time upstream port. `normalize-core.py` and `normalize-pass2.py` to
  `normalize-pass4.py` strip host coupling from a vendored upstream copy and replay the former hand
  edits. `check-upstream.py` compares the port against an upstream checkout. `upstream.json`
  records the upstream commit the port came from and the `port_owned` files with their upstream
  hashes. The build never runs these; they are for re-deriving `core/` from a newer upstream.

## Running

```bash
make                  # manifest, build, verify
make manifest         # gen-routes.py, gen-manifest.py
make build            # build.mjs
make verify           # verify.mjs, check-routing.mjs, tests/, check-yaml.py
make package          # build, then package.py
make test-cli         # package, then the CLI's pytest suite
make upstream UPSTREAM=/path/to/cursor-plugins   # port/check-upstream.py
```

To re-derive `core/` against a newer upstream, follow the recipe in
[docs/PORTING.md](../docs/PORTING.md#re-deriving-against-a-newer-upstream). It runs the four
`port/normalize-*.py` passes in order, then `gen-manifest.py`, `build.mjs` and `verify.mjs`.
