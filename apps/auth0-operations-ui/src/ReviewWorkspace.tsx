import { AnalysisDetails } from './AnalysisDetails';
import React, {useRef, useState} from 'react';
import {Background, Controls, ReactFlow, MarkerType, type Edge, type Node} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {EvidenceCard} from './EvidenceCard';
import {createReview, executeReview, reviewAnalysisEvidence, workflows, type Review} from './reviewWorkflows';
import type {Evidence, ToolClient} from './operations';

const icons = {queued: '○', running: '◌', completed: '✓', warning: '!', failed: '×', skipped: '–'};

export function ReviewWorkspace({active:visible,domain,client,connected,start,analyze,busy,setBusy}: {active:boolean;domain:'identity'|'security';client:ToolClient|null;connected:boolean;start:()=>Promise<string>;analyze:(token:string,evidence:Evidence[])=>Promise<string>;busy:boolean;setBusy:(value:boolean)=>void}) {
 const available=workflows.filter(w=>w.domain===domain);
 const [workflowId,setWorkflowId]=useState(available[0].id); const workflow=available.find(w=>w.id===workflowId) ?? available[0];
 const [target,setTarget]=useState(''); const [targetKind,setTargetKind]=useState<'user_id'|'email'>('user_id'); const [includeAI,setIncludeAI]=useState(true); const [result,setResult]=useState<Review>(); const [selected,setSelected]=useState(workflow.checks[0].id); const lock=useRef(false);
 const [view, setView] = useState<'summary' | 'step'>('summary');
 const [list, setList] = useState(false);
 const inspector = useRef<HTMLElement>(null);
 const inspect = (id: string) => {
  setSelected(id);
  setView('step');
  if ((inspector.current?.parentElement?.clientWidth ?? Infinity) <= 650) inspector.current?.focus();
 };
 const requiresUser=workflow.checks.some(c=>c.input==='user_id');
 const run=async()=>{
  if (!client || !connected || lock.current || (requiresUser && !target.trim())) return;
  lock.current=true;setBusy(true);const initial=createReview(workflow,target.trim(),targetKind,includeAI);setResult(initial);setSelected(initial.steps[0].id);setView('summary');
  try {const token=await start();await executeReview(initial,client,token,evidence=>analyze(token,evidence),setResult);}
  catch(error){setResult(prev=>prev && {...prev,steps:prev.steps.map((step,index)=>({...step,state:index===0?'failed':'skipped',summary:index===0?(error instanceof Error?error.message:'Pipeline could not be started.'):'Pipeline could not be started.',ended:new Date().toISOString()}))});}
  finally{lock.current=false;setBusy(false);}
 };
 const analyzeCurrent=async()=>{
  if (!result || !result.report || !connected || busy || lock.current) return;
  const evidence=result.steps.flatMap(step=>step.evidence ? [step.evidence] : []);
  if (!evidence.some(item=>item.status==='success')) return;
  lock.current=true;setBusy(true);setIncludeAI(true);
  const started=new Date().toISOString();
  setResult(previous=>previous && {...previous,includeAI:true,steps:[...previous.steps.filter(step=>step.id!=='diagnosis'),{id:'diagnosis',label:'AI Analysis',purpose:'Interpret the existing tool evidence without repeating the checks.',dependencies:['report'],state:'running',summary:'Analyzing existing evidence…',started}]});
  try {
   const diagnosis=await analyze('',reviewAnalysisEvidence(result.workflow,evidence));
   setResult(previous=>previous && {...previous,diagnosis,steps:previous.steps.map(step=>step.id==='diagnosis'?{...step,state:'completed',summary:'AI analysis received; verify every claim against the evidence.',ended:new Date().toISOString()}:step)});
  } catch(error) {
   setResult(previous=>previous && {...previous,steps:previous.steps.map(step=>step.id==='diagnosis'?{...step,state:'failed',summary:error instanceof Error?error.message:'AI analysis failed.',ended:new Date().toISOString()}:step)});
  } finally {lock.current=false;setBusy(false);}
 };
 const previewing=!!result && result.includeAI!==includeAI;
 const steps = (!previewing && result ? result.steps : createReview(workflow, target, targetKind, includeAI).steps).filter(step => step.id !== 'report'); const checks=(result?.workflow ?? workflow).checks; const width=Math.max(0,(checks.length-1)*220); const center=width/2;
 const hasLookup=steps.some(s=>s.id==='lookup'); const offset=hasLookup?120:0;
 const position=(id:string)=>{if(id==='lookup') return {x:center,y:0}; const index=checks.findIndex(c=>c.id===id);return index>=0?{x:index*220,y:offset}:{x:center,y:offset+(({aggregate:120,diagnosis:240} as Record<string,number>)[id] ?? 0)};};
 const nodes: Node[] = steps.map(step => ({
	id: step.id,
	position: position(step.id),
	ariaLabel: step.label + ', ' + (step.state === 'queued' ? 'pending' : step.state),
	data: {label: <div className="node-content"><strong>{step.label}</strong><span className={'step-status ' + step.state}>
		<span aria-hidden="true">{icons[step.state]}</span>{step.state === 'queued' ? 'Pending' : step.state}
	</span><small title={step.summary}>{step.summary}</small></div>},
	className: 'investigation-node ' + step.state + (view === 'step' && selected === step.id ? ' is-inspected' : ''),
	selected: view === 'step' && selected === step.id,
 }));
 const edges: Edge[] = steps.flatMap(step => step.dependencies.map(dependency => {
	const source = dependency === 'report' ? 'aggregate' : dependency;
	return {
	id: source + '-' + step.id, source, target: step.id, type: 'smoothstep',
	markerEnd: {type: MarkerType.ArrowClosed, width: 14, height: 14},
	animated: step.state === 'running', className: step.state === 'running' ? 'active-edge' : '',
	};
 }));
 const active=steps.find(s=>s.id===selected) ?? steps[0]; const done=steps.filter(s=>!['queued','running'].includes(s.state)).length;
 const report = !previewing ? result?.report : undefined;
 const status = busy && !previewing && result && done < steps.length ? 'Running' :
  previewing || !result ? 'Ready' : steps.some(step => ['failed', 'warning'].includes(step.state)) ? 'Needs review' : 'Finished';

 return <section className="investigation-workspace">
  <form className="investigation-launch" onSubmit={event => { event.preventDefault(); void run(); }}>
   <div className="launch-main review-launch-fields">
    <div>
     <label htmlFor={domain + '-workflow'}>Review</label>
     <select id={domain + '-workflow'} value={workflowId} disabled={busy} onChange={event => {
      const next = available.find(item => item.id === event.target.value)!;
      setWorkflowId(next.id);
      setResult(undefined);
      setSelected(next.checks[0].id);
      setView('summary');
     }}>{available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    </div>
    {requiresUser && <>
     <div><label htmlFor={domain + '-identifier-type'}>Identify user by</label>
      <select id={domain + '-identifier-type'} value={targetKind} disabled={busy} onChange={event => {
       setTargetKind(event.target.value as 'user_id' | 'email');
       setTarget('');
       setResult(undefined);
       setView('summary');
      }}><option value="user_id">Auth0 user ID</option><option value="email">Exact email address</option></select>
     </div>
     <div className="launch-target"><label htmlFor={domain + '-user'}>{targetKind === 'email' ? 'Exact email address' : 'Auth0 user ID'}</label>
      <input id={domain + '-user'} type={targetKind === 'email' ? 'email' : 'text'} required
       maxLength={targetKind === 'email' ? 254 : 300} value={target} onChange={event => setTarget(event.target.value)}
       placeholder={targetKind === 'email' ? 'name@example.com' : 'auth0|123'}/>
     </div>
    </>}
    <button className="primary" disabled={!connected || busy}>Start review</button>
   </div>
   <div className="investigation-options"><label><input type="checkbox" checked={includeAI} disabled={busy}
    onChange={event => { setIncludeAI(event.target.checked); setView('summary'); }}/> AI Analysis</label></div>
  </form>
  {previewing && <div className="banner" role="status">Showing the plan for the next review. <button type="button"
   onClick={() => setIncludeAI(result!.includeAI)}>Show previous results</button></div>}
  <div className="investigation-board">
   <div className="run-header">
    <div className="run-target"><div className="run-source">Read-only review</div><h2>{workflow.label}</h2>
     {result?.target && !previewing && requiresUser && <small>{result.target}</small>}
    </div>
    <div className="run-progress" role="status"><strong>{status}</strong>
     {result && !previewing && <><progress value={done} max={steps.length} aria-label="Steps settled"/><span>{done} / {steps.length} settled</span></>}
    </div>
    <button type="button" className="summary-jump" onClick={() => { setView('summary'); inspector.current?.focus(); }}>View findings</button>
   </div>
   <div className="workspace-grid">
    <div className="graph-panel">
     <div className="graph-toolbar"><h3>Review flow</h3><div className="workspace-switch" role="group" aria-label="Workflow view">
      <button type="button" aria-pressed={!list} onClick={() => setList(false)}>Graph</button>
      <button type="button" aria-pressed={list} onClick={() => setList(true)}>Steps</button>
     </div></div>
     {list ? <ol className="workflow-steps">{steps.map(step => <li key={step.id}><button type="button"
      aria-pressed={view === 'step' && active.id === step.id} onClick={() => inspect(step.id)}>
      <strong>{step.label}</strong><span className={'step-status ' + step.state}>{step.state === 'queued' ? 'Pending' : step.state}</span>
      <small>{step.summary}</small>
     </button></li>)}</ol> : <div className="graph-canvas" onKeyDownCapture={event => {
      const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
      if (node?.dataset.id && (event.key === 'Enter' || event.key === ' ')) {
       event.preventDefault();
       event.stopPropagation();
       inspect(node.dataset.id);
      }
     }}>
      {visible && <ReactFlow key={workflowId + ':' + targetKind + ':' + includeAI} nodes={nodes} edges={edges}
       onNodeClick={(_, node) => inspect(node.id)} nodesConnectable={false} nodesDraggable={false} edgesFocusable={false}
       deleteKeyCode={null} preventScrolling={false} zoomOnScroll={false} zoomOnDoubleClick={false}
       fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.25} maxZoom={1.5} proOptions={{ hideAttribution: true }}>
       <Background gap={20} size={1} color="var(--flow-dot)"/><Controls showInteractive={false}/>
      </ReactFlow>}
     </div>}
     <p className="graph-footer">Select a step to inspect evidence. Drag to pan or use Fit view to reset.</p>
    </div>
    <aside className="inspector" aria-label="Review details" tabIndex={-1} ref={inspector}>
     <div className="workspace-switch inspector-switch" role="group" aria-label="Review details view">
      <button type="button" aria-pressed={view === 'summary'} onClick={() => setView('summary')}>Summary</button>
      <button type="button" aria-pressed={view === 'step'} onClick={() => setView('step')}>Step evidence</button>
     </div>
     {view === 'step' ? <div className="step-inspector">
      <div className="step-inspector-title"><h3>{active.label}</h3><span className={'step-status ' + active.state}>{active.state === 'queued' ? 'Pending' : active.state}</span></div>
      <p>{active.purpose}</p><p>{active.summary}</p>
      {active.evidence && <EvidenceCard item={active.evidence}/>}
      {active.id === 'diagnosis' && !previewing && result?.diagnosis && <section className="interpretation">
       <h4>Unverified AI analysis</h4><AnalysisDetails text={result.diagnosis}/>
      </section>}
      {active.started && <details><summary>Execution details</summary><p>Started {new Date(active.started).toLocaleTimeString()}</p>
       {active.ended && <p>Finished {new Date(active.ended).toLocaleTimeString()}</p>}
      </details>}
     </div> : <div className="findings-summary">
      <h3>Findings</h3>
      {report ? <>
       <p>{report.summary}</p>
       {report.findings.length > 0 && <ul>{report.findings.map((finding, index) => <li key={index}>
        <span className={'finding-kind ' + (finding.kind === 'gap' ? 'inconclusive' : '')}>{finding.kind === 'attention' ? 'Review' : finding.kind === 'gap' ? 'Evidence gap' : 'Information'}</span>
        <p>{finding.message}</p><button type="button" onClick={() => inspect(finding.stepId)}>View step</button>
       </li>)}</ul>}
       <details className="summary-next"><summary>Review scope</summary>{report.limitations.map(text => <p key={text}>{text}</p>)}</details>
       {report.aiSuggested && !result?.includeAI && <button type="button" disabled={!connected || busy} onClick={() => void analyzeCurrent()}>Analyze existing evidence with AI</button>}
      </> : <p>{status === 'Running' ? 'Review in progress.' : result && !previewing ? 'No review findings are available. Open the affected step for details.' : workflow.description}</p>}
      {!previewing && result?.includeAI && <section className="interpretation">
       <h4>AI Analysis · Unverified</h4>
       {result.diagnosis ? <AnalysisDetails text={result.diagnosis}/> : <p>{steps.find(step => step.id === 'diagnosis')?.summary}</p>}
      </section>}
     </div>}
    </aside>
   </div>
  </div>
 </section>;
}
