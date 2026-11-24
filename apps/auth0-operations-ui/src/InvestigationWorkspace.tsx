import { AnalysisDetails } from './AnalysisDetails';
import React, { useId, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, MarkerType, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './investigation-workspace.css';
import { createInvestigation, executeInvestigation, findings, investigationRecommendation, stepView, validateTarget, type Investigation, type NodeId, type Step } from './investigation';
import { demoAnalysis, demoClient, demoTarget } from './offlineDemo';
import { Value } from './EvidenceCard';
import type { Evidence, ToolClient } from './operations';
import type { Ticket } from './support/domain';

// Fixed lanes keep the same branches in place as execution results arrive.
const positions: Record<Exclude<NodeId, 'report'>, { x: number; y: number }> = {
	search: { x: 218, y: 0 },
	match: { x: 218, y: 100 },
	'not-found': { x: 0, y: 200 },
	profile: { x: 218, y: 200 },
	logs: { x: 109, y: 300 },
	blocks: { x: 327, y: 300 },
	aggregate: { x: 218, y: 400 },
	diagnosis: { x: 218, y: 500 },
};

const icons = { pending: '○', running: '◌', completed: '✓', warning: '!', failed: '×', skipped: '–', unknown: '?' };
const labels = { pending: 'Pending', running: 'Running', completed: 'Completed', warning: 'Warning', failed: 'Failed', skipped: 'Skipped', unknown: 'Unknown' };
type InspectorTab = 'Findings' | 'Input' | 'Output' | 'Trace';

function displayState(step: Step) {
	const { execution, severity } = stepView(step);
	return execution === 'completed' && severity === 'warning' ? 'warning' : execution;
}

function StepStatus({ step }: { step: Step }) {
	const state = displayState(step);
	return <span className={'step-status ' + state}><span aria-hidden="true">{icons[state]}</span>{labels[state]}</span>;
}

export function Inspector({step, result}:{step:Step; result?:Investigation}) {
 const [tab,setTab] = useState<InspectorTab>('Findings');
 const view = stepView(step), evidence = step.evidence;
 const matching = result ? findings(result).filter(item=>item.source===step.id) : [];
 return <div className="step-inspector"><div className="step-inspector-title"><h3>{step.label}</h3><StepStatus step={step}/></div><p>{step.purpose}</p>
 <div className="inspector-tabs" role="group" aria-label="Evidence views">{(['Findings','Input','Output','Trace'] as const).map(name=><button type="button" key={name} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}</div>
 {tab==='Findings' && <><h4>Observation</h4><p>{step.summary}</p>{matching.map((item,i)=><p key={i}><strong>{item.category}</strong> · {item.text} <small>Source: {step.label}</small></p>)}{!matching.length && <p className="hint">No additional validated finding for this step.</p>}{view.severity==='warning' && <p>Review this result and obtain independent evidence before taking action.</p>}</>}
 {tab==='Input' && <><h4>Tool</h4><p>{evidence?.tool ?? 'Not available'}</p><h4>Sanitized arguments</h4>{evidence?.input ? <Value value={evidence.input}/> : <p>Not available</p>}</>}
 {tab==='Output' && <><h4>Validated output</h4>{evidence?.error && <p role="alert">{evidence.error}</p>}{evidence?.data ? <><Value value={evidence.data}/><details className="raw-json"><summary>View sanitized JSON</summary><pre>{JSON.stringify(evidence.data,null,2)}</pre></details></> : <p>Not available</p>}</>}
 {tab==='Trace' && <><h4>Application-observed trace</h4><dl className="trace-list"><dt>Started</dt><dd>{step.started ? new Date(step.started).toLocaleString() : 'Not available'}</dd><dt>Finished</dt><dd>{step.ended && step.started ? new Date(step.ended).toLocaleString() : 'Not available'}</dd><dt>Duration</dt><dd>{step.started && step.ended ? `${Math.max(0,new Date(step.ended).getTime()-new Date(step.started).getTime())} ms` : 'Not available'}</dd><dt>Invocation ID</dt><dd>Not available</dd><dt>Pipeline run ID</dt><dd>Not available</dd><dt>Retries</dt><dd>Not available</dd><dt>Workflow dependencies</dt><dd>{step.dependencies.length ? step.dependencies.join(', ') : 'None'}</dd></dl><p className="hint">Times are observed by the application, not engine trace telemetry.</p></>}
 </div>;
}
export function InvestigationWorkspace({active: visible, client, connected, start, analyze, busy, setBusy, demoOnly = false, onDemoComplete, ticket, initialResult, onReturn}: {active:boolean;client:ToolClient | null; connected:boolean; start:()=>Promise<string>; analyze:(token:string, evidence:Evidence[])=>Promise<string>; busy:boolean; setBusy:(value:boolean)=>void; demoOnly?:boolean; onDemoComplete?:(result:Investigation)=>void; ticket?:Ticket; initialResult?:Investigation; onReturn?:()=>void}) {
 const [email,setEmail] = useState(''); const [result,setResult] = useState<Investigation | undefined>(initialResult); const [selected,setSelected] = useState<NodeId>('search'); const [inputError,setInputError] = useState(''); const [startupError,setStartupError] = useState(''); const [offline,setOffline] = useState(!!initialResult); const [useAi,setUseAi] = useState(false); const lock = useRef(false);
	const [panel, setPanel] = useState<'summary' | 'evidence'>('summary');
	const [listView, setListView] = useState(false);
	const inputId = useId();
	const detailRef = useRef<HTMLElement>(null);
	const selectStep = (id: NodeId, showDetails = false) => {
		setSelected(id);
		setPanel('evidence');
		const workspaceWidth = detailRef.current?.parentElement?.clientWidth ?? Infinity;
		if (showDetails || workspaceWidth <= 650) {
			detailRef.current?.focus();
		}
	};
 const run = async (demo = false) => {
  if (demoOnly && !demo) return;
  const target = demo ? demoTarget : email.trim(); const problem = validateTarget(target);
  if (problem) { setInputError(problem); return; }
  if ((!demo && (!client || !connected)) || lock.current) return;
  setInputError(''); setStartupError(''); setOffline(demo); lock.current = true; setBusy(true); const initial = createInvestigation(target); setResult(initial); setSelected('search'); setPanel('summary');
  try { const token = demo ? 'offline' : await start(); const completed = await executeInvestigation(initial, demo ? demoClient : client!, token, demo ? demoAnalysis : useAi ? evidence => analyze(token,evidence) : undefined, setResult); if (demo) onDemoComplete?.(completed); }
  catch { setStartupError('Investigation could not be started or completed. Check the engine connection and configuration.'); setResult(prev => prev && {...prev, steps:prev.steps.map(step => step.state === 'running' ? {...step, state:'failed', summary:'The application could not confirm this step completed.'} : step.state === 'queued' ? {...step, state:'skipped', summary:'Investigation stopped before this step began.'} : step)}); }
  finally { lock.current = false; setBusy(false); }
 };
	const showDiagnosis = offline || demoOnly || useAi;
	const allSteps = result?.steps ?? createInvestigation('').steps;
	const steps = allSteps.filter((step): step is Step & { id: keyof typeof positions } =>
		step.id !== 'report' && (showDiagnosis || step.id !== 'diagnosis'));
	const active = steps.find(step => step.id === selected) ?? steps[0];
	const recommendation = panel === 'summary' && result && !busy ? investigationRecommendation(result) : undefined;
	const observations = result ? findings(result) : [];
	const settled = steps.filter(step => !['queued', 'running'].includes(step.state)).length;
	const hasIssues = steps.some(step => ['warning', 'failed', 'unknown'].includes(displayState(step)));
	const runStatus = !result ? 'Ready' : busy ? 'Running' : startupError || hasIssues ? 'Needs review' : 'Finished';
	const nodes: Node[] = steps.map(step => ({
		id: step.id,
		position: positions[step.id],
		ariaLabel: step.label + ', ' + labels[displayState(step)],
		data: { label: <div className="node-content">
			<strong>{step.label}</strong>
			<StepStatus step={step}/>
			<small title={step.summary}>{step.summary}</small>
		</div> },
		className: 'investigation-node ' + displayState(step) + (panel === 'evidence' && active.id === step.id ? ' is-inspected' : ''),
		selected: panel === 'evidence' && active.id === step.id,
	}));
	const edges: Edge[] = steps.flatMap(step => step.dependencies.map(source => ({
			id: source + '-' + step.id,
			source,
			target: step.id,
			type: 'smoothstep',
			markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
			animated: step.state === 'running',
			className: step.state === 'running' ? 'active-edge' : '',
	})));

	return <section className="investigation-workspace">
		{ticket && <details className="investigation-ticket">
			<summary>Fictional ticket: {ticket.subject}</summary>
			<p>{ticket.description}</p>
			<dl className="trace-list">
				<dt>Ticket ID</dt><dd>{ticket.id}</dd>
				<dt>Customer email</dt><dd>{ticket.customer.email}</dd>
				<dt>Status</dt><dd>{ticket.status.replaceAll('_', ' ')}</dd>
				<dt>Category</dt><dd>{ticket.category}</dd>
				<dt>Priority</dt><dd>{ticket.priority}</dd>
				<dt>Related investigations</dt><dd>{ticket.investigations.length}</dd>
			</dl>
		</details>}
		<form className="investigation-launch" onSubmit={event => { event.preventDefault(); void run(); }}>
			<div className="launch-main">
				{!demoOnly && <div className="launch-target">
					<label htmlFor={inputId}>Email address or Auth0 user ID</label>
					<div className="row">
						<input id={inputId} data-investigation-target required value={email} onChange={event => { setEmail(event.target.value); setInputError(''); }}
							placeholder="name@example.com or auth0|123" aria-invalid={!!inputError}
							aria-describedby={inputError ? inputId + '-error' : undefined}/>
						<button className="primary" disabled={!connected || busy}>Start investigation</button>
					</div>
					{inputError && <p id={inputId + '-error'} role="alert">{inputError}</p>}
				</div>}
				<div className="launch-actions">
					{onReturn && <button type="button" disabled={busy} onClick={onReturn}>Return to ticket</button>}
					{!initialResult && <button type="button" disabled={busy} onClick={() => void run(true)}>Run offline example</button>}
				</div>
			</div>
			{!demoOnly && <div className="investigation-options">
				<label><input type="checkbox" checked={useAi} disabled={busy}
					onChange={event => setUseAi(event.target.checked)}/> AI Analysis for live investigations</label>
			</div>}
		</form>
		{startupError && <div className="banner error" role="alert">{startupError}</div>}

		<div className="investigation-board">
			<div className="run-header">
				<div className="run-target">
					<div className="run-source">{result && offline ? 'Fictional offline example' : demoOnly ? 'Offline investigation' : 'Read-only investigation'}</div>
					<h2>{result?.target ?? 'Sign-in investigation'}</h2>
				</div>
				<div className="run-progress" role="status">
					<strong>{runStatus}</strong>
					{result && <><progress value={settled} max={steps.length} aria-label="Steps settled"/><span>{settled} / {steps.length} settled</span></>}
				</div>
				<button type="button" className="summary-jump" onClick={() => { setPanel('summary'); detailRef.current?.focus(); }}>View findings</button>
			</div>
			{result && offline && <p className="offline-notice">All account details and events are fictional. No engine or model was contacted.</p>}
			<div className="workspace-grid">
				<div className="graph-panel">
					<div className="graph-toolbar">
						<h3>Investigation flow</h3>
						<div className="workspace-switch" role="group" aria-label="Workflow view">
							<button type="button" aria-pressed={!listView} onClick={() => setListView(false)}>Graph</button>
							<button type="button" aria-pressed={listView} onClick={() => setListView(true)}>Steps</button>
						</div>
					</div>
					{listView ? <ol className="workflow-steps">{steps.map(step => <li key={step.id}>
						<button type="button" aria-pressed={panel === 'evidence' && selected === step.id} onClick={() => selectStep(step.id)}>
							<strong>{step.label}</strong><StepStatus step={step}/><small>{step.summary}</small>
						</button>
					</li>)}</ol> : <div className="graph-canvas" onKeyDownCapture={event => {
						const node = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');
						if (node?.dataset.id && (event.key === 'Enter' || event.key === ' ')) {
							event.preventDefault();
							event.stopPropagation();
							selectStep(node.dataset.id as NodeId);
						}
					}}>
						{visible && <ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, node) => selectStep(node.id as NodeId)}
							nodesConnectable={false} nodesDraggable={false} edgesFocusable={false} deleteKeyCode={null}
							fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.25} maxZoom={1.6}
							preventScrolling={false} zoomOnScroll={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}>
							<Background gap={20} size={1} color="var(--flow-dot)"/>
							<Controls showInteractive={false} aria-label="Graph zoom and fit controls"/>
						</ReactFlow>}
					</div>}
					<p className="graph-footer">Select a step to inspect evidence. Drag to pan or use Fit view to reset.</p>
				</div>
				<aside className="inspector" aria-label="Investigation details" tabIndex={-1} ref={detailRef}>
					<div className="workspace-switch inspector-switch" role="group" aria-label="Investigation details view">
						<button type="button" aria-pressed={panel === 'summary'} onClick={() => setPanel('summary')}>Summary</button>
						<button type="button" aria-pressed={panel === 'evidence'} onClick={() => setPanel('evidence')}>Step evidence</button>
					</div>
					{panel === 'evidence' ? <Inspector key={active.id} step={active} result={result}/> : <div className="findings-summary">
						<h3>Findings</h3>
						{recommendation && <section className="summary-next" aria-label="Follow-up decision">
							<h4>{recommendation.status}</h4>
							<p>{recommendation.reason}</p>
							{recommendation.actions.length > 0 && <ul aria-label="Proposed actions">
								{recommendation.actions.map(action => <li key={action.source}>
									<p>{action.text}</p>
									<button type="button" onClick={() => selectStep(action.source, true)}>View {steps.find(step => step.id === action.source)?.label}</button>
								</li>)}
							</ul>}
						</section>}
						{!result ? <p>Enter an account identifier to investigate, or run the offline example with fictional data.</p> : <>
							<p>{steps.find(step => step.id === 'profile')?.state === 'completed' ? 'The account profile matched the requested identity.' : 'Account identity has not been established.'}</p>
							<p>{runStatus === 'Running' ? 'Evidence appears here as steps finish.' : 'The evidence below describes what the checks observed. A root cause requires human review.'}</p>
							{observations.length ? <ul>{observations.map((finding, index) => <li key={index}>
								<span className={'finding-kind ' + finding.category.replace(' ', '-')}>{finding.category === 'inconclusive' ? 'Evidence gap' : finding.category}</span>
								<p>{finding.text}</p>
								<button type="button" onClick={() => selectStep(finding.source, true)}>{steps.find(step => step.id === finding.source)?.label} <span aria-hidden="true">↗</span></button>
							</li>)}</ul> : <p>No account evidence is available yet.</p>}
						</>}
						{result && (showDiagnosis || result.diagnosis) && <section className="interpretation">
							<h4>{offline ? 'Example AI Analysis' : 'AI Analysis'} · Unverified</h4>
							{result.diagnosis ? <AnalysisDetails text={result.diagnosis}/> : <p>{steps.find(step => step.id === 'diagnosis')?.summary}</p>}
						</section>}
					</div>}
				</aside>
			</div>
		</div>
	</section>;
}
