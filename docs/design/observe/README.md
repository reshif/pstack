# pstack session workspace — design preview

## Implemented session interface

The shipped frontend is [observe/ui/index.html](../../../packaging/src/pstack_cli/observe/ui/index.html).
Sessions open in Story, with expandable agent work and original source events.
Map provides the delegation canvas and recorded workflow views. Activity retains
raw conversation and tool filters. Session details contains agents, files and
references, recording coverage, and explicit workflow evidence.

Screenshots from the running app: [Story](previews/implemented-story.png),
[Map in dark appearance](previews/implemented-map-dark.png), and
[Story on mobile](previews/implemented-story-mobile.png).

Session replay adds one history position across Story, Map, Activity, and agent
inspection. The bottom bar provides play/pause, previous/next, speed, Follow,
and Return to live. Live events keep collecting while history is paused.
Replay uses the available event window and timestamped workflow records;
original logs and artifact previews remain current-file views.

Replay screenshots from the running IPAM session:
[Map](previews/session-replay-map.png),
[Story](previews/session-replay-story.png),
[Activity](previews/session-replay-activity.png), and
[mobile](previews/session-replay-mobile.png).

## Earlier workflow design

Open **[workflow.html](workflow.html)** directly in a browser. This is an earlier
design study, based on the user's original Mermaid flowchart. It uses
illustrative data and does not change the installed `pstack serve` frontend.
It needs no HTTP server, build step, or network connection.

- All **21 nodes and 26 connections** retain the original direction and conditions.
- The main surface is a top-to-bottom workflow. The current step opens at a
  readable scale; Full workflow, zoom, pan, and the map reveal the entire route.
- `how` and `why` branch and rejoin at parent confirmation. The function boundary
  decision visibly separates Architect A/B/C from direct implementation.
- All four dashed return paths keep their reasons beside their arrows. A taken
  verification return is highlighted and linked to the failed attempt.
- Node selection opens summary, activity, and route details. Replay changes the
  sample states on the same graph. Status labels supplement color.

Review screenshots: [verification return](previews/workflow-retry.png),
[parallel investigation](previews/workflow-parallel.png),
[Architect decision](previews/workflow-architect.png), and
[mobile](previews/workflow-mobile.png). The complete route is available as
[SVG](previews/workflow-route.svg) and [PNG](previews/workflow-route.png).

Browser checks cover exact graph topology, parallel positions, the active return,
node details, attempts, replay, host examples, zoom, full-route fitting, and mobile
layout. The preview runs directly from a local file; no test server is left running.

For production, entry, routing, gates, and boundary decisions need explicit
records before they can appear completed. Existing run snapshots remain the
authority for their historical route. Unrecorded decisions must be visible as
unrecorded, and a failed verification must not reset unrelated completed work.

## Earlier layout studies

A standalone, interactive frontend study using sample sessions. Open
`index.html` directly, or serve this directory:

```sh
python3 -m http.server 7780 --bind 127.0.0.1 --directory docs/design/observe
```

Then open http://127.0.0.1:7780/. No build step, dependencies, or external
assets are required. The preview does not read or modify real sessions.

## Compare the directions

The selector in the top bar changes the information layout. The session and
its sample workflow are shared so the comparison stays meaningful.

| Direction | What it prioritizes | Preview |
| --- | --- | --- |
| A — Workflow canvas | The current step, parallel investigations, transitions, and retries. Selecting a step opens its evidence and attempt history. | [Canvas](index.html#session=retry&direction=canvas) |
| B — Task journey | A readable account of each step's result, with agent work and retry reasons alongside it. | [Journey](index.html#session=retry&direction=journey) |
| C — Session overview | Finding active work, picking up an earlier session, and identifying work waiting for a requested review. | [Overview](index.html#direction=overview) |

Recommended product structure: use the overview as the workspace landing page,
open a tracked session in the canvas, and offer the journey as an alternative
view of the same records. Light and dark appearance are secondary preferences.

Saved desktop previews: [canvas](previews/canvas.png),
[journey](previews/journey.png), [overview](previews/overview.png), and
[conversation](previews/conversation.png).

## Interactions to review

- Select a workflow step to inspect its owner, outcome, checks, and raw record.
- Follow the amber return path and switch between failed and current attempts.
- Replay the upload session to see investigations working in parallel and the
  verification failure. Replay stops at the latest recorded sample state.
- Open Activity for prompts, responses, and expandable action groups; open it
  from a step to narrow the context.
- Select the session viewer conversation to see the experience without phase
  records. It opens Activity with session context rather than an empty graph.
- From the overview, open the allocation recovery session and read its design
  note. This sample explicitly models a user-requested review before coding.
- Inspect the completed authentication session for a finished workflow.
- Search by task or project, filter by host, and compare session status filters.

## Design principles

The task is the primary identity. Production titles should come from a useful
recorded task title or the first substantive user prompt; pasted-file wrappers,
session IDs, and short continuations such as “go” should not replace it. Preserve
the complete original prompt in Activity. Generated summaries would need clear
provenance; the summaries here are authored sample copy.

Progress should explain what happened and what is happening now. Resolved-step
counts describe recorded workflow state; they are not estimates of remaining
time. Completed, running, skipped, failed, waiting, and unrecorded work need
distinct labels in addition to color. Attempts and return reasons belong with
the affected step.

Raw tool payloads and identifiers stay available through disclosure controls.
The main view emphasizes task context, meaningful actions, results, and linked
evidence. Session host data and explicit pstack phase records remain distinct;
missing phase records should not create invented workflow progress.

## Scope and validation

This is a design prototype, separate from the installed observer at port 7777.
It uses fixed sample data and does not connect to the observer API. Replay is
implemented for the upload sample; other sessions present fixed snapshots.
Authentication, production data loading, live updates, and a full accessibility
audit are outside this design study.

Browser validation covers all three directions, session selection, step and
attempt inspection, action disclosure, evidence, replay, zoom, search, theme
switching, and layout at desktop and mobile viewport sizes.
