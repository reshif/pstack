const $ = (s, root = document) => root.querySelector(s);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hosts = {claude:'Claude Code', codex:'Codex', copilot:'Copilot'};
const hostMark = host => `<span class="host-mark ${host}" aria-label="${hosts[host]}">${host === 'claude' ? '✳' : host === 'codex' ? '⌘' : '⌥'}</span>`;
const sessions = [
  {id:'retry', title:'Fix uploads that retry forever', project:'uploader', branch:'fix/retry-budget', host:'claude', state:'active', stateLabel:'Verifying the fix', age:'now', duration:'18m 24s', agents:4, model:'Opus', tracked:true, snapshot:4, description:'A capped retry budget, growing backoff, and a queue that recovers after success.'},
  {id:'viewer', title:'Design the session progress viewer', project:'PSTACK', branch:'main', host:'codex', state:'waiting', stateLabel:'Waiting for your next prompt', age:'12m', duration:'21m 24s', agents:1, model:'GPT-6 Astra', tracked:false, description:'Explore a local workspace for following agent sessions from prompt to outcome.'},
  {id:'approval', title:'Fix allocation recovery after a crash', project:'ipam', branch:'fix/allocation-recovery', host:'claude', state:'blocked', stateLabel:'Design ready for review', age:'28m', duration:'12m 08s', agents:3, model:'Opus', tracked:true, snapshot:2, description:'Recover interrupted allocations without reserving the same address twice.'},
  {id:'complete', title:'Fix the refresh token race', project:'auth-service', branch:'fix/token-refresh', host:'copilot', state:'complete', stateLabel:'Completed · all checks passed', age:'1h', duration:'14m 32s', agents:4, model:'Configured model', tracked:true, snapshot:5, description:'Concurrent refresh requests now share one token rotation and preserve the session.'}
];
const phases = [
  {id:'reproduce', n:1, title:'Reproduce', icon:'flask', x:35, y:78, duration:'1m 42s', summary:'Preserved a failing test that reproduces the endless retry on the original code.', outcome:'The test made 17 attempts against a budget of 5. The failing baseline was saved before the fix.'},
  {id:'root-cause', n:2, title:'Investigate the cause', icon:'search', duration:'4m 10s', summary:'Two investigations explained the retry mechanism and the change that introduced it.', outcome:'The parent confirmed that resetting the attempt counter on every 503 defeats both the retry budget and backoff.'},
  {id:'plan', n:3, title:'Plan the fix', icon:'file', x:865, y:78, duration:'Skipped', summary:'The fix stays inside one function, so a separate architecture review was not needed.', outcome:'Skipped with a recorded reason: no function boundary is crossed.'},
  {id:'implement', n:4, title:'Implement', icon:'code', x:865, y:285, duration:'3m 18s', summary:'A worker added a bounded retry budget and reset it after a successful upload.', outcome:'The public queue API is unchanged. The default budget is five attempts and remains configurable.'},
  {id:'cleanup', n:5, title:'Clean up', icon:'check', x:585, y:285, duration:'36s', summary:'Reviewed the changed code for unnecessary complexity and checked formatting.', outcome:'The diff is focused on the retry lifecycle. Static checks passed.'},
  {id:'review', n:6, title:'Review', icon:'agents', x:305, y:285, duration:'2m 05s', summary:'A reviewer checked failure handling and recovery after successful uploads.', outcome:'The first review found that the budget was not reset on success. That finding was addressed in the second attempt.'},
  {id:'verify', n:7, title:'Verify the fix', icon:'flask', x:35, y:285, duration:'42s', summary:'Rerunning the original reproduction and the full suite against the updated fix.', outcome:'The original reproduction passes. The full suite is still running.'},
  {id:'commits', n:8, title:'Arrange commits', icon:'branch', x:35, y:465, duration:'Not started', summary:'The reproduction commit will come before the fix, so reviewers can verify the baseline.', outcome:'Waiting for verification to finish.'},
  {id:'open-pr', n:9, title:'Open pull request', icon:'arrow', x:305, y:465, duration:'Not started', summary:'Prepare the change and its evidence for review.', outcome:'Waiting for the final checks and ordered commits.'},
  {id:'how', n:2, title:'How it works', icon:'search', duration:'2m 14s', summary:'Traced the queue’s retry counter, scheduling logic, and backoff calculation.', outcome:'The attempt counter resets whenever the upstream response is 5xx. The budget never reaches its limit.', agent:'How explorer', model:'Haiku'},
  {id:'why', n:2, title:'Why it regressed', icon:'branch', duration:'3m 02s', summary:'Investigated the history behind the retry behavior.', outcome:'A change to reset backoff after server errors also reset the attempt counter.', agent:'History investigator', model:'Sonnet'}
];
const snapshots = [
  {time:'01:42', label:'Reproducing the failure', current:'reproduce', note:'Establishing the failing baseline before making changes.', resolved:0},
  {time:'05:52', label:'Investigating in parallel', current:'root-cause', note:'Tracing the mechanism and investigating the regression history.', resolved:1},
  {time:'09:10', label:'Implementing the fix', current:'implement', note:'Applying the selected change to the retry lifecycle.', resolved:3},
  {time:'14:02', label:'Verification found a failure', current:'verify', note:'Two checks failed. The recorded path returns to investigation.', resolved:6},
  {time:'18:24', label:'Verifying the fix', current:'verify', note:'The original reproduction passes. The full suite is running.', resolved:6},
  {time:'20:08', label:'Work completed', current:'open-pr', note:'Verification passed and the pull request is ready for review.', resolved:9}
];
const state = {session:'retry', tab:'workflow', selected:'verify', attempt:2, snapshot:4, direction:'canvas', activityFilter:null, overviewFilter:'all', playing:false, scale:1, tx:0, ty:0};
let player, toastTimer, resizeObserver;
const current = () => sessions.find(s => s.id === state.session);
const sessionPhaseCopy = {
  approval: {
    reproduce: {summary:'Reproduced a crash between address reservation and allocation completion.',outcome:'A second request reserved the same address after the first request was interrupted.'},
    'root-cause': {summary:'Traced the persisted reservation and the recovery path.',outcome:'A reservation survives the crash, but recovery cannot identify which allocation owns it.'},
    how: {summary:'Traced the allocation transaction and reservation lifecycle.',outcome:'The reservation is persisted before the allocation reaches a terminal state.'},
    why: {summary:'Reviewed the change that introduced resumable allocations.',outcome:'The recovery path was added without retaining reservation ownership after interruption.'},
    plan: {summary:'Propose an explicit recovery state within the existing transaction boundary.',outcome:'The design is ready for the review you requested.',duration:'6m 16s'},
    implement: {summary:'Implement the reviewed recovery design.'},
    verify: {summary:'Run the crash reproduction and allocation regression suite.'}
  },
  complete: {
    reproduce: {summary:'Preserved a failing test for simultaneous token refresh requests.',outcome:'Two refresh requests rotated the same token independently and invalidated the session.'},
    'root-cause': {summary:'Traced concurrent requests through the token rotation path.',outcome:'Both requests read the previous token before either one persisted the replacement.'},
    how: {summary:'Traced token reads and rotation writes.',outcome:'The read and rotation were individually valid, but concurrent requests could interleave.'},
    why: {summary:'Reviewed how parallel requests reached the refresh endpoint.',outcome:'The client began refreshing multiple requests concurrently without sharing the refresh result.'},
    implement: {summary:'Coalesced refresh requests so they share one token rotation.',outcome:'Concurrent callers receive the same replacement token. Session behavior is preserved.'},
    review: {summary:'Reviewed concurrent refresh behavior and error recovery.',outcome:'The reviewer confirmed that a failed refresh clears the pending operation for the next request.'},
    verify: {summary:'Verified the concurrent refresh reproduction and the authentication suite.',outcome:'The original reproduction and all 84 authentication checks passed.',duration:'3.12s'},
    commits: {summary:'Arranged the regression test before the fix.',outcome:'The reproduction commit precedes the fix, preserving the failing baseline.',duration:'31s'},
    'open-pr': {summary:'Prepared the change with its verification evidence.',outcome:'The pull request is ready for review, with the reproduction and final checks attached.',duration:'24s'}
  }
};
const phase = id => ({...phases.find(p => p.id === id),...sessionPhaseCopy[current().id]?.[id]});
const stepSummary = (p, status) => status === 'future' ? `Next: ${p.title.toLowerCase()}. No work has been recorded for this step.` : status === 'active' && p.id !== 'verify' ? `Working on ${p.title.toLowerCase()}. The result will appear when this step finishes.` : p.summary;
const stepOutcome = (p, status) => status === 'future' || status === 'active' ? stepSummary(p,status) : status === 'failed' ? 'Two recovery checks failed. The workflow returned to investigation.' : p.outcome;
const statusNames = {done:'Completed',active:'In progress',future:'Not started',skipped:'Skipped',failed:'Failed',blocked:'Needs review'};
function nodeStatus(id) {
  const s = current(), t = state.snapshot;
  if (s.id === 'approval') {
    if (['reproduce','root-cause','how','why'].includes(id)) return 'done';
    return id === 'plan' ? 'blocked' : 'future';
  }
  if (['how','why'].includes(id)) return t === 0 ? 'future' : t === 1 ? 'active' : 'done';
  const index = phases.findIndex(p => p.id === id);
  if (t === 5) return id === 'plan' ? 'skipped' : 'done';
  if (id === 'plan' && t >= 2) return 'skipped';
  const currentIndex = [0,1,3,6,6][t];
  if (index < currentIndex) return 'done';
  if (index > currentIndex) return 'future';
  return t === 3 ? 'failed' : 'active';
}
function pill(status, label) {
  const tone = ['done','complete'].includes(status) ? 'complete' : ['blocked','failed'].includes(status) ? 'blocked' : ['future','skipped','waiting'].includes(status) ? 'neutral' : '';
  return `<span class="status-pill ${tone}"><span class="status-dot ${tone === 'complete' ? 'complete' : tone === 'blocked' ? 'blocked' : tone === 'neutral' ? '' : 'active'}"></span>${esc(label || statusNames[status])}</span>`;
}
function renderSessions() {
  const query = $('#search').value.trim().toLowerCase(), host = $('#host-filter').value;
  const list = sessions.filter(s => (host === 'all' || host === s.host) && `${s.title} ${s.project}`.toLowerCase().includes(query));
  $('#session-count').textContent = list.length;
  $('#session-list').innerHTML = `<div class="day-label">Today</div>` + (list.length ? list.map(s => `<button class="session-item ${s.id === state.session ? 'selected' : ''}" data-session="${s.id}" aria-current="${s.id === state.session ? 'page' : 'false'}"><span class="session-title">${esc(s.title)}</span><span class="session-project">${hostMark(s.host)}${esc(s.project)}<span class="item-time">${s.age}</span></span><span class="session-status"><span class="status-dot ${s.state}"></span>${esc(s.stateLabel)}</span></button>`).join('') : '<p class="empty-search">No sessions match. Try a project name or another host.</p>');
}
function renderHeading() {
  const s = current(), snapshot = snapshots[state.snapshot];
  $('#project-crumb').textContent = state.direction === 'overview' ? 'Workspace' : s.project;
  if (state.direction === 'overview') {
    $('#session-heading').innerHTML = `<div class="heading-top"><h1>Your work, in view.</h1><span class="overview-date">Thursday, September 10</span></div><p class="heading-description">Pick up where you left off, or follow a session that’s still running.</p><div class="session-meta"><span><span class="status-dot active"></span>1 session working</span><span><span class="status-dot blocked"></span>1 design awaiting review</span><span>${icon('laptop')}Across 4 local projects</span></div>`;
    return;
  }
  const label = s.id === 'approval' || !s.tracked ? s.stateLabel : snapshot.label;
  const status = s.id === 'approval' ? 'blocked' : !s.tracked ? 'waiting' : state.snapshot === 5 ? 'complete' : state.snapshot === 3 ? 'failed' : 'active';
  $('#session-heading').innerHTML = `<div class="heading-top"><h1>${esc(s.title)}</h1>${pill(status,label)}</div><p class="heading-description">${esc(s.description)}</p><div class="session-meta"><span>${hostMark(s.host)}${hosts[s.host]}</span><span class="meta-divider"></span><span>${icon('branch')}${esc(s.branch)}</span><span>${icon('agents')}${s.agents} ${s.agents === 1 ? 'agent' : 'agents'}</span><span>${icon('clock')}${s.duration}</span><span>${icon(s.tracked ? 'flow' : 'activity')}${s.tracked ? 'Bug-fix playbook' : 'Conversation session'}</span></div>`;
}
function renderTabs() {
  if (state.direction === 'overview') {
    $('#tabs').innerHTML = [['all','All sessions'],['active','Working'],['blocked','Needs attention'],['complete','Completed']].map(([id,label]) => `<button class="tab ${state.overviewFilter === id ? 'active' : ''}" role="tab" aria-selected="${state.overviewFilter === id}" data-overview-filter="${id}">${label}</button>`).join('');
    $('#view-meta').innerHTML = 'Grouped by what needs your attention';
    return;
  }
  const s = current();
  const tabs = s.tracked ? [['workflow',state.direction === 'journey' ? 'Journey' : 'Workflow','flow'],['activity','Activity','activity'],['evidence','Evidence','file']] : [['activity','Activity','activity'],['evidence','Artifacts','file']];
  $('#tabs').innerHTML = tabs.map(([id,label,ico]) => `<button class="tab ${state.tab === id ? 'active' : ''}" role="tab" aria-selected="${state.tab === id}" data-tab="${id}">${icon(ico)}${label}${id === 'evidence' ? '<span class="count">3</span>' : ''}</button>`).join('');
  $('#view-meta').innerHTML = s.tracked ? `${icon('check')}<span>${s.id === 'approval' ? '2' : snapshots[state.snapshot].resolved} of 9 steps resolved</span>${!state.selected ? '<button data-open-details>Show details</button>' : ''}` : `${icon('activity')}2 turns · 42 recorded actions`;
}
function graphNode(p, child = false) {
  const status = nodeStatus(p.id), selected = state.selected === p.id;
  const stateIcon = status === 'done' ? icon('check') : status === 'skipped' ? icon('skip') : ['failed','blocked'].includes(status) ? icon('alert') : status === 'active' ? '<span class="status-dot active"></span>' : '';
  const attempt = p.id === 'verify' && current().id === 'retry' && state.snapshot >= 4 ? 'Attempt 2' : status === 'future' ? 'Waiting' : status === 'active' ? 'Working' : status === 'skipped' ? 'Within one function' : statusNames[status];
  return `<button class="graph-node ${status} ${selected ? 'selected' : ''}" data-node="${p.id}" aria-label="${esc(p.title)}: ${statusNames[status]}" style="left:${child ? p.id === 'how' ? 17 : 275 : p.x}px;${child ? '' : 'top:' + p.y + 'px'}"><div class="node-heading">${icon(p.icon)}${esc(p.title)}<span class="node-state">${stateIcon}</span></div><div class="node-meta">${child ? `<span>${p.model}</span>` : `<span class="node-number">${String(p.n).padStart(2,'0')}</span>`}<span>${child ? p.agent : attempt}</span><span>${status === 'future' ? '—' : status === 'skipped' ? '' : p.duration}</span></div></button>`;
}
function edge(from, to, path) {
  const a = nodeStatus(from), b = nodeStatus(to);
  const status = b === 'future' ? 'future' : ['done','skipped'].includes(a) ? 'completed' : '';
  return `<path class="edge ${status}" d="${path}" marker-end="url(#arrow-${status === 'completed' ? 'green' : 'grey'})"/>`;
}
function renderCanvas() {
  $('#main-view').innerHTML = `<div class="canvas-toolbar"><div class="canvas-title">${icon('flow')}The path through this task <span>· recorded steps</span></div><div class="canvas-tools"><button class="icon-button" id="zoom-out" title="Zoom out" aria-label="Zoom out">${icon('minus')}</button><button class="icon-button" id="zoom-label" title="Reset zoom">100%</button><button class="icon-button" id="zoom-in" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button><button class="icon-button" id="fit" title="Fit workflow" aria-label="Fit workflow">${icon('fit')}</button></div></div><div class="canvas" id="canvas" aria-label="Interactive workflow canvas"><div class="graph-space" id="graph-space"></div></div><div class="canvas-legend"><span><i class="legend-dot"></i>Completed</span><span><i class="legend-dot blue"></i>In progress</span><span><i class="legend-dot grey"></i>Skipped</span><span><i class="legend-dot hollow"></i>Not started</span><span class="hint">Drag to pan · click a step to inspect</span></div>${replayHTML()}`;
  paintGraph();
  requestAnimationFrame(fitGraph);
  $('#zoom-in').onclick = () => zoom(1.15);
  $('#zoom-out').onclick = () => zoom(1 / 1.15);
  $('#zoom-label').onclick = fitGraph;
  $('#fit').onclick = fitGraph;
  const canvas = $('#canvas');
  let drag;
  canvas.onpointerdown = event => {
    if (event.target.closest('button')) return;
    drag = {x:event.clientX,y:event.clientY,tx:state.tx,ty:state.ty};
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
  };
  canvas.onpointermove = event => { if (drag) {state.tx = drag.tx + event.clientX - drag.x; state.ty = drag.ty + event.clientY - drag.y; transformGraph();} };
  canvas.onpointerup = canvas.onpointercancel = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) {event.preventDefault(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08);} }, {passive:false});
  bindReplay();
}
function paintGraph() {
  if (!$('#graph-space')) return;
  const rootStatus = nodeStatus('root-cause'), returned = state.snapshot >= 3 && current().id === 'retry';
  $('#graph-space').innerHTML = `<svg class="connections" aria-hidden="true"><defs><marker id="arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10Z" fill="var(--green)"/></marker><marker id="arrow-grey" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10Z" fill="var(--muted)"/></marker><marker id="arrow-amber" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10Z" fill="var(--amber)"/></marker></defs>${edge('reproduce','root-cause','M225 122 H285')}${edge('root-cause','plan','M805 122 H865')}${edge('plan','implement','M960 166 V285')}${edge('implement','cleanup','M865 329 H775')}${edge('cleanup','review','M585 329 H495')}${edge('review','verify','M305 329 H225')}${edge('verify','commits','M130 373 V465')}${edge('commits','open-pr','M225 509 H305')}${returned ? '<path class="edge retry" d="M130 285 V245 Q130 231 145 231 H530 Q545 231 545 216" marker-end="url(#arrow-amber)"/>' : ''}</svg>${phases.filter(p => p.x !== undefined).map(p => graphNode(phase(p.id))).join('')}<div class="parallel-group"><button class="group-heading" data-node="root-cause">${icon('flow')}<span>02 &nbsp; Investigate the cause</span><span class="group-state">${rootStatus === 'done' ? 'Both investigations returned' : rootStatus === 'active' ? '2 agents working in parallel' : 'Not started'}</span></button>${graphNode(phase('how'),true)}${graphNode(phase('why'),true)}<div class="group-footer">${icon(rootStatus === 'done' ? 'check' : 'agents')}${rootStatus === 'done' ? 'Parent confirmed the mechanism with runtime evidence' : rootStatus === 'active' ? 'The parent will test both reports before continuing' : 'Independent investigations, followed by parent confirmation'}</div></div>${returned ? `<button class="edge-label" id="inspect-return">${icon('retry')}Returned to investigation · 1×</button>` : ''}<div class="phase-caption"><span class="eyebrow">${state.snapshot === 5 ? 'OUTCOME' : 'CURRENTLY'}</span><p>${esc(current().id === 'approval' ? 'The design is ready. Approval was explicitly requested before implementation.' : snapshots[state.snapshot].note)}</p></div>`;
  if ($('#inspect-return')) $('#inspect-return').onclick = () => selectNode('verify',1);
}
function fitGraph() {
  const canvas = $('#canvas'); if (!canvas) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  state.scale = Math.max(.35,Math.min((w - 24) / 1120,(h - 18) / 590,1.35));
  state.tx = (w - 1120 * state.scale) / 2; state.ty = (h - 590 * state.scale) / 2;
  transformGraph();
}
function transformGraph() { if ($('#graph-space')) $('#graph-space').style.transform = `translate(${state.tx}px,${state.ty}px) scale(${state.scale})`; if ($('#zoom-label')) $('#zoom-label').textContent = Math.round(state.scale * 100) + '%'; }
function zoom(factor) {
  const canvas = $('#canvas'); if (!canvas) return;
  const previous = state.scale, next = Math.max(.35,Math.min(2,previous * factor)), x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
  state.tx = x - (x - state.tx) * next / previous; state.ty = y - (y - state.ty) * next / previous; state.scale = next; transformGraph();
}
function replayHTML() {
  const disabled = current().id !== 'retry';
  return `<div class="replaybar"><button class="play-button" id="play" aria-label="${state.playing ? 'Pause replay' : 'Replay session'}" ${disabled ? 'disabled' : ''}>${icon(state.playing ? 'pause' : 'play')}</button><div class="replay-label">Replay the session<small>See how the work got here</small></div><div class="replay-track"><span class="replay-time">00:00</span><input id="replay" aria-label="Session replay position" type="range" min="0" max="${current().snapshot}" step="1" value="${state.snapshot}" ${disabled ? 'disabled' : ''}><span class="replay-time">${disabled ? current().duration : snapshots[state.snapshot].time}</span></div><span class="replay-now">${state.snapshot === current().snapshot ? 'Latest' : 'Replay'}</span></div>`;
}
function bindReplay() {
  $('#replay').oninput = event => {stopPlayback(); setSnapshot(Number(event.target.value));};
  $('#play').onclick = () => {
    if (state.playing) {stopPlayback(); renderContent();return;}
    state.playing = true;
    if (state.snapshot >= 4) setSnapshot(0);
    player = setInterval(() => { if (state.snapshot >= current().snapshot) {stopPlayback();renderContent();return;} setSnapshot(state.snapshot + 1); },1800);
    renderContent();
  };
}
function stopPlayback() {clearInterval(player);state.playing = false;}
function setSnapshot(value) {state.snapshot = value;state.selected = snapshots[value].current;state.attempt = value >= 4 ? 2 : 1;renderHeading();renderTabs();renderContent();}
function checkCard(title, command, result, detail = '') {
  return `<div class="check-card"><div class="check-label">${icon(result === 'Passed' ? 'check' : result === 'Failed' ? 'alert' : 'terminal')}${title}<span class="status-dot ${result === 'Passed' ? 'complete' : result === 'Running' ? 'active' : 'blocked'}"></span></div><code>${esc(command)}</code>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
}
function renderInspector() {
  const box = $('#inspector'), s = current();
  box.hidden = !state.selected || state.direction === 'overview';
  if (box.hidden) return;
  if (!s.tracked) {
    box.innerHTML = `<div class="inspector-top">Session context<button class="icon-button" data-close-details aria-label="Close details">${icon('close')}</button></div><div class="inspector-content"><div class="step-icon">${icon('activity')}</div><span class="eyebrow">CONVERSATION SESSION</span><h2>The task at a glance</h2><p class="inspector-desc">A design assessment followed by an implementation request. The next decision is how the frontend should work.</p><ul class="session-facts"><li><span>Original request</span>Show progress across Claude, Codex, and Copilot sessions.</li><li><span>Latest direction</span>Design the frontend before another implementation pass.</li><li><span>Source</span>${hosts[s.host]} · ${s.model}</li><li><span>Workflow tracking</span>No phase markers were recorded.</li></ul><button class="outline-button" data-tracking>${icon('info')}How phase tracking works</button><details class="raw-details"><summary>Session identifiers</summary><pre>Project: PSTACK\nHost: Codex\nSession: sample-viewer-session</pre></details></div><div class="source-note">${icon('info')}Sample summary for this design preview</div>`;
    return;
  }
  const p = phase(state.selected), hasRetry = s.id === 'retry' && p.id === 'verify' && state.snapshot >= 3;
  const previous = hasRetry && (state.attempt === 1 || state.snapshot === 3);
  const blocked = s.id === 'approval' && p.id === 'plan';
  const status = previous ? 'failed' : nodeStatus(p.id);
  const summary = blocked ? 'The proposed design adds a recoverable allocation state. You asked to review the design before implementation.' : previous ? 'The original reproduction passed, but two recovery checks failed in the full suite.' : stepSummary(p,status);
  const owner = p.agent || (p.id === 'implement' ? 'Implementation worker' : p.id === 'review' ? 'Operator reviewer' : 'Parent agent');
  let body = '';
  if (p.id === 'verify' && status !== 'future') {
    body = `<div class="detail-label">LINKED CHECKS <span>2 checks</span></div>${checkCard('Original reproduction',s.id === 'complete' ? 'pytest test_token_refresh.py' : 'pytest test_queue_retry.py','Passed','Passed · 0.28s')}${checkCard('Full test suite','pytest -q',previous ? 'Failed' : status === 'done' ? 'Passed' : 'Running',previous ? '2 failed, 131 passed · 4.02s' : s.id === 'complete' ? '84 passed · 3.12s' : status === 'done' ? '133 passed · 3.91s' : 'Waiting for the final result')}`;
    if (hasRetry) body += `<div class="retry-note"><div class="retry-title">${icon('retry')}${previous ? 'Why the workflow went back' : 'A second attempt, with context'}</div><p>The retry budget wasn’t reset after a successful upload. The parent returned to investigation and revised the fix.</p>${state.snapshot >= 4 ? `<button class="text-button" data-attempt="${previous ? 2 : 1}">${previous ? 'View current attempt' : 'Inspect the first attempt'}${icon('arrow')}</button>` : ''}</div>`;
  } else if (blocked) {
    body = `<div class="retry-note"><div class="retry-title">${icon('file')}Design ready for your review</div><p>Recover incomplete allocations using the existing transaction boundary. Add one explicit recovery state and a regression test.</p><button class="text-button" data-tab="evidence">Read the design note ${icon('arrow')}</button></div>`;
  } else if (status !== 'future') body = `<div class="detail-label">${status === 'skipped' ? 'RECORDED REASON' : 'RECORDED OUTCOME'}</div><p class="inspector-desc">${esc(stepOutcome(p,status))}</p>${status === 'done' && ['how','why','root-cause'].includes(p.id) ? checkCard(p.id === 'why' ? 'Regression history' : 'Investigation report',`evidence/${s.project}-${p.id}.md`,'Passed','Linked to this step') : ''}`;
  else body = '<p class="inspector-desc">This step has no recorded activity yet. Its outcome will appear when the work reaches it.</p>';
  box.innerHTML = `<div class="inspector-top">Step details<button class="icon-button" data-close-details aria-label="Close details">${icon('close')}</button></div><div class="inspector-content"><div class="step-icon ${status}">${icon(p.icon)}</div><span class="eyebrow">STEP ${String(p.n).padStart(2,'0')} ${['how','why'].includes(p.id) ? '· INVESTIGATION' : 'OF 09'}</span><h2>${blocked ? 'Review the proposed design' : p.title}</h2>${pill(status)}${hasRetry && state.snapshot >= 4 ? `<div><select class="attempt-switch" id="attempt-select" aria-label="Select verification attempt"><option value="2" ${!previous ? 'selected' : ''}>Attempt 2 · ${nodeStatus('verify') === 'done' ? 'Passed' : 'Current'}</option><option value="1" ${previous ? 'selected' : ''}>Attempt 1 · Failed</option></select></div>` : ''}<p class="inspector-desc">${esc(summary)}</p><dl class="detail-fields"><dt>Assigned to</dt><dd><span class="mini-avatar">${owner[0]}</span>${esc(owner)}</dd><dt>Model</dt><dd>${esc(p.model || s.model)}</dd><dt>Duration</dt><dd>${status === 'future' ? 'Not started' : previous ? '4.02s' : p.duration}</dd></dl>${body}<button class="outline-button" data-step-activity="${p.id}">${icon('activity')}View actions for this step ${icon('arrow')}</button><details class="raw-details"><summary>Show raw record</summary><pre>${esc(JSON.stringify({phase:p.id,attempt:hasRetry && !previous ? 2 : 1,state:status,source:'pstack phase record',sample:true},null,2))}</pre></details></div><div class="source-note">${icon('check')}Recorded step · sample session</div>`;
  if ($('#attempt-select')) $('#attempt-select').onchange = event => {state.attempt = Number(event.target.value);renderInspector();};
}
const toolsHTML = (label,rows,duration = '') => `<details class="tool-group"><summary>${icon('terminal')}${label}<span class="tool-duration">${duration}</span>${icon('down')}</summary>${rows.map(([command,result]) => `<div class="tool-row">${icon('check')}<code>${esc(command)}</code><small>${esc(result)}</small></div>`).join('')}</details>`;
function turnHTML(n,label,prompt,answer,tools,time) {
  return `<section class="turn"><div class="turn-label"><strong>Turn ${n}</strong><span>· ${label}</span><span class="line"></span></div><div class="prompt-card"><div class="speaker"><span class="avatar">R</span>You<time>${time}</time></div><p>${prompt}</p></div><div class="answer"><div class="speaker">${hostMark(current().host)}${hosts[current().host]}<time>${time}</time></div><p>${answer}</p>${tools || ''}</div></section>`;
}
function renderActivity() {
  const s = current(), filtered = state.activityFilter;
  let content;
  if (!s.tracked) {
    content = `<div class="tracking-banner">${icon('activity')}<div><strong>This session is a conversation.</strong><p>Prompts and actions are available. Workflow phases weren’t recorded.</p></div><button class="text-button" data-tracking>About tracking ${icon('arrow')}</button></div>`;
    content += turnHTML(1,'Explore the idea','Can we see how agent sessions progress through pstack? I want to follow what I prompted, what the agent did, and how it moved between phases.','The session logs can provide prompts and actions. pstack’s own records supply the workflow phases and the evidence behind them.',toolsHTML('Inspected the CLI, session readers, and run records', [['Read packaging/src/pstack_cli/observe/CONTRACT.md','Read'],['Inspect Claude and Codex session formats','Read'],['Read core/skills/poteto-mode/scripts/run-record.py','Read']],'12 actions'),'18:12');
    content += turnHTML(2,'Build the first version','Go.','Added explicit phase starts, parallel investigation steps, and a history of attempts. The observer can now show why verification returned to investigation.',toolsHTML('Updated the observer and checked the result',[['Update phase recorder and graph rendering','Edited'],['Run package tests','66 passed'],['Check the workflow in a browser','Passed']],'30 actions'),'18:22');
    content += `<div class="inline-event">${icon('clock')}Waiting for your next prompt<time>18:34</time></div>`;
  } else if (filtered) {
    const p = phase(filtered), isVerify = filtered === 'verify' && s.id === 'retry';
    content = `<div class="activity-filter"><span>Showing actions for <strong>${esc(p.title)}</strong></span><button class="text-button" data-clear-filter>Show all activity ${icon('close')}</button></div>`;
    if (nodeStatus(filtered) === 'future') content += '<p class="artifact-note">No actions have been recorded for this step.</p>';
    else content += turnHTML(1,isVerify ? 'First verification attempt' : p.title,isVerify ? 'Verify the fix against the original reproduction.' : `Continue with ${esc(p.title.toLowerCase())}.`,isVerify ? 'The original reproduction passes. Two checks in the full suite still fail: the retry budget is not reset after success.' : esc(stepOutcome(p,nodeStatus(filtered))),toolsHTML(isVerify ? '2 checks returned' : 'Recorded actions',isVerify ? [['pytest test_queue_retry.py','1 passed'],['pytest -q','2 failed, 131 passed']] : [[`Read evidence/${s.project}-${p.id}.md`,'Read']],'4.3s'),'18:28');
    if (isVerify && nodeStatus(filtered) !== 'future') content += `<div class="inline-event">${icon('retry')}Returned to investigation · retry budget does not reset on success<time>18:28</time></div>` + turnHTML(2,'Verification after the revised fix','Run the checks again.','The original reproduction passes on the revised code. The full suite is running.',toolsHTML('Current verification',[['pytest test_queue_retry.py','1 passed'],['pytest -q','Running']],'42s'),'18:32');
  } else if (s.id === 'approval') {
    content = turnHTML(1,'The original request','Fix allocation recovery after a crash. Show me the design before implementation.','The reproduction confirms a duplicate reservation after interruption. I’ll trace the transaction and recovery paths.',toolsHTML('Reproduced and investigated allocation recovery',[['pytest tests/test_allocation_recovery.py','1 failed'],['Inspect reservation ownership and recovery states','Read']],'5m 52s'),'17:42');
    content += turnHTML(2,'Proposed design','Keep the recovery behavior within the current transaction boundary.','The proposal adds an explicit recovery state and preserves reservation ownership. The design is ready for your review.',toolsHTML('Prepared the design',[['Write evidence/allocation-recovery.md','Recorded']],'6m 16s'),'17:48');
    content += `<div class="inline-event">${icon('file')}Waiting for the design review you requested<time>17:54</time></div>`;
  } else if (s.id === 'complete') {
    content = turnHTML(1,'The original request','Fix the refresh token race when concurrent requests refresh the same session.','The failing reproduction shows two independent rotations. I’ll share the pending refresh result across concurrent callers.',toolsHTML('Preserved the baseline',[['pytest tests/test_token_refresh.py','1 failed'],['Inspect token rotation and request coordination','Read']],'3m 24s'),'17:10');
    content += turnHTML(2,'Implementation and verification','Continue with the fix and verify recovery after a failed refresh.','Concurrent callers now share one token rotation. The reproduction and all 84 authentication checks passed.',toolsHTML('Verified and prepared the change',[['Update the refresh coordinator','Edited'],['pytest tests/auth -q','84 passed'],['Prepare pull request with verification evidence','Recorded']],'11m 08s'),'17:13');
    content += `<div class="inline-event">${icon('check')}All checks passed. The pull request is ready for review.<time>17:24</time></div>`;
  } else {
    content = turnHTML(1,'The original request',esc(s.id === 'retry' ? 'The upload queue retries forever when S3 returns 503. Fix the retry budget and backoff, keep the public API unchanged, and preserve a failing regression test.' : s.description),'I’ll reproduce the failure, investigate the cause, then make and verify a focused fix.',toolsHTML('Established the failing baseline',[['Read src/uploader/queue.py','Read'],['pytest tests/test_queue_retry.py','1 failed'],['Save original reproduction output','Recorded']],'1m 42s'),'18:14');
    content += `<div class="inline-event">${icon('agents')}How explorer and history investigator worked in parallel<time>18:16</time></div>`;
    content += turnHTML(2,'Investigation and implementation','Continue with the fix.','The attempt counter resets on each server error, so the queue never reaches its retry limit. The implementation now preserves the counter and resets the budget after success.',toolsHTML('Applied and reviewed the change',[['Update src/uploader/queue.py','Edited'],['ruff check src tests','Passed'],['Operator review','1 finding addressed']],'7m 35s'),'18:20');
    content += `<div class="inline-event">${icon('flask')}${esc(s.id === 'complete' ? 'All checks passed. The pull request is ready.' : s.id === 'approval' ? 'The proposed design is waiting for your review.' : 'Verification is running on the revised fix.')}<time>18:32</time></div>`;
  }
  $('#main-view').innerHTML = `<div class="content-scroll"><div class="content-inner"><div class="content-header"><h2>The conversation, with context.</h2><span>Prompts and recorded actions</span></div>${content}</div></div>`;
}
function renderEvidence() {
  const s = current();
  const items = !s.tracked ? [
    ['Session tracking design','Design assessment','docs/session-tracking.md','Recorded','Activity from host logs; workflow states from explicit phase records.'],
    ['Observer implementation','Changed artifact','observe/ui/index.html','Recorded','Phase starts, nested investigation, and attempt details.'],
    ['Validation results','Test output','package-tests.txt','Passed','66 passed\nBrowser checks passed']
  ] : s.id === 'approval' ? [
    ['Recovery design','Proposed change','evidence/allocation-recovery.md','Needs review','Add an explicit recoverable allocation state within the current transaction boundary.\n\nA crash after reservation must leave a state that the next attempt can recover.'],
    ['Failing baseline','Reproduction','evidence/allocation-repro.txt','Failed','A second allocation reserves the same address after interruption.'],
    ['Mechanism report','Investigation','evidence/recovery-mechanism.md','Recorded','The reservation is persisted before the allocation reaches a terminal state.']
  ] : s.id === 'complete' ? [
    ['Concurrent refresh reproduction','Baseline preserved before implementation','tests/test_token_refresh.py','Passed','pytest tests/test_token_refresh.py -q\n1 passed in 0.28s'],
    ['Authentication checks','Verification of the completed fix','evidence/auth-suite.txt','Passed','pytest tests/auth -q\n84 passed in 3.12s'],
    ['Pull request summary','Prepared for review','evidence/pull-request.md','Recorded','Concurrent callers share one token rotation. A failed refresh clears the pending operation.\n\nThe original reproduction and final verification are attached.']
  ] : [
    ['Original reproduction','Baseline preserved before implementation','tests/test_queue_retry.py','Passed','pytest tests/test_queue_retry.py -q\n1 passed in 0.28s'],
    ['First verification attempt','Returned to investigation','evidence/verify-attempt-1.txt','Failed','pytest -q\nFAILED test_resume_after_success\nFAILED test_long_lived_queue\n2 failed, 131 passed in 4.02s'],
    ['Final verification','Current code and original harness','evidence/verify-attempt-2.txt','Running','pytest -q\nRunning the full test suite…']
  ];
  $('#main-view').innerHTML = `<div class="content-scroll"><div class="content-inner"><div class="content-header"><h2>${s.tracked ? 'The evidence behind the work.' : 'Artifacts from this conversation.'}</h2><span>Full session · ${items.length} linked artifacts</span></div><div class="evidence-list">${items.map(([title,desc,path,status,output]) => `<article class="evidence-item"><span class="evidence-file">${icon('file')}</span><div><h3>${title}</h3><p>${desc}</p><code>${path}</code></div>${pill(status === 'Passed' ? 'complete' : status === 'Failed' || status === 'Needs review' ? 'blocked' : status === 'Running' ? 'active' : 'future',status)}<details><summary>Inspect artifact</summary><pre>${esc(output)}</pre></details></article>`).join('')}</div><p class="artifact-note">Each artifact stays connected to the step and attempt that produced it.</p></div></div>`;
}
function renderJourney() {
  const s = current(), stages = phases.filter(p => p.n !== 2 || p.id === 'root-cause').map(p => phase(p.id));
  $('#main-view').innerHTML = `<div class="content-scroll journey-scroll"><div class="content-inner"><div class="journey-intro"><span class="eyebrow">THE TASK JOURNEY</span><h2>From the first failure<br>to a verified fix.</h2><p>Each step carries its result, the people or agents involved, and the reason work moved forward.</p></div><div class="journey-list">${stages.map(p => {
    const status = nodeStatus(p.id);
    return `<article class="journey-step ${status}"><button class="journey-step-number" data-node="${p.id}" aria-label="Inspect ${p.title}">${status === 'done' ? icon('check') : String(p.n).padStart(2,'0')}</button><div class="journey-card"><div class="journey-card-top"><button data-node="${p.id}">${p.title}</button>${pill(status)}</div><p>${esc(stepOutcome(p,status))}</p>${p.id === 'root-cause' ? `<div class="journey-agents"><button data-node="how">${icon('search')}<span>How it works<small>Haiku · ${statusNames[nodeStatus('how')]}</small></span>${icon(nodeStatus('how') === 'done' ? 'check' : 'clock')}</button><button data-node="why">${icon('branch')}<span>Why it regressed<small>Sonnet · ${statusNames[nodeStatus('why')]}</small></span>${icon(nodeStatus('why') === 'done' ? 'check' : 'clock')}</button></div>` : ''}${s.id === 'retry' && p.id === 'verify' && state.snapshot >= 3 ? `<button class="journey-return" data-return>${icon('retry')}Attempt 1 returned to investigation <span>See why ${icon('arrow')}</span></button>` : ''}<div class="journey-card-footer"><span>${icon('clock')}${status === 'future' ? 'Not started' : p.duration}</span><button class="text-button" data-node="${p.id}">Inspect step ${icon('arrow')}</button></div></div></article>`;
  }).join('')}</div></div></div>${replayHTML()}`;
  bindReplay();
}
function renderOverview() {
  const list = sessions.filter(s => state.overviewFilter === 'all' || s.state === state.overviewFilter);
  const attention = sessions.find(s => s.id === 'approval');
  $('#main-view').innerHTML = `<div class="content-scroll overview-scroll"><div class="overview-inner"><div class="attention-card"><span class="attention-icon">${icon('file')}</span><div><span class="eyebrow">READY FOR YOUR REVIEW</span><h2>${attention.title}</h2><p>The recovery design is ready. Implementation is waiting for the approval you requested.</p><div>${hostMark(attention.host)}<span>${attention.project}</span><span>·</span><span>12 minutes of work</span></div></div><button class="primary-button" data-session="approval">Review the design ${icon('arrow')}</button></div><div class="overview-section-heading"><h2>${state.overviewFilter === 'all' ? 'Recent sessions' : state.overviewFilter === 'active' ? 'Work in progress' : state.overviewFilter === 'complete' ? 'Completed work' : 'Needs attention'}</h2><span>${list.length} sessions</span></div><div class="session-cards">${list.map(s => `<button class="overview-session-card" data-session="${s.id}"><div class="overview-card-top">${hostMark(s.host)}<span>${hosts[s.host]}</span><span>${s.age}</span></div><h3>${s.title}</h3><p>${s.description}</p><div class="overview-card-status">${pill(s.state,s.stateLabel)}</div><div class="overview-progress">${Array.from({length:9},(_,i) => `<i class="${s.id === 'complete' ? 'done' : s.id === 'retry' ? i < 6 ? 'done' : i === 6 ? 'active' : '' : s.id === 'approval' ? i < 2 ? 'done' : i === 2 ? 'blocked' : '' : 'conversation'}"></i>`).join('')}</div><div class="overview-card-footer"><span>${s.project}</span><span>${s.tracked ? s.id === 'complete' ? '9 steps resolved' : s.id === 'retry' ? '6 of 9 steps resolved' : '2 of 9 steps resolved' : 'Conversation · no phase data'}</span>${icon('arrow')}</div></button>`).join('')}</div><div class="overview-footnote">${icon('laptop')}One workspace across Claude, Codex, and Copilot. This preview uses sample sessions.</div></div></div>`;
}
function renderContent() {
  if (resizeObserver) resizeObserver.disconnect();
  if (state.direction === 'overview') renderOverview();
  else if (state.tab === 'activity') renderActivity();
  else if (state.tab === 'evidence') renderEvidence();
  else if (state.direction === 'journey') renderJourney();
  else renderCanvas();
  renderInspector();
  if ($('#canvas')) { resizeObserver = new ResizeObserver(() => requestAnimationFrame(fitGraph));resizeObserver.observe($('#canvas')); }
}
function render() {renderSessions();renderHeading();renderTabs();renderContent();}
function selectSession(id) {
  const s = sessions.find(s => s.id === id);if (!s) return;
  stopPlayback();state.session = id;state.snapshot = s.snapshot ?? 4;state.tab = s.tracked ? 'workflow' : 'activity';state.selected = s.tracked ? id === 'approval' ? 'plan' : id === 'complete' ? 'open-pr' : 'verify' : 'session';state.attempt = 2;state.activityFilter = null;
  if (state.direction === 'overview') {state.direction = 'canvas';$('#direction').value = 'canvas';}
  history.replaceState(null,'',`#session=${id}&direction=${state.direction}`);$('.app').classList.remove('show-sessions');render();
}
function selectNode(id,attempt = 2) {state.selected = id;state.attempt = attempt;renderTabs();renderInspector();paintGraph();}
function showToast(message) {clearTimeout(toastTimer);$('#toast').textContent = message;$('#toast').classList.add('visible');toastTimer = setTimeout(() => $('#toast').classList.remove('visible'),3500);}
document.addEventListener('click', event => {
  const target = event.target.closest('button');if (!target) return;
  if (target.dataset.session) selectSession(target.dataset.session);
  else if (target.dataset.node) selectNode(target.dataset.node);
  else if (target.dataset.tab) {stopPlayback();state.tab = target.dataset.tab;state.activityFilter = null;renderTabs();renderContent();}
  else if (target.hasAttribute('data-close-details')) {state.selected = null;renderTabs();renderInspector();paintGraph();}
  else if (target.hasAttribute('data-open-details')) {state.selected = current().tracked ? current().id === 'approval' ? 'plan' : snapshots[state.snapshot].current : 'session';renderTabs();renderInspector();}
  else if (target.dataset.attempt) {state.attempt = Number(target.dataset.attempt);renderInspector();}
  else if (target.dataset.stepActivity) {state.activityFilter = target.dataset.stepActivity;state.tab = 'activity';renderTabs();renderContent();}
  else if (target.hasAttribute('data-clear-filter')) {state.activityFilter = null;renderActivity();}
  else if (target.hasAttribute('data-tracking')) {$('#about').showModal();}
  else if (target.hasAttribute('data-return')) {selectNode('verify',1);}
  else if (target.dataset.overviewFilter) {state.overviewFilter = target.dataset.overviewFilter;renderTabs();renderOverview();}
});
$('#search').oninput = renderSessions;$('#host-filter').onchange = renderSessions;
$('#menu').onclick = () => $('.app').classList.toggle('show-sessions');
$('#theme').onclick = () => {const dark = document.documentElement.dataset.theme !== 'dark';document.documentElement.dataset.theme = dark ? 'dark' : 'light';$('#theme').innerHTML = icon(dark ? 'sun' : 'moon');$('#theme').setAttribute('aria-label',`Switch to ${dark ? 'light' : 'dark'} theme`);};
$('#design-note').onclick = () => $('#about').showModal();$('#close-about').onclick = () => $('#about').close();
$('#direction').onchange = event => {stopPlayback();state.direction = event.target.value;state.selected = state.direction === 'canvas' ? current().tracked ? current().id === 'approval' ? 'plan' : snapshots[state.snapshot].current : 'session' : null;state.tab = current().tracked ? 'workflow' : 'activity';history.replaceState(null,'',`#session=${state.session}&direction=${state.direction}`);render();};
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) {event.preventDefault();$('#search').focus();$('.app').classList.add('show-sessions');}
  if (event.key === 'Escape') {state.selected = null;$('.app').classList.remove('show-sessions');renderTabs();renderInspector();paintGraph();}
});
function openLocation() {
  stopPlayback();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (['canvas','journey','overview'].includes(hash.get('direction'))) state.direction = hash.get('direction');
  if (sessions.some(s => s.id === hash.get('session'))) state.session = hash.get('session');
  const s = current();
  state.snapshot = s.snapshot ?? 4;
  state.tab = s.tracked ? 'workflow' : 'activity';
  state.attempt = 2;
  state.activityFilter = null;
  state.selected = state.direction !== 'canvas' ? null : !s.tracked ? 'session' : s.id === 'approval' ? 'plan' : s.id === 'complete' ? 'open-pr' : 'verify';
  $('#direction').value = state.direction;
  render();
}
window.addEventListener('hashchange', openLocation);
openLocation();
