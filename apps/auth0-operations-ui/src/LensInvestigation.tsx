import React, { useEffect, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MarkerType, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
	execute,
	assessPlan,
	findings,
	fixtureTools,
	layers,
	propose,
	refFor,
	type Model,
	type Results,
	type Step,
	type InvestigationContext,
	isManual,
} from './lensPlan';
import type { ToolClient } from './operations';
import { classifyAnomaly, classifications } from './anomalyClassification';
import { GraphValidationError, PlannerError, type PlannerDiagnostic } from './plannerResponse';

export function LensInvestigation({
	anomaly: a,
	model,
	analysisModel,
	client,
	start,
	back,
	contextValid = () => true,
}: {
	anomaly: InvestigationContext;
	model?: Model;
	analysisModel?: Model;
	client: ToolClient | null;
	start: () => Promise<string>;
	back: () => void;
	contextValid?: () => boolean;
}) {
	const [plan, setPlan] = useState<Step[]>([]),
		[results, setResults] = useState<Results>({});
	const [diagnostic, setDiagnostic] = useState<PlannerDiagnostic>();
	const [phase, setPhase] = useState('Evidence review'),
		[selected, select] = useState('');
	const [error, setError] = useState(''),
		[report, setReport] = useState<Awaited<ReturnType<typeof findings>>>([]);
	const [aiReport, setAiReport] = useState<Awaited<ReturnType<typeof findings>>>([]);
	const [aiConsent, setAiConsent] = useState(false), [aiBusy, setAiBusy] = useState(false), [aiError, setAiError] = useState('');
	const [aiDiagnostic, setAiDiagnostic] = useState<Partial<PlannerDiagnostic>>({});
	const active = useRef(true),
		lock = useRef(false);
	const contextValidRef = useRef(contextValid);
	contextValidRef.current = contextValid;
	const workRef = useRef<HTMLElement>(null);
	const classification = isManual(a) ? undefined : classifyAnomaly(a);
	const assessment = assessPlan(plan, a);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	async function prepare() {
		if (lock.current) return;
		if (!contextValid()) { setError('The selected events no longer match the loaded snapshot. Select them again.'); return; }
		lock.current = true;
		setError('');
		setPhase('Planning');
		const initial: PlannerDiagnostic = {correlationId:crypto.randomUUID(),provider:'llm_gemini',profile:'models-gemini-3-1-flash-lite',dispatch:'not_dispatched',response:'not_received',finishReason:'unavailable',parse:'not_attempted',schema:'not_checked'};
		if (model) setDiagnostic(initial);
		const update = (patch: Partial<PlannerDiagnostic>) => { if (active.current) setDiagnostic(previous => ({...initial,...previous,...patch})); };
		try {
			const p = await propose(a, model, model ? update : undefined);
			if (active.current) {
				setPlan(p);
				setPhase('Proposed');
			}
		} catch (error) {
			if (active.current) {
				const message = error instanceof Error ? error.message : '';
				setError(error instanceof PlannerError ? error.message : message.startsWith('Gemini pipeline ') ? message : 'Planner response invalid or unavailable. Review the evidence or try again.');
				if (model) update({category:error instanceof GraphValidationError ? error.issue.category : error instanceof PlannerError ? error.category : 'task_failure'});
				setPhase('Evidence review');
			}
		} finally {
			lock.current = false;
		}
	}
	async function run() {
		if (lock.current || phase !== 'Proposed') return;
		if (!contextValid()) { setError('The selected events no longer match the loaded snapshot. Select them again.'); return; }
		lock.current = true;
		setError('');
		setPhase('Executing');
		let executionStarted = false;
		try {
			const token = model ? await start() : 'fixture';
			if (!active.current || !contextValidRef.current()) throw new Error('The selected evidence no longer matches the loaded snapshot.');
			executionStarted = true;
			const r = await execute(
				plan,
				a,
				model ? client! : fixtureTools(a),
				token,
				setResults,
				() => active.current
			);
			if (!active.current) return;
			setReport(await findings(plan, r, undefined, a));
			if (active.current) setPhase('Completed');
		} catch (error) {
			if (active.current) {
				setPhase(executionStarted ? 'Completed' : 'Proposed');
				const message = error instanceof Error ? error.message : '';
				setError(executionStarted ? 'Execution stopped unexpectedly. Inspect the recorded results; calls may still be running.' : message === 'The selected evidence no longer matches the loaded snapshot.' ? message : message.startsWith('RocketRide task creation:') ? message : 'Investigation execution could not start. Check the engine before retrying.');
			}
		} finally {
			lock.current = false;
		}
	}
	async function generateFindings() {
		if (!analysisModel || !aiConsent || aiBusy || phase !== 'Completed' || !Object.values(results).some(result => result.state === 'success')) return;
		if (!contextValid()) { setAiError('The selected evidence no longer matches the loaded snapshot.'); return; }
		setAiBusy(true); setAiConsent(false); setAiError(''); setAiDiagnostic({});
		try {
			const summary = await findings(plan, results, (instructions, payload) => analysisModel(instructions, payload, patch => { if (active.current) setAiDiagnostic(previous => ({...previous, ...patch})); }), a);
			if (active.current) setAiReport(summary);
		} catch (error) {
			if (active.current) setAiError(error instanceof PlannerError ? error.message + ' The recorded evidence remains available.' : 'The AI response was invalid or unavailable. The recorded evidence remains available.');
		} finally { if (active.current) setAiBusy(false); }
	}
	const current = plan.find((s) => s.id === selected);
	const nodes = layers(plan).flatMap((level, col) =>
		level.map((s, row) => ({
			id: s.id,
			position: { x: col * 270, y: row * 160 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			className: 'lens-node ' + (results[s.id]?.state ?? 'pending') + (selected === s.id ? ' selected' : ''),
			data: {
				label: (
					<>
						<small>{results[s.id]?.state ?? 'Proposed'}</small>
						<strong>{s.tool}</strong>
						<span>{results[s.id]?.detail ?? s.purpose}</span>
					</>
				),
			},
		}))
	);
	const edges = plan.flatMap((s) =>
		s.depends.map((d) => ({
			id: d + '-' + s.id,
			source: d,
			target: s.id,
			animated: results[s.id]?.state === 'running',
			markerEnd: { type: MarkerType.ArrowClosed },
			style: { stroke: '#67bff5' },
		}))
	);
	return (
		<div className="lens lens-case">
			<button onClick={back}>← Investigation options</button>
			<div className="lens-case-head">
				<span className="lens-kicker">{model ? 'TENANT SNAPSHOT' : 'OFFLINE FIXTURE'} / {isManual(a) ? 'MANUAL INVESTIGATION' : 'ANOMALY DETAIL'}</span>
				<h1>{isManual(a) ? 'Manual activity investigation' : a.rule}</h1>
				{classification && <p>Classification: {classifications[classification.primary].label}{classification.secondary.map(id => ', ' + classifications[id].label)}</p>}
				<p>
					{isManual(a) ? 'No anomaly is asserted. ' : a.explanation + ' '}{a.limitation}
				</p>
				<div className="lens-meta">
					{!isManual(a) && a.severity + ' priority · '}{a.events.length} events · {new Date(a.start).toISOString()} –{' '}
					{new Date(a.end).toISOString()}
				</div>
			</div>
			<details className="lens-card">
				<summary>Supporting events ({a.events.length})</summary>
				{a.events.map((e, i) => (
					<div className="lens-category" key={e.id}>
						<b>{refFor(i)}</b>
						<span>{e.category}</span>
						<time>{new Date(e.time).toISOString()}</time>
					</div>
				))}
			</details>
			<section ref={workRef} className="lens-card lens-work">
				<div className="lens-card-head">
					<div>
						<span className="lens-kicker">INVESTIGATION GRAPH</span>
						<h3>{phase}</h3>
						{Object.keys(results).length > 0 && (
							<small>
								{Object.values(results).filter((r) => r.state === 'success').length} of {plan.length} checks
								succeeded ·{' '}
								{Object.values(results).filter((r) => r.state === 'failed' || r.state === 'skipped').length}{' '}
								failed or skipped
							</small>
						)}
					</div>
					{phase === 'Evidence review' && (
						<button className="primary" onClick={() => void prepare()}>
							{model ? 'Propose AI investigation' : 'Propose fixture investigation'}
						</button>
					)}
					{phase === 'Proposed' && (
						<button className="primary" onClick={() => void run()}>
							Approve and run {plan.length} checks
						</button>
					)}
				</div>
				{phase === 'Proposed' && <p>{model ? 'Approved Auth0 reads use the read-only task; source grouping uses the selected snapshot.' : 'Auth0 checks use fictional fixture responses; source grouping uses the selected snapshot.'} AI findings require separate authorization.</p>}
				{!plan.length && (
					<p>
						{model
							? 'The planner proposes read-only checks. Running them does not invoke an AI model; AI findings require a separate action. The planner requires an engine that supports a one-attempt Gemini limit.'
							: 'Explore a rule-specific example plan using local fixture responses.'}
					</p>
				)}
				{error && <p role="alert">{error}</p>}
				{diagnostic && <details><summary>Sanitized planner diagnostics</summary><pre>{JSON.stringify(diagnostic, null, 2)}</pre><p>Chat dispatches are not provider call or billing counts. Task tokens and response bodies are omitted.</p></details>}
				{plan.length > 0 && (
					<>
						<details className="lens-card">
							<summary>What this plan can check and what remains unresolved</summary>
							<ul>{assessment.capabilities.map(item => <li key={item}>{item}</li>)}</ul>
							<ul>{assessment.gaps.map(item => <li key={item}>{item}</li>)}</ul>
						</details>
						<div className="lens-graph">
							<ReactFlow
								nodes={nodes}
								edges={edges}
								fitView
								nodesDraggable={false}
								nodesConnectable={false}
								onNodeClick={(_, n) => select(n.id)}
								minZoom={0.15}
							>
								<Controls showInteractive={false} />
								<Background color="#39536a" />
							</ReactFlow>
						</div>
						<details>
							<summary>Review proposed calls and dependencies</summary>
							{plan.map((s) => (
								<div key={s.id} className="lens-category">
									<button onClick={() => select(s.id)}>{s.tool}</button>
									<span>
										{s.purpose} · {s.ref ?? s.period ?? 'No arguments'} · After {s.depends.join(', ') || 'approval'}
										{s.expected && <> · Expected: {s.expected}</>}
									</span>
								</div>
							))}
						</details>
					</>
				)}
				{current && (
					<aside className="lens-inspector">
						<button onClick={() => select('')}>Close inspector</button>
						<h3>{current.tool}</h3>
						<p>{current.purpose}</p>
						<p>
							Depends on {current.depends.join(', ') || 'approval'} · {current.ref ?? current.period ?? 'No parameters'}
						</p>
						{current.expected && <p>Expected evidence: {current.expected}</p>}
						<strong>{results[selected]?.detail ?? 'Awaiting approval'}</strong>
						{results[selected]?.facts && <details><summary>Tool result (JSON)</summary><pre>{JSON.stringify(results[selected].facts, null, 2)}</pre></details>}
					</aside>
				)}
			</section>

			{phase === 'Completed' && (
				<section className="lens-card lens-report" aria-label="Investigation summary">
					<span className="lens-kicker">
						{model ? 'INVESTIGATION SUMMARY · TOOL RESULTS' : 'INVESTIGATION SUMMARY · FIXTURE'}
					</span>
					<h3>Evidence and next steps</h3>
					<p>{model ? (aiReport.length ? 'Deterministic summaries of the recorded results. The separately requested AI findings appear below.' : 'Deterministic summaries of the recorded results. AI interpretation is unavailable until separately requested.') : 'Example findings from the local fixture.'}</p>
					<details><summary>View recorded result summaries</summary>
					{!report.length && <p>No findings available. Review the recorded step outcomes.</p>}
					{report.map((r) => (
						<article key={r.id}>
							<h4>{r.observation}</h4>
							<button onClick={() => { select(r.id); workRef.current?.scrollIntoView({ block: 'start' }); }}>Inspect evidence: {r.id} ↓</button>
							<dl>
								<dt>Possible cause</dt>
								<dd>{r.possibleCause}</dd>
								<dt>Uncertainty</dt>
								<dd>{r.uncertainty}</dd>
								<dt>Next step</dt>
								<dd>{r.nextStep}</dd>
								<dt>Possible remediation</dt>
								<dd>{r.possibleRemediation}</dd>
							</dl>
						</article>
					))}
					</details>
					<p>{a.limitation} Remediation requires human review.</p>
					{assessment.gaps.length > 0 && <details><summary>What remains unchecked</summary><ul>{assessment.gaps.map(item => <li key={item}>{item}</li>)}</ul></details>}
					<div className="lens-ai-analysis">
						<div className="lens-ai-heading"><span className="lens-ai-icon" aria-hidden="true">✦</span><div><span className="lens-kicker">AI-ASSISTED ANALYSIS</span><h3>What happened and what to do next</h3></div></div>
						{analysisModel ? <>
							<p>Generate an interpretation of successful checks, with evidence references and suggested follow-up.</p>
							<p>{model ? 'Successful, sanitized tool evidence' : 'Fictional example evidence'} is sent to an external model. This may incur provider charges; the analysis is limited to one provider attempt.</p>
							<label><input type="checkbox" checked={aiConsent} onChange={event => setAiConsent(event.target.checked)} disabled={aiBusy} /> I authorize external model analysis and associated charges.</label>{' '}
							<button className="primary" disabled={!aiConsent || aiBusy || !Object.values(results).some(result => result.state === 'success')} onClick={() => void generateFindings()}>{aiBusy ? 'Analyzing evidence…' : aiReport.length ? 'Generate again' : 'Generate AI analysis ✦'}</button>
							{aiError && <><p role="alert">{aiError}</p><details><summary>Analysis diagnostics</summary><pre>{JSON.stringify(aiDiagnostic, null, 2)}</pre></details></>}
						</> : <p>Connect to the RocketRide engine to generate an AI analysis. No model has been contacted.</p>}
						{aiReport.length > 0 && <section aria-label="AI findings"><p className="lens-ai-disclaimer">AI interpretation may be incomplete. Verify it against the cited evidence before acting.</p>{aiReport.map(item => <article className="lens-ai-finding" key={item.id}>
							<div><span>WHAT THE READ SHOWED</span><p>{item.observation}</p></div>
							<div><span>WHAT IT COULD MEAN</span><p>{item.possibleCause}</p></div>
							<div><span>WHAT TO DO NEXT</span><p>{item.nextStep}</p></div>
							<div><span>WHAT IS UNCERTAIN</span><p>{item.uncertainty}</p></div>
							<button onClick={() => { select(item.id); workRef.current?.scrollIntoView({ block: 'start' }); }}>View evidence: {item.id} ↑</button>
						</article>)}</section>}
					</div>
				</section>
			)}

		</div>
	);
}
