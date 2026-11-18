import React, { useRef, useState } from 'react';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createInvestigation, executeInvestigation, type Investigation, type NodeId } from './investigation';
import { EvidenceCard } from './EvidenceCard';
import type { Evidence, ToolClient } from './operations';

const positions: Record<NodeId, {x:number;y:number}> = { search:{x:240,y:0}, match:{x:240,y:100}, 'not-found':{x:0,y:200}, profile:{x:360,y:200}, logs:{x:240,y:300}, blocks:{x:480,y:300}, aggregate:{x:360,y:400}, diagnosis:{x:360,y:500}, report:{x:360,y:600} };
const icons = {queued:'○',running:'◌',completed:'✓',warning:'!',failed:'×',skipped:'–'};
export function InvestigationWorkspace({active: visible, client, connected, start, analyze, busy, setBusy}: {active:boolean;client:ToolClient | null; connected:boolean; start:()=>Promise<string>; analyze:(token:string, evidence:Evidence[])=>Promise<string>; busy:boolean; setBusy:(value:boolean)=>void}) {
 const [email,setEmail] = useState(''); const [result,setResult] = useState<Investigation>(); const [selected,setSelected] = useState<NodeId>('search'); const lock = useRef(false);
 const run = async () => {
  if (!client || !connected || !email.trim() || lock.current) return;
  lock.current = true; setBusy(true); const initial = createInvestigation(email.trim()); setResult(initial); setSelected('search');
  try { const token = await start(); await executeInvestigation(initial, client, token, evidence => analyze(token,evidence), setResult); }
  catch (error) { setResult(prev => prev && {...prev, steps:prev.steps.map(step => ({...step, state:step.id === 'search' ? 'failed' : 'skipped', summary:step.id === 'search' ? (error instanceof Error ? error.message : 'Pipeline could not be started.') : 'Pipeline could not be started.', ended:new Date().toISOString()}))}); }
  finally { lock.current = false; setBusy(false); }
 };
 const steps = result?.steps ?? createInvestigation('').steps;
 const nodes: Node[] = steps.map(s => ({id:s.id,position:positions[s.id],data:{label:<><span className={'graph-icon '+s.state}>{icons[s.state]}</span><span><strong>{s.label}</strong><small>{s.state}</small></span></>}, className:'investigation-node '+s.state+(selected===s.id?' selected':''), draggable:false}));
 const edges: Edge[] = steps.flatMap(s => s.dependencies.map(dep => ({id:dep+'-'+s.id,source:dep,target:s.id,animated:s.state==='running',className:s.state==='running'?'active-edge':''})));
 const active = steps.find(s => s.id === selected)!; const done = steps.filter(s => !['queued','running'].includes(s.state)).length;
 return <section className="investigation-workspace"><form className="investigation-bar" onSubmit={e => {e.preventDefault(); void run();}}><div><span className="eyebrow">SIGN-IN INVESTIGATION</span><h2>Investigation workspace</h2><p>Trace the evidence behind an account sign-in issue.</p></div><div className="investigation-search"><label htmlFor="investigation-email">Exact email address</label><div className="row"><input id="investigation-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" /><button className="primary" disabled={!connected || busy}>{result ? 'Restart investigation' : 'Start investigation'}</button></div></div></form>
 {result && <div className="investigation-meta"><span><b>Target</b> {result.target}</span><span><b>Started</b> {new Date(result.started).toLocaleString()}</span><span><b>Progress</b> {done} / {steps.length} steps settled</span><span><b>Status</b> {steps.some(s=>s.state==='running') || steps.some(s=>s.state==='queued') ? 'In progress' : steps.some(s=>s.state==='failed') ? 'Needs review' : 'Finished'}</span></div>}
 <div className="workspace-grid"><div className="graph-panel"><div className="workspace-heading"><div><span className="eyebrow">EXECUTION GRAPH</span><h3>Investigation flow</h3></div><span>Read-only · select a step</span></div><div className="graph-canvas">{visible && <ReactFlow nodes={nodes} edges={edges} onNodeClick={(_,node)=>setSelected(node.id as NodeId)} nodesConnectable={false} nodesDraggable={false} fitView minZoom={0.4} maxZoom={1.5} proOptions={{hideAttribution:true}}><Background gap={20} size={1}/><Controls showInteractive={false}/></ReactFlow>}</div></div>
 <aside className="inspector"><span className="eyebrow">STEP INSPECTOR</span><h3>{active.label}</h3><div className={'inspector-state '+active.state}>{icons[active.state]} {active.state}</div><p>{active.purpose}</p><h4>Finding</h4><p>{active.summary}</p><h4>Dependencies</h4><p>{active.dependencies.length ? active.dependencies.map(id=>steps.find(s=>s.id===id)?.label).join(', ') : 'None'}</p>{active.started && <p className="hint">Started {new Date(active.started).toLocaleTimeString()}{active.ended && <> · Finished {new Date(active.ended).toLocaleTimeString()}</>}</p>}{active.evidence && <EvidenceCard item={active.evidence}/>}</aside></div>
 <details className="diagnosis-panel" open><summary>AI diagnosis <span>Unverified interpretation</span></summary>{result?.diagnosis ? <><p>Compare all claims with the selected steps above. References are model-generated and are not automatically verified.</p><div className="diagnosis-text">{result.diagnosis}</div></> : <p>{result?.steps.find(s=>s.id==='diagnosis')?.summary ?? 'The diagnosis will appear after evidence collection.'}</p>}</details></section>;
}
