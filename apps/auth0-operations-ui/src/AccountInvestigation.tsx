import React, { useRef, useState } from 'react';
import { Background, Controls, MarkerType, Position, ReactFlow } from '@xyflow/react';
import { AnalysisDetails } from './AnalysisDetails';
import { Inspector } from './InvestigationWorkspace';
import { createInvestigation, executeInvestigation, findings, investigationRecommendation, validateTarget, type Investigation, type NodeId } from './investigation';
import { demoAnalysis, demoClient, demoTarget } from './offlineDemo';
import type { Evidence, ToolClient } from './operations';

const positions: Partial<Record<NodeId, { x: number; y: number }>> = {
 search: {x: 0, y: 160}, match: {x: 260, y: 160}, 'not-found': {x: 520, y: 0},
 profile: {x: 520, y: 160}, logs: {x: 780, y: 80}, blocks: {x: 780, y: 240}, aggregate: {x: 1040, y: 160},
};

export function AccountInvestigation({active, client, connected, start, analyze, busy, setBusy}: {
 active: boolean; client: ToolClient | null; connected: boolean; start: () => Promise<string>;
 analyze: (token: string, evidence: Evidence[]) => Promise<string>; busy: boolean; setBusy: (value: boolean) => void;
}) {
 const [target, setTarget] = useState('');
 const [result, setResult] = useState<Investigation>();
 const [phase, setPhase] = useState<'Evidence review' | 'Proposed' | 'Executing' | 'Completed'>('Evidence review');
 const [offline, setOffline] = useState(false);
 const [selected, select] = useState<NodeId>();
 const [error, setError] = useState('');
 const [consent, setConsent] = useState(false);
 const [analysis, setAnalysis] = useState('');
 const [analysisBusy, setAnalysisBusy] = useState(false);
 const workRef = useRef<HTMLElement>(null);
 const lock = useRef(false);
 const prepare = (example: boolean) => {
  const value = example ? demoTarget : target.trim();
  const problem = validateTarget(value);
  if (problem) { setError(problem); return; }
  setError(''); setOffline(example); setResult(createInvestigation(value)); select(undefined); setAnalysis(''); setConsent(false); setPhase('Proposed');
 };
 const run = async () => {
  if (!result || lock.current || (!offline && (!connected || !client))) return;
  lock.current = true; setBusy(true); setError(''); setPhase('Executing');
  try {
   const token = offline ? 'offline' : await start();
   await executeInvestigation(result, offline ? demoClient : client!, token, undefined, setResult);
   setPhase('Completed');
  } catch {
   setError('Investigation could not be completed. Inspect recorded results before retrying.');
   setResult(previous => previous && {...previous, steps: previous.steps.map(step => step.state === 'running' ? {...step, state:'failed', summary:'The application could not confirm this step completed.'} : step.state === 'queued' ? {...step, state:'skipped', summary:'Investigation stopped before this step began.'} : step)});
   setPhase('Completed');
  } finally { lock.current = false; setBusy(false); }
 };
 const generate = async () => {
  if (!result || !consent || analysisBusy) return;
  const evidence = result.steps.flatMap(step => step.evidence?.status === 'success' ? [step.evidence] : []);
  if (!evidence.length) return;
  setConsent(false); setAnalysisBusy(true); setError('');
  try { setAnalysis(offline ? await demoAnalysis() : await analyze('', evidence)); }
  catch { setError('AI analysis was unavailable. The recorded evidence remains available.'); }
  finally { setAnalysisBusy(false); }
 };
 const steps = result?.steps.filter(step => positions[step.id]) ?? [];
 const current = steps.find(step => step.id === selected);
 const nodes = steps.map(step => ({id:step.id, position:positions[step.id]!, sourcePosition:Position.Right, targetPosition:Position.Left,
  className:'lens-node ' + (step.state === 'completed' ? 'success' : step.state === 'queued' ? 'pending' : step.state) + (selected === step.id ? ' selected' : ''),
  data:{label:<><small>{step.state === 'queued' ? 'Proposed' : step.state}</small><strong>{step.label}</strong><span>{step.state === 'queued' ? step.purpose : step.summary}</span></>}}));
 const edges = steps.flatMap(step => step.dependencies.filter(id => positions[id]).map(id => ({id:id + '-' + step.id, source:id, target:step.id, animated:step.state === 'running', markerEnd:{type:MarkerType.ArrowClosed}, style:{stroke:'var(--ll-accent, #3da54e)'}})));
 const observation = result ? findings(result) : [];
 const recommendation = result && phase === 'Completed' ? investigationRecommendation(result) : undefined;
 const inspect = (id: NodeId) => { select(id); workRef.current?.scrollIntoView({block:'start'}); };
 return <div className="lens lens-case">
  <div className="lens-case-head"><span className="lens-kicker">ACCOUNT INVESTIGATION</span><h1>Investigate an account</h1><p>Review read-only checks for an exact email address or Auth0 user ID.</p></div>
  <section className="lens-card"><label htmlFor="account-investigation-target">Email address or Auth0 user ID</label><div className="lens-account-input"><input id="account-investigation-target" value={target} onChange={event => {setTarget(event.target.value); setError('');}} placeholder="name@example.com or auth0|123" disabled={busy}/><button className="primary" disabled={!connected || busy} onClick={() => prepare(false)}>Propose investigation</button><button disabled={busy} onClick={() => prepare(true)}>Propose offline example</button></div><p>Proposing a graph does not contact Auth0 or an AI provider.</p></section>
  {result && <section ref={workRef} className="lens-card lens-work"><div className="lens-card-head"><div><span className="lens-kicker">INVESTIGATION GRAPH · {offline ? 'OFFLINE FIXTURE' : 'READ-ONLY'}</span><h3>{phase}</h3><p>{result.target}</p></div>{phase === 'Proposed' && <button className="primary" disabled={busy || (!offline && !connected)} onClick={() => void run()}>Approve and run checks</button>}</div>
   {phase === 'Proposed' && <p>{offline ? 'Checks use fictional fixture responses.' : 'Approved checks retrieve account profile, recent logs and block records from Auth0.'} AI analysis requires a separate action.</p>}
   <div className="lens-graph">{active && <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => select(node.id as NodeId)} minZoom={0.15}><Controls showInteractive={false}/><Background color="#2b2e2c"/></ReactFlow>}</div>
   <details><summary>Review proposed checks and dependencies</summary>{steps.map(step => <div key={step.id} className="lens-category"><button onClick={() => select(step.id)}>{step.label}</button><span>{step.purpose} · After {step.dependencies.join(', ') || 'approval'}</span></div>)}</details>
   {current && <aside className="lens-inspector"><button onClick={() => select(undefined)}>Close inspector</button><Inspector key={current.id} step={current} result={result}/></aside>}
  </section>}
  {error && <p role="alert">{error}</p>}
  {result && phase === 'Completed' && <section className="lens-card lens-report"><span className="lens-kicker">INVESTIGATION SUMMARY · {offline ? 'FIXTURE' : 'TOOL RESULTS'}</span><h3>Evidence and next steps</h3>{recommendation && <><h4>{recommendation.status}</h4><p>{recommendation.reason}</p>{recommendation.actions.map((action, index) => <p key={index}>{action.text} <button onClick={() => inspect(action.source)}>Inspect evidence</button></p>)}</>}
   <details><summary>View recorded result summaries</summary>{observation.length ? observation.map((item, index) => <article key={index}><h4>{item.text}</h4><p>{item.category}</p><button onClick={() => inspect(item.source)}>Inspect evidence: {item.source} ↑</button></article>) : <p>No findings available. Review the recorded step outcomes.</p>}</details><p>Results may be incomplete. Remediation requires human review.</p>
   <div className="lens-ai-analysis"><div className="lens-ai-heading"><span className="lens-ai-icon" aria-hidden="true">✦</span><div><span className="lens-kicker">AI-ASSISTED ANALYSIS</span><h3>What happened and what to do next</h3></div></div><p>{offline ? 'Generate a local fictional example analysis.' : 'Successful sanitized account evidence is sent to an external model. This may incur provider charges.'}</p><label><input type="checkbox" checked={consent} disabled={analysisBusy} onChange={event => setConsent(event.target.checked)}/> {offline ? 'I want to see the fictional example analysis.' : 'I authorize external model analysis and associated charges.'}</label><button className="primary" disabled={!consent || analysisBusy || !result.steps.some(step => step.evidence?.status === 'success') || (!offline && !connected)} onClick={() => void generate()}>{analysisBusy ? 'Analyzing evidence…' : analysis ? 'Generate again' : 'Generate AI analysis ✦'}</button>{analysis && <><p>AI interpretation may be incomplete. Verify it against the evidence before acting.</p><AnalysisDetails text={analysis}/></>}</div>
  </section>}
 </div>;
}
