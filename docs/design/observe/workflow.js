'use strict';
const $ = selector => document.querySelector(selector);
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const NS = 'http://www.w3.org/2000/svg';
const nodes = [
  {id:'A', x:535,y:45,w:350,h:90, title:'poteto-mode + request', subtitle:['The original user prompt'], icon:'play', kicker:'ENTRY'},
  {id:'B', x:500,y:205,w:420,h:105, title:'Resolve host and models', subtitle:['Read principles index','and relevant leaves'], icon:'users', kicker:'CONTEXT'},
  {id:'C', x:585,y:385,w:250,h:150, title:'Match intent', subtitle:['and existing state'], type:'decision'},
  {id:'O', x:1030,y:413,w:360,h:98, title:'Other playbook', subtitle:['or figure-it-out'], icon:'branch', kicker:'OTHER TASK'},
  {id:'D', x:515,y:610,w:390,h:92, title:'Bug fix: six steps', subtitle:['Plus applicable gates'], icon:'flow', kicker:'SELECTED PLAYBOOK'},
  {id:'R', x:510,y:780,w:400,h:100, title:'Reproduce', subtitle:['Preserve the failing baseline'], icon:'code', kicker:'01 · REPRODUCTION'},
  {id:'H', x:270,y:995,w:360,h:122, title:'how', subtitle:['Simple: one explainer','Complex: explorers → explainer'], icon:'search', kicker:'02 · MECHANISM'},
  {id:'W', x:790,y:995,w:360,h:122, title:'why', subtitle:['Available-source investigators','then synthesizer'], icon:'branch', kicker:'02 · HISTORY'},
  {id:'M', x:480,y:1250,w:460,h:112, title:'Parent tests hypotheses', subtitle:['Confirms mechanism with runtime evidence'], icon:'target', kicker:'02 · CONFIRMATION'},
  {id:'T', x:500,y:1460,w:420,h:108, title:'Premise census', subtitle:['If triggered · throughput checkpoint'], icon:'check', kicker:'APPLICABLE GATES'},
  {id:'X', x:570,y:1660,w:280,h:164, title:'Crosses a', subtitle:['function boundary?'], type:'decision', kicker:'03 · DESIGN'},
  {id:'AR', x:940,y:1930,w:385,h:104, title:'Architect A: ground', subtitle:['Calls how again; sometimes why'], icon:'search', kicker:'03 · ARCHITECT'},
  {id:'AB', x:940,y:2110,w:385,h:120, title:'Architect B: Arena of sketches', subtitle:['Rubric, candidates, judge,','parent comparison and synthesis'], icon:'users', kicker:'03 · ARCHITECT'},
  {id:'AC', x:940,y:2310,w:385,h:102, title:'Architect C', subtitle:['Approval only if requested'], icon:'check', kicker:'03 · ARCHITECT'},
  {id:'I', x:460,y:2530,w:500,h:104, title:'Delegate one implementation', subtitle:['Against the selected design'], icon:'code', kicker:'03 · IMPLEMENTATION'},
  {id:'N', x:485,y:2710,w:450,h:96, title:'Code cleanup and no-comments', subtitle:[], icon:'check', kicker:'03 · CLEANUP'},
  {id:'V', x:485,y:2880,w:450,h:104, title:'Parent reviews diff', subtitle:['Interrogate when triggered'], icon:'users', kicker:'03 · REVIEW'},
  {id:'P', x:485,y:3060,w:450,h:104, title:'Verify final artifact', subtitle:['Against the original reproduction'], icon:'code', kicker:'04 · VERIFICATION'},
  {id:'K', x:465,y:3250,w:490,h:122, title:'Order reproduction commit before fix', subtitle:['Technical-writing and unslop'], icon:'branch', kicker:'05 · COMMITS'},
  {id:'PR', x:530,y:3450,w:360,h:94, title:'Opening a PR', subtitle:[], icon:'arrow', kicker:'06 · PULL REQUEST'},
  {id:'F', x:450,y:3650,w:520,h:120, title:'Evidence-bearing final response', subtitle:['Checklist, skips, owner, model and tier'], icon:'file', kicker:'OUTCOME'}
];
const byId = Object.fromEntries(nodes.map(node => [node.id,node]));
const edges = [
  {from:'A',to:'B'}, {from:'B',to:'C'},
  {from:'C',to:'O',label:'Other task',side:true}, {from:'C',to:'D',label:'Live defect'},
  {from:'D',to:'R'}, {from:'R',to:'H',branch:true}, {from:'R',to:'W',branch:true},
  {from:'H',to:'M',join:true}, {from:'W',to:'M',join:true}, {from:'M',to:'T'}, {from:'T',to:'X'},
  {from:'X',to:'AR',label:'Yes',side:true}, {from:'AR',to:'AB'}, {from:'AB',to:'AC'},
  {from:'AC',to:'I',join:true}, {from:'X',to:'I',label:'No',bypass:true},
  {from:'I',to:'N'}, {from:'N',to:'V'},
  {from:'N',to:'AR',label:'Accepted correction needs design',back:true,lane:1410},
  {from:'V',to:'I',label:'Accepted findings require edits',back:true,lane:340},
  {from:'V',to:'P'}, {from:'P',to:'M',label:'Failure or inconclusive',back:true,lane:170},
  {from:'P',to:'K'}, {from:'K',to:'PR'},
  {from:'PR',to:'P',label:'Preparation changes code',back:true,lane:1150},
  {from:'PR',to:'F'}
];
const WIDTH=1480, HEIGHT=3850;
const phases = [
  {id:'R',label:'Reproduce',sub:'Failing baseline',nodes:['R']},
  {id:'M',label:'Investigate',sub:'how · why · confirmation',nodes:['H','W','M']},
  {id:'AB',label:'Design & implement',sub:'Decide · build · review',nodes:['X','AR','AB','AC','I','N','V']},
  {id:'P',label:'Verify',sub:'Original reproduction',nodes:['P']},
  {id:'K',label:'Order commits',sub:'Reproduction before fix',nodes:['K']},
  {id:'PR',label:'Open PR',sub:'Prepare for review',nodes:['PR']}
];
const snapshots = [
  {name:'Request received',current:'A',time:'00:00',at:'14:10:00',done:[],active:['A'],note:'A request enters poteto-mode.',event:'Original prompt received',reason:'Resolve the host, models, and relevant principles next.'},
  {name:'Investigating in parallel',current:'M',time:'05:42',at:'14:15:42',done:['A','B','C','D','R'],active:['H','W'],note:'how and why run in parallel, then join at the parent.',event:'Two investigations started',reason:'Mechanism and history are being examined independently.'},
  {name:'Comparing designs',current:'AB',time:'10:18',at:'14:20:18',done:['A','B','C','D','R','H','W','M','T','X','AR'],active:['AB'],note:'The “Yes” branch enters Architect A → B → C.',event:'Architect A → Architect B',reason:'Compare candidate sketches against the grounded rubric.'},
  {name:'Verifying the fix',current:'P',time:'19:24',at:'14:29:24',done:['A','B','C','D','R','H','W','M','T','X','AR','AB','I','N','V'],active:['P'],skip:['AC'],note:'Verification uses the preserved original reproduction.',event:'Review → Verify',reason:'The final artifact is ready to test against the failing baseline.'},
  {name:'Investigating again',current:'M',time:'22:08',at:'14:32:08',done:['A','B','C','D','R','H','W','T','X','AR','AB','I','N','V'],active:['M'],failed:['P'],skip:['AC'],note:'Verification failed. The workflow returns to confirmation.',event:'Verify → Parent tests hypotheses',reason:'Recovery after a successful upload still fails. Revisit the mechanism.'},
  {name:'Workflow complete',current:'F',time:'29:31',at:'14:39:31',done:['A','B','C','D','R','H','W','M','T','X','AR','AB','I','N','V','P','K','PR','F'],active:[],skip:['AC'],note:'The completed path includes its failed attempt and return.',event:'PR prepared → Final response',reason:'Reproduction, verification, ordered commits, and the final evidence are available.'}
];
const details = {
  A:{summary:'The original request stays attached to the workflow, so every result can be read against what the user actually asked.',owner:'Parent',evidence:'Original prompt',output:'“Uploads keep retrying after the budget is exhausted. Preserve a reproduction and fix both the budget and recovery after success.”'},
  B:{summary:'Resolve the session host and model configuration, then load the principles index and the relevant leaves.',owner:'Parent',output:'The sample run uses Codex with a configured parent model and bounded investigation delegates.'},
  C:{summary:'Match the request and existing project state to the appropriate playbook. Both possible branches remain visible.',owner:'Parent',output:'Sample decision: a live defect with a reproducible failure → Bug fix.'},
  O:{summary:'Requests that do not match a live defect continue to another playbook or figure-it-out. This alternative stays visible without appearing completed.',owner:'Parent',output:'Not taken in this sample. Another task would continue along this branch.'},
  D:{summary:'Enter the six-step bug-fix workflow, including the gates that apply to this request.',owner:'Parent',output:'Reproduce → investigate → design and implement → verify → order commits → open PR.'},
  R:{summary:'Capture the failure before changing implementation. Keep the original test and output for the final verification.',owner:'Parent',command:'pytest tests/test_retry.py -k budget',output:'The failing baseline made 17 attempts against a budget of 5.',evidence:'Preserved failing baseline'},
  H:{summary:'Explain the runtime mechanism. A simple issue uses one explainer; a complex issue uses explorers followed by an explainer.',owner:'Mechanism explorer → explainer',command:'inspect RetryQueue.schedule()',output:'The attempt counter resets after an upstream 503, so the retry budget cannot be exhausted.',evidence:'Mechanism explanation'},
  W:{summary:'Investigate the available history and sources, then synthesize why this behavior exists.',owner:'History investigator → synthesizer',command:'git log -p -- queue/retry.py',output:'A recovery change reset both backoff and the attempt counter on every server error.',evidence:'History and source findings'},
  M:{summary:'The parent tests the hypotheses from how and why. Runtime evidence must explain the failure before implementation continues.',owner:'Parent',command:'pytest tests/test_retry.py -k recovery',output:'The first explanation covered exhaustion, but missed resetting the budget after a successful upload.',evidence:'Original reproduction · recovery'},
  T:{summary:'Check the premises when triggered, then establish the throughput checkpoint before choosing the implementation path.',owner:'Parent',output:'Sample premises: the configured retry budget is authoritative; a successful upload begins a new retry lifecycle.'},
  X:{summary:'The function boundary decision controls whether the workflow enters Architect or proceeds to implementation.',owner:'Parent',output:'Sample decision: Yes. Recovery state crosses the scheduling and completion functions.'},
  AR:{summary:'Ground the design in the existing system. Call how again and, when needed, why.',owner:'Architect · grounding',output:'Trace ownership of the retry state across scheduling and completion before proposing sketches.'},
  AB:{summary:'Compare sketches with a rubric. Candidates, a judge, and the parent’s comparison and synthesis produce the selected design.',owner:'Architect · parent + candidates',output:'Selected sample design: keep one retry state owner and reset its budget only after a successful upload.',evidence:'Sketch comparison',command:'rubric: ownership · recovery · API impact'},
  AC:{summary:'Seek design approval only when the user requested that approval. A recorded skip should explain when this gate does not apply.',owner:'Parent',output:'Sample skip: the user did not request a design approval gate.'},
  I:{summary:'Delegate one implementation against the selected design. Keep the owner, design, and returned result attached to this step.',owner:'Implementation delegate',output:'Apply the selected retry lifecycle design, then return the diff and checks to the parent.'},
  N:{summary:'Clean up the changed code and apply no-comments. An accepted correction that needs design returns to Architect A.',owner:'Parent',output:'Review the final code for redundant structure, unnecessary comments, and divergence from the selected design.'},
  V:{summary:'Review the diff. Use interrogate when triggered; accepted findings that need edits return to implementation.',owner:'Parent · reviewer',output:'The review checks the changed ownership and failure recovery paths against the selected design.'},
  P:{summary:'Verify the final artifact against the original reproduction. Failure or inconclusive results return to runtime confirmation.',owner:'Parent',command:'pytest tests/test_retry.py',output:'2 failed, 16 passed. Recovery did not reset the budget after a successful upload.',evidence:'Verification attempt 1'},
  K:{summary:'Order the reproduction commit before the fix. Apply technical-writing and unslop to the commit messages.',owner:'Parent',output:'The failing baseline must be independently reproducible before the fix commit is applied.'},
  PR:{summary:'Prepare and open the PR. If preparation changes code, return to verification before continuing.',owner:'Parent',output:'Include the problem, final behavior, and verification evidence in the PR.'},
  F:{summary:'Return the evidence-bearing outcome to the user, including the checklist, skips, owner, model, and tier.',owner:'Parent',output:'The original reproduction passes; recovery after success passes; the reproduction commit precedes the fix. The requested workflow is complete.'}
};
const state = {snapshot:4,selected:'M',tab:'summary',attempt:2,scale:.8,x:0,y:0,mode:'focus',focusId:'M',playing:false,timer:null,session:'retry'};
const snapshot = () => snapshots[state.snapshot];
function nodeState(id) {
  if(id==='O')return 'other';
  const s=snapshot();
  return s.active.includes(id)?'active':(s.failed||[]).includes(id)?'failed':(s.skip||[]).includes(id)?'skipped':s.done.includes(id)?'done':'planned';
}
const statusNames={done:'Completed',active:'In progress',failed:'Failed',skipped:'Skipped · not requested',planned:'Not reached',other:'Other route'};
const cx = node => node.x+node.w/2;
const cy = node => node.y+node.h/2;
function edgeTaken(edge) {
  if(edge.to==='O'||edge.bypass)return false;
  if(edge.back)return edge.from==='P'&&edge.to==='M'&&state.snapshot>=4;
  return ['done','active','failed','skipped'].includes(nodeState(edge.from))&&['done','active','failed','skipped'].includes(nodeState(edge.to));
}
function edgePath(edge) {
  const a=byId[edge.from],b=byId[edge.to];
  if(edge.back){
    const right=edge.lane>1000,ax=right?a.x+a.w:a.x,bx=right?b.x+b.w:b.x,lane=edge.lane,ay=cy(a),by=cy(b),r=16;
    const sign=right?1:-1;
    return `M ${ax} ${ay} H ${lane-sign*r} Q ${lane} ${ay} ${lane} ${ay-r} V ${by+r} Q ${lane} ${by} ${lane-sign*r} ${by} H ${bx}`;
  }
  if(edge.bypass)return `M ${cx(a)} ${a.y+a.h} V ${b.y-45} Q ${cx(a)} ${b.y-25} ${cx(b)} ${b.y-25} V ${b.y}`;
  if(edge.side){
    if(edge.to==='O')return `M ${a.x+a.w} ${cy(a)} H ${b.x}`;
    return `M ${a.x+a.w} ${cy(a)} H ${cx(b)-16} Q ${cx(b)} ${cy(a)} ${cx(b)} ${cy(a)+16} V ${b.y}`;
  }
  const ay=a.y+a.h,by=b.y,mid=ay+(by-ay)/2;
  if(cx(a)===cx(b))return `M ${cx(a)} ${ay} V ${by}`;
  return `M ${cx(a)} ${ay} C ${cx(a)} ${mid} ${cx(b)} ${mid} ${cx(b)} ${by}`;
}
function edgeLabel(edge) {
  if(!edge.label)return '';
  const a=byId[edge.from],b=byId[edge.to];
  let x,y;
  if(edge.back){
    x=edge.lane;y=(cy(a)+cy(b))/2;
    if(edge.from==='P'){x=170;y=cy(b)+90;}
    if(edge.from==='N'){x=1410;y=2220;}
    if(edge.from==='V'){x=340;y=2675;}
    if(edge.from==='PR'){x=1150;y=3270;}
    const width=edge.label.length*5.8+20;
    return `<g class="edge-label" transform="translate(${x},${y}) rotate(-90)"><rect x="${-width/2}" y="-11" width="${width}" height="22" rx="5"/><text text-anchor="middle" y="4">${escapeText(edge.label)}</text></g>`;
  }
  if(edge.side){x=(a.x+a.w+(edge.to==='O'?b.x:cx(b)))/2;y=cy(a);}
  else if(edge.bypass){x=cx(a);y=1940;}
  else{x=cx(a);y=(a.y+a.h+b.y)/2;}
  const width=edge.label.length*6+18;
  return `<g class="edge-label branch-label" transform="translate(${x},${y})"><rect x="${-width/2}" y="-11" width="${width}" height="22" rx="5"/><text text-anchor="middle" y="4">${escapeText(edge.label)}</text></g>`;
}
function nodeMarkup(n) {
  const status=nodeState(n.id),selected=n.id===state.selected;
  const description=`${n.kicker||'Decision'}: ${n.title}. ${n.subtitle.join('. ')}. ${statusNames[status]}`;
  let content;
  if(n.type==='decision'){
    content=`<path class="node-body" d="M ${n.w/2} 0 L ${n.w} ${n.h/2} L ${n.w/2} ${n.h} L 0 ${n.h/2} Z"/>
      <text class="node-kicker" text-anchor="middle" x="${n.w/2}" y="${n.h/2-30}">${n.kicker||'ROUTING'}</text>
      <text class="decision-text" text-anchor="middle" x="${n.w/2}" y="${n.h/2-6}">${escapeText(n.title)}</text>
      <text class="decision-text" text-anchor="middle" x="${n.w/2}" y="${n.h/2+15}">${escapeText(n.subtitle[0])}</text>`;
  }else{
    const textY=n.subtitle.length>1?51:53;
    const attempt=n.id==='M'&&state.snapshot>=4?2:n.id==='P'&&state.snapshot===5?2:1;
    content=`<rect class="node-body" width="${n.w}" height="${n.h}" rx="12"/>
      <rect class="node-icon-bg" x="16" y="21" width="29" height="29" rx="7"/>
      <svg class="node-icon" x="23" y="28" width="15" height="15"><use href="#icon-${n.icon}"/></svg>
      <text class="node-kicker" x="59" y="28">${escapeText(n.kicker)}</text>
      <text class="node-label" x="59" y="${textY}">${escapeText(n.title)}</text>
      ${n.subtitle.map((line,i)=>`<text class="node-subtitle" x="59" y="${textY+22+i*18}">${escapeText(line)}</text>`).join('')}
      <circle class="state-dot" cx="${n.w-17}" cy="25" r="3"/>
      <text class="node-status" text-anchor="end" x="${n.w-17}" y="${n.h-12}">${escapeText(statusNames[status])}</text>
      ${attempt>1?`<rect class="attempt-tag" x="${n.w-93}" y="12" width="62" height="21" rx="5"/><text class="attempt-text" x="${n.w-86}" y="26">Attempt ${attempt}</text>`:''}`;
  }
  content+=`<circle class="port" cx="${n.w/2}" cy="0" r="3"/><circle class="port" cx="${n.w/2}" cy="${n.h}" r="3"/>`;
  return `<g class="node ${status} ${selected?'selected':''}" data-node="${n.id}" data-state="${status}" transform="translate(${n.x},${n.y})" role="button" tabindex="0" aria-label="${escapeText(description)}" aria-pressed="${selected}"><title>${escapeText(description)}</title>${content}</g>`;
}
function renderGraph() {
  const defs=`<defs><filter id="node-shadow" x="-15%" y="-30%" width="130%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#263959" flood-opacity=".035"/></filter><filter id="active-shadow" x="-15%" y="-30%" width="130%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="8" flood-color="#4f67ed" flood-opacity=".09"/></filter>${[['future','#bfc9d9'],['taken','#82af9e'],['return','#b88744']].map(([id,color])=>`<marker id="arrow-${id}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8Z" fill="${color}"/></marker>`).join('')}</defs>`;
  const groups=`<rect class="graph-group" x="235" y="940" width="950" height="465" rx="20"/><text class="group-heading" x="258" y="965">02 / PARALLEL INVESTIGATION → PARENT CONFIRMATION</text><rect class="graph-group architect" x="909" y="1878" width="448" height="580" rx="20"/><text class="group-heading architect" x="934" y="1903">ARCHITECT / WHEN A FUNCTION BOUNDARY IS CROSSED</text>`;
  const lines=edges.map(edge=>{const taken=edgeTaken(edge);return `<path class="workflow-edge ${edge.back?'return ':''}${taken?'taken':'future'}" data-from="${edge.from}" data-to="${edge.to}" d="${edgePath(edge)}" marker-end="url(#arrow-${edge.back?'return':taken?'taken':'future'})"><title>${escapeText(edge.label||`${byId[edge.from].title} → ${byId[edge.to].title}`)}</title></path>`;}).join('');
  $('#graph').setAttribute('viewBox',`0 0 ${WIDTH} ${HEIGHT}`);
  $('#graph').style.width=WIDTH+'px';$('#graph').style.height=HEIGHT+'px';
  $('#graph').innerHTML=defs+groups+lines+edges.map(edgeLabel).join('')+nodes.map(nodeMarkup).join('');
  updateTransform();
}
function renderNav() {
  const s=snapshot();
  $('#phase-nav').innerHTML=phases.map((p,i)=>{
    let status=p.nodes.some(id=>(s.failed||[]).includes(id))?'failed':p.nodes.some(id=>s.active.includes(id))?'active':p.nodes.every(id=>s.done.includes(id)||(s.skip||[]).includes(id))?'done':'planned';
    return `<button class="phase-link ${status}" data-focus="${p.id}"><span class="phase-number">${status==='done'?icon('check'):i+1}</span><span>${p.label}<small>${status==='failed'?'Failed · returned to step 2':status==='active'&&state.snapshot===4?'Attempt 2 · confirming mechanism':p.sub}</small></span></button>`;
  }).join('');
}
function renderInspector() {
  const n=byId[state.selected],d=details[n.id],status=nodeState(n.id),revisited=['M','P'].includes(n.id)&&state.snapshot>=4;
  const tabs=['summary','activity','record'];
  let content='';
  if(state.tab==='summary'){
    content=`<h3>Assigned to</h3><div class="owner"><span class="avatar">${['H','W','AR','AB','I'].includes(n.id)?'↗':'⌘'}</span><div><b>${escapeText(d.owner)}</b><small>${['H','W','AR','AB','I'].includes(n.id)?'Delegated work · sample assignment':'Configured parent model'}</small></div><span>${status==='active'?'Working':status==='done'?'Finished':'Sample'}</span></div>`;
    if(revisited)content+=`<h3>Attempts</h3><div class="attempts"><button data-attempt="1" class="${state.attempt===1?'selected':''}">Attempt 1</button>${n.id==='M'||state.snapshot===5?`<button data-attempt="2" class="${state.attempt===2?'selected':''}">Attempt 2</button>`:''}</div>`;
    if(n.id==='M'&&state.snapshot>=4)content+=`<div class="return-callout"><b>${icon('return')}Returned from verification</b>Two recovery checks failed. The parent revisits the mechanism before another implementation attempt.</div>`;
    if(n.id==='P'&&state.snapshot>=4)content+=`<div class="return-callout"><b>${icon('return')}Return to runtime confirmation</b>Failure or inconclusive evidence returns to the parent’s hypothesis check.</div>`;
    if(n.id==='A')content+=`<h3>Original prompt</h3><p class="original-prompt">${escapeText(d.output)}</p>`;
    else{
      const output=revisited&&state.attempt===2&&state.snapshot===5?'The retry budget and recovery after success both pass the original reproduction.':d.output;
      content+=`<h3>${status==='planned'?'Expected outcome':n.id==='M'&&state.attempt===1?'First hypothesis':'What happened'}</h3><p class="detail-prose">${escapeText(output)}</p>`;
    }
    if(d.evidence&&status!=='planned')content+=`<h3>Evidence</h3><div class="evidence-card"><div>${icon('file')}${escapeText(d.evidence)}<span class="${state.snapshot===5&&n.id!=='R'?'success':''}">${n.id==='R'?'BASELINE':state.snapshot===5?'PASS':n.id==='M'||n.id==='P'?'FAIL':'FOUND'}</span></div><code>${escapeText(d.command||'Preserved user request')}</code></div>`;
    content+=`<p class="detail-note">Illustrative sample. In the live viewer, status, assignments, evidence, and transitions must come from explicit records. Missing records stay unrecorded.</p>`;
  }else if(state.tab==='activity'){
    content=`<h3>Activity attached to this step</h3><div class="detail-activity"><small>14:10:00 · USER PROMPT</small>“Uploads keep retrying after the budget is exhausted. Preserve a reproduction and fix recovery after success.”</div><div class="detail-activity"><small>${snapshot().at} · ${escapeText(d.owner.toUpperCase())}</small><b>${escapeText(n.title)}</b><br>${escapeText(d.output)}</div>${d.command?`<div class="detail-activity"><small>SAMPLE TOOL CALL</small><code>${escapeText(d.command)}</code></div>`:''}<p class="detail-note">The production view should link actions through recorded phase and tool identifiers. It must not guess a phase from a tool’s name.</p>`;
  }else{
    content=`<h3>Workflow definition</h3><pre>${escapeText(JSON.stringify({node:n.id,label:n.title,description:n.subtitle,diagram:'User-provided bug-fix flowchart',outgoing:edges.filter(e=>e.from===n.id).map(e=>({to:e.to,condition:e.label||null,return:!!e.back}))},null,2))}</pre><p class="detail-note">This defines the route. Sample activity is a separate overlay; a route definition is not evidence that a step ran.</p>`;
  }
  $('#inspector').innerHTML=`<div class="inspector-top">STEP DETAILS<button id="close-inspector" class="icon-button" aria-label="Close step details">${icon('close')}</button></div><div class="inspector-intro"><div class="inspector-kicker">${escapeText(n.kicker||'WORKFLOW DECISION')}</div><h2>${escapeText(n.title)}</h2><span class="detail-status ${status}">${escapeText(statusNames[status])}${n.id==='M'&&state.snapshot>=4?' · attempt 2':''}</span><p>${escapeText(d.summary)}</p></div><div class="detail-tabs">${tabs.map(tab=>`<button data-detail-tab="${tab}" class="${state.tab===tab?'selected':''}">${tab[0].toUpperCase()+tab.slice(1)}</button>`).join('')}</div><div class="detail-content">${content}</div>`;
}
function render() {
  renderNav();renderGraph();renderInspector();
  const s=snapshot();
  $('#run-status').textContent=s.name;
  $('#elapsed').textContent=`${s.time} elapsed · ${state.snapshot===1?'2 investigators working':'sample phase history'}`;
  $('#canvas-note').textContent=s.note;
  $('#history-label').textContent=`${s.time} · ${s.name}`;
  $('#history').value=state.snapshot;
  $('#transition-strip').innerHTML=`${icon(state.snapshot>=4?'return':'arrow')}<span class="event-time">${s.at}</span><b>${escapeText(s.event)}</b><span class="event-reason">${escapeText(s.reason)}</span><button id="inspect-transition">Inspect ${icon('arrow')}</button>`;
}
function renderMinimap() {
  const v=$('#viewport'), colors={done:'#7fb3a0',active:'#536cef',failed:'#d38b90',skipped:'#c3c9d4',planned:'#dbe1ea',other:'#e6eaf0'};
  $('#minimap').setAttribute('viewBox',`0 0 ${WIDTH} ${HEIGHT}`);
  $('#minimap').innerHTML=edges.map(e=>`<path d="${edgePath(e)}" fill="none" stroke="${e.back?'#c6a26b':'#dbe1eb'}" stroke-width="10"/>`).join('')+nodes.map(n=>`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="15" fill="${colors[nodeState(n.id)]}"/>`).join('')+`<rect x="${-state.x/state.scale}" y="${-state.y/state.scale}" width="${v.clientWidth/state.scale}" height="${v.clientHeight/state.scale}" fill="#5c70ee0d" stroke="#7a8fee" stroke-width="12" rx="12"/>`;
}
function updateTransform() {
  $('#graph').style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;
  $('#zoom-level').textContent=Math.round(state.scale*100)+'%';renderMinimap();
}
function frame(bounds) {
  const v=$('#viewport'),width=v.clientWidth,height=v.clientHeight;
  state.scale=Math.max(.11,Math.min((width-80)/bounds.w,(height-115)/bounds.h,1.05));
  state.x=(width-bounds.w*state.scale)/2-bounds.x*state.scale;
  state.y=(height-40-bounds.h*state.scale)/2-bounds.y*state.scale;
  updateTransform();
}
function fit() {state.mode='fit';frame({x:95,y:5,w:1365,h:3800});}
function focus(id=snapshot().current) {
  state.mode='focus';state.focusId=id;
  const n=byId[id];
  if(innerWidth<=650){
    const v=$('#viewport');
    state.scale=Math.min(.9,(v.clientWidth-35)/n.w);
    state.x=v.clientWidth/2-cx(n)*state.scale;
    state.y=v.clientHeight*.45-cy(n)*state.scale;
    updateTransform();return;
  }
  const regions={M:{x:230,y:930,w:965,h:675},H:{x:230,y:920,w:965,h:540},W:{x:230,y:920,w:965,h:540},AB:{x:520,y:1635,w:860,h:825},AR:{x:520,y:1635,w:860,h:825},AC:{x:520,y:1870,w:860,h:815},P:{x:325,y:2670,w:880,h:930},F:{x:350,y:3195,w:870,h:605}};
  frame(regions[id]||{x:n.x-110,y:n.y-120,w:n.w+220,h:n.h+320});
}
function zoom(factor,anchor) {
  const v=$('#viewport'),point=anchor||{x:v.clientWidth/2,y:v.clientHeight/2},next=Math.max(.11,Math.min(1.8,state.scale*factor));
  state.x=point.x-(point.x-state.x)*next/state.scale;state.y=point.y-(point.y-state.y)*next/state.scale;
  state.scale=next;state.mode='manual';updateTransform();
}
function select(id,move=false) {
  state.selected=id;state.tab='summary';state.attempt=id==='M'&&state.snapshot>=4||id==='P'&&state.snapshot===5?2:1;
  $('#inspector').hidden=false;renderGraph();renderInspector();
  if(move)requestAnimationFrame(()=>focus(id));
}
function setSnapshot(index) {
  state.snapshot=Number(index);state.selected=snapshot().current;state.attempt=state.snapshot>=4?2:1;
  render();if(state.mode==='fit')fit();else focus();
}
function stopPlayback() {clearInterval(state.timer);state.timer=null;state.playing=false;$('#play').innerHTML=icon('play');$('#play').setAttribute('aria-label','Play sample history');}
$('#history').addEventListener('input',event=>{stopPlayback();setSnapshot(event.target.value);});
$('#play').addEventListener('click',()=>{
  if(state.playing){stopPlayback();return;}
  if(state.snapshot===5)setSnapshot(0);
  state.playing=true;$('#play').innerHTML=icon('pause');$('#play').setAttribute('aria-label','Pause sample history');
  state.timer=setInterval(()=>{if(state.snapshot===5)stopPlayback();else setSnapshot(state.snapshot+1);},2300);
});
$('#latest').addEventListener('click',()=>{stopPlayback();setSnapshot(5);});
$('#fit').addEventListener('click',fit);$('#fit-icon').addEventListener('click',fit);$('#map-fit').addEventListener('click',fit);
$('#focus').addEventListener('click',()=>{state.selected=snapshot().current;renderGraph();renderInspector();focus();});
$('#zoom-in').addEventListener('click',()=>zoom(1.2));$('#zoom-out').addEventListener('click',()=>zoom(1/1.2));
$('#inspector-toggle').addEventListener('click',()=>{$('#inspector').hidden=!$('#inspector').hidden;});
document.addEventListener('click',event=>{
  const n=event.target.closest('[data-node]'),p=event.target.closest('[data-focus]'),tab=event.target.closest('[data-detail-tab]'),attempt=event.target.closest('[data-attempt]');
  if(n)select(n.dataset.node);
  if(p)select(p.dataset.focus,true);
  if(tab){state.tab=tab.dataset.detailTab;renderInspector();}
  if(attempt){state.attempt=Number(attempt.dataset.attempt);renderInspector();}
  if(event.target.closest('#close-inspector'))$('#inspector').hidden=true;
  if(event.target.closest('#inspect-transition'))select(state.snapshot>=4?'P':snapshot().current,true);
});
$('#graph').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const n=event.target.closest('[data-node]');if(n){event.preventDefault();select(n.dataset.node);}}});
let drag=null;
$('#viewport').addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('button,.minimap,[data-node]'))return;
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,tx:state.x,ty:state.y};$('#viewport').setPointerCapture(event.pointerId);
});
$('#viewport').addEventListener('pointermove',event=>{if(drag){state.x=drag.tx+event.clientX-drag.x;state.y=drag.ty+event.clientY-drag.y;state.mode='manual';updateTransform();}});
$('#viewport').addEventListener('pointerup',()=>{drag=null;});$('#viewport').addEventListener('pointercancel',()=>{drag=null;});
$('#viewport').addEventListener('wheel',event=>{event.preventDefault();const box=$('#viewport').getBoundingClientRect();zoom(Math.exp(-event.deltaY*.0017),{x:event.clientX-box.left,y:event.clientY-box.top});},{passive:false});
$('#minimap').addEventListener('click',event=>{
  const pt=$('#minimap').createSVGPoint();pt.x=event.clientX;pt.y=event.clientY;
  const p=pt.matrixTransform($('#minimap').getScreenCTM().inverse()),v=$('#viewport');
  state.x=v.clientWidth/2-p.x*state.scale;state.y=v.clientHeight/2-p.y*state.scale;state.mode='manual';updateTransform();
});
document.addEventListener('keydown',event=>{
  if(event.target.matches('input,textarea,select'))return;
  if(event.key==='Escape'){$('#inspector').hidden=true;closeSessions();}
  if(event.key.toLowerCase()==='f')fit();
  if(event.key==='0')focus();
  if(event.key==='+'||event.key==='=')zoom(1.2);
  if(event.key==='-')zoom(1/1.2);
});
function closeSessions(){$('#sessions-popover').hidden=true;$('#sessions-button').setAttribute('aria-expanded','false');}
$('#sessions-button').addEventListener('click',()=>{const panel=$('#sessions-popover');panel.hidden=!panel.hidden;$('#sessions-button').setAttribute('aria-expanded',String(!panel.hidden));});
$('#sessions-close').addEventListener('click',closeSessions);
$('#sessions-popover').addEventListener('click',event=>{
  const button=event.target.closest('[data-session]');if(!button)return;
  state.session=button.dataset.session;stopPlayback();closeSessions();
  const config={retry:['Fix uploads that retry forever','uploader','fix/retry-budget',4,'CODEX'],design:['Fix uploads that retry forever','uploader','fix/retry-budget',2,'CLAUDE CODE'],complete:['Fix uploads that retry forever','uploader','fix/retry-budget',5,'COPILOT']}[state.session];
  $('#session-title').textContent=config[0];$('#project').textContent=config[1];$('#branch-name').textContent=config[2];
  $('#host-name').textContent=config[4];
  setSnapshot(config[3]);
});
new ResizeObserver(()=>{if(state.mode==='fit')fit();else if(state.mode==='focus')focus(state.focusId);else renderMinimap();}).observe($('#viewport'));
if(innerWidth<=950)$('#inspector').hidden=true;
render();requestAnimationFrame(()=>focus());

// Read-only graph export for design review and exact topology checks.
window.workflowDesign={nodes,edges,snapshots,exportSvg(){
  const clone=$('#graph').cloneNode(true);
  clone.removeAttribute('style');clone.setAttribute('xmlns',NS);clone.setAttribute('width',WIDTH);clone.setAttribute('height',HEIGHT);
  clone.style.width=WIDTH+'px';clone.style.height=HEIGHT+'px';clone.style.position='static';
  const defs=clone.querySelector('defs');
  for(const symbol of document.querySelectorAll('.symbols symbol'))defs.appendChild(symbol.cloneNode(true));
  const style=document.createElementNS(NS,'style');
  style.textContent=Array.from(document.styleSheets).flatMap(sheet=>{try{return Array.from(sheet.cssRules).map(rule=>rule.cssText);}catch{return[];}}).join('\n');
  clone.prepend(style);return new XMLSerializer().serializeToString(clone);
}};
