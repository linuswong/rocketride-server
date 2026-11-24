import React, { useEffect, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MarkerType, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
	execute,
	assessPlan,
	findings,
	fixtureTools,
	layers,
	fullInvestigationPlan,
	MAX_AUTOMATIC_FOLLOWUPS,
	recommendedAction,
	refFor,
	type Model,
	type Results,
	type Step,
	type InvestigationContext,
	isManual,
} from './lensPlan';
import type { ToolClient } from './operations';
import { classifyAnomaly, classifications } from './anomalyClassification';
import { fixtureAgent, MAX_AGENT_REQUESTS, runInvestigationAgent, sourceAccountLinks, type AgentOutcome } from './investigationAgent';
import { accountRepetition } from './sourceInvestigation';
import { validateTarget } from './investigation';
import type { AccountLeadLink } from './accountPrefill';

const setting = (value:boolean | null | undefined) => value==null ? 'unknown' : value ? 'enabled' : 'disabled';

export function LensInvestigation({
	anomaly: a,
	model,
	client,
	start,
	back,
	contextValid = () => true,
	snapshotEvents,
	openAccountLead,
}: {
	anomaly: InvestigationContext;
	model?: Model;
	client: ToolClient | null;
	start: () => Promise<string>;
	back: () => void;
	contextValid?: () => boolean;
	snapshotEvents?: import('./loginLensAnalytics').Event[];
	openAccountLead?: (userId:string, link:Exclude<AccountLeadLink,'submitted_email'>) => void;
}) {
	const [plan, setPlan] = useState<Step[]>([]),
		[results, setResults] = useState<Results>({});
	const [phase, setPhase] = useState('Evidence review'),
		[selected, select] = useState('');
	const [error, setError] = useState(''),
		[report, setReport] = useState<Awaited<ReturnType<typeof findings>>>([]);
	const [useAgent, setUseAgent] = useState(false);
	const [agentMessage, setAgentMessage] = useState('');
	const [agentOutcome, setAgentOutcome] = useState<AgentOutcome>();
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
	async function run(fullPlan?: Step[]) {
		if (lock.current || (!fullPlan && phase !== 'Proposed')) return;
		if (!contextValid()) { setError('The selected events no longer match the loaded snapshot. Select them again.'); return; }
		lock.current = true;
		setError('');
		setAgentOutcome(undefined); setAgentMessage('');
		setPhase('Executing');
		let executionStarted = false;
		try {
			const token = model ? await start() : 'fixture';
			if (!active.current || !contextValidRef.current()) throw new Error('The selected evidence no longer matches the loaded snapshot.');
			executionStarted = true;
			let workingPlan = fullPlan ?? plan;
			const tools = model ? client! : fixtureTools(a);
			let r = await execute(
				workingPlan,
				a,
				tools,
				token,
				setResults,
				() => active.current && contextValidRef.current(),
				undefined,
				snapshotEvents
			);
			if (!active.current) return;
			if (!contextValidRef.current()) throw new Error('The selected evidence no longer matches the loaded snapshot.');
			if (!model || useAgent) {
			 const outcome = await runInvestigationAgent({context:a,plan:workingPlan,results:r,model:model ?? fixtureAgent(),
			  active:()=>active.current && contextValidRef.current(),
			  update:(nextPlan,nextResults,message)=>{ if (active.current && contextValidRef.current()) {setPlan(nextPlan);setResults(nextResults);setAgentMessage(message);} },
			  perform:async(nextPlan,previous)=>{
			   let latest=previous;
			   try { return await execute(nextPlan,a,tools,token,next=>{latest=next;setResults(next);},()=>active.current && contextValidRef.current(),undefined,snapshotEvents,previous); }
			   catch (failure) {
			    if (!active.current || !contextValidRef.current()) throw failure;
			    const id=nextPlan.at(-1)!.id;
			    latest={...latest,[id]:{state:'failed',detail:'The follow-up stopped unexpectedly; its remote work may still be running.'}};
			    setResults(latest); return latest;
			   }
			  },
			 });
			 if (!active.current) return;
			 if (!contextValidRef.current()) throw new Error('The selected evidence no longer matches the loaded snapshot.');
			 workingPlan=outcome.plan; r=outcome.results; setPlan(workingPlan); setResults(r); setAgentOutcome(outcome); setAgentMessage('');
			}
			setReport(await findings(workingPlan, r, undefined, a));
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
	const current = plan.find((s) => s.id === selected);
	const fallback = recommendedAction(plan, results);
	const accountLinks = sourceAccountLinks(plan,results);
	const selectedResult=results[selected];
	const retryIntervals=[selectedResult?.facts?.retryAfterSeconds,selectedResult?.facts?.historyRetryAfterSeconds,selectedResult?.facts?.allowlistRetryAfterSeconds,selectedResult?.facts?.aclRetryAfterSeconds,selectedResult?.accountEvidence?.eventRetryAfterSeconds,selectedResult?.accountEvidence?.accountRetryAfterSeconds,selectedResult?.accountEvidence?.detailRetryAfterSeconds,selectedResult?.historyEvidence?.retryAfterSeconds].filter((value):value is number=>typeof value==='number' && Number.isFinite(value));
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
						<strong>{s.tool === 'investigate_source_accounts' ? 'Account pattern follow-up' : s.tool === 'investigate_source_group' ? `Source group ${s.sourceRank} follow-up` : s.tool === 'investigate_account_history' ? `Older account activity · page ${(s.historyPage ?? 0) + 1}` : s.tool}</strong>
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
			style: { stroke: 'var(--ll-accent, #3da54e)' },
		}))
	);
	return (
		<div className="lens lens-case">
			<button className="lens-back" onClick={back}>← Investigation options</button>
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
								{Object.values(results).filter((r) => r.state === 'failed' || r.state === 'skipped' || r.state === 'partial').length}{' '}
								incomplete, failed or skipped
							</small>
						)}
					</div>
					{phase === 'Evidence review' && (
						<button className="primary" onClick={() => { try { const all = fullInvestigationPlan(a); setPlan(all); void run(all); } catch { setError('The selected evidence is invalid or unavailable.'); } }}>
							Run all available checks
						</button>
					)}
					{phase === 'Proposed' && (
						<button className="primary" onClick={() => void run()}>
							Approve and run {plan.length} checks
						</button>
					)}
				</div>
				{phase === 'Proposed' && <p>The checks use the selected snapshot and read-only Auth0 data.</p>}
				{!plan.length && (
					<p>
						{model ? 'Run read-only checks and automatically follow the largest source through account profiles, blocks and recent events.' : 'Run the investigation and iterative follow-ups against fictional local fixture responses.'}
					</p>
				)}
				{model && phase === 'Evidence review' && <p>Account follow-up may read up to 400 recent failure details. It can retry one rate limit of up to 30 seconds and stops if Auth0 remains rate limited or becomes unavailable.</p>}
				{model && phase === 'Evidence review' && <label className="lens-agent-consent"><input type="checkbox" checked={useAgent} onChange={event=>setUseAgent(event.target.checked)}/> Run automatic follow-up, up to {MAX_AUTOMATIC_FOLLOWUPS} additional checks and {MAX_AGENT_REQUESTS} Gemini requests. Event categories, timestamps, anonymous account and submitted-identifier counts, and aggregate check results are sent to Gemini; account IDs, usernames and IPs are excluded. Provider charges may apply. Enable this option to use Gemini; otherwise these checks run without model follow-up.</label>}
				{agentMessage && <p role="status">{agentMessage}</p>}
				{error && <p role="alert">{error}</p>}
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
								<Background color="#2b2e2c" />
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
						<h3>{current.tool === 'investigate_source_accounts' ? 'Account pattern follow-up' : current.tool === 'investigate_source_group' ? `Source group ${current.sourceRank} follow-up` : current.tool === 'investigate_account_history' ? `Older account activity · page ${(current.historyPage ?? 0) + 1}` : current.tool}</h3>
						<p>{current.purpose}</p>
						<p>
							Depends on {current.depends.join(', ') || 'approval'} · {current.ref ?? current.period ?? 'No parameters'}
						</p>
						{current.expected && <p>Expected evidence: {current.expected}</p>}
						<strong>{results[selected]?.detail ?? 'Awaiting approval'}</strong>
						{(current.tool === 'analyze_source_groups' || current.tool === 'investigate_source_group') && results[selected]?.facts && <div className="lens-source-result"><p>Source IP: <strong>{String(results[selected].facts?.sourceIp ?? 'Unavailable')}</strong></p>{results[selected].facts?.windowFailures !== undefined && <p>Same source in selected window: {String(results[selected].facts?.windowFailures)} failed and {String(results[selected].facts?.windowSuccesses)} successful sign-ins · {String(results[selected].facts?.windowFailureRate)}% failure rate. Loaded snapshot only; coverage may be incomplete.</p>}<p>Auth0 brute-force trusted list: <strong>{results[selected].facts?.bruteForceAllowlisted === true ? 'Matched' : results[selected].facts?.bruteForceAllowlisted === false ? 'No match' : 'Unknown'}</strong> · IP throttling trusted list: <strong>{results[selected].facts?.throttlingAllowlisted === true ? 'Matched' : results[selected].facts?.throttlingAllowlisted === false ? 'No match' : 'Unknown'}</strong></p><p>A trusted-list match does not establish corporate ownership. ASN lookup is unavailable.</p></div>}
						{results[selected]?.facts?.allowlistError && <p>Trusted-list comparison unavailable: {String(results[selected].facts?.allowlistError)}{results[selected].facts?.allowlistError === 'MISSING_SCOPE' ? ' · requires read:attack_protection' : ''}.</p>}
						{retryIntervals.length>0 && <p>Maximum Auth0-reported retry interval for these reads: {Math.ceil(Math.max(...retryIntervals))} seconds.</p>}
						{results[selected]?.facts?.aclCoverage && <p>Tenant ACL range comparison: {String(results[selected].facts?.aclCoverage)}{typeof results[selected].facts?.aclRangeMatches === 'number' ? ` · ${results[selected].facts?.aclRangeMatches} of ${results[selected].facts?.aclRulesChecked} active authentication or tenant rules contain a matching IP range` : ''}{results[selected].facts?.aclError ? ` · ${String(results[selected].facts?.aclError)}` : ''}{results[selected].facts?.aclError === 'MISSING_SCOPE' ? ' · requires read:network_acls' : ''}. A range match does not prove the full rule applied, its action, or corporate ownership; ASN is not resolved.</p>}
						{results[selected]?.accountEvidence && Object.keys(results[selected].accountEvidence!.eventErrors).length > 0 && <p>Event read errors: {Object.entries(results[selected].accountEvidence!.eventErrors).map(([code,count]) => `${code}: ${count}`).join(' · ')}</p>}
						{results[selected]?.accountEvidence?.detailBudgetReached && <p>{results[selected].accountEvidence!.accounts.reduce((sum,account)=>sum+account.recentDetailsUnchecked,0)} recent failure detail(s) were not checked{results[selected].accountEvidence!.detailStopReason ? ` · ${results[selected].accountEvidence!.detailStopReason}` : ''}.</p>}
						{(results[selected]?.accountEvidence?.detailRateRetries ?? 0)>0 && <p>Retried {results[selected].accountEvidence!.detailRateRetries} recent detail read(s) after Auth0's stated rate-limit interval.</p>}
						{(results[selected]?.accountEvidence?.eventRetries ?? 0) > 0 && <p>Temporary event reads retried: {results[selected].accountEvidence!.eventRetries}; {results[selected].accountEvidence!.eventRetryResponsesSucceeded} returned a response. Each returned event still had to pass identity, time and source verification.</p>}
						{(results[selected]?.accountEvidence?.eventRateRetries ?? 0)>0 && <p>Retried {results[selected].accountEvidence!.eventRateRetries} selected event read(s) after Auth0's stated rate-limit interval.</p>}
						{results[selected]?.accountEvidence?.accountStopReason && <p>Account checks stopped after {results[selected].accountEvidence!.accountStopReason}; completed event matches remain available.</p>}
						{results[selected]?.accountEvidence && <p>JA3 client fingerprints: {results[selected].accountEvidence!.ja3Reported} of {results[selected].accountEvidence!.matched} verified source events reported a valid fingerprint; {results[selected].accountEvidence!.ja3Groups} fingerprint group(s), largest group {results[selected].accountEvidence!.ja3LargestGroup}. Shared fingerprints can reflect common software and do not identify an actor or organization.</p>}
						{results[selected]?.accountEvidence && <p>JA4 client fingerprints: {results[selected].accountEvidence!.ja4Reported} of {results[selected].accountEvidence!.matched} verified source events reported a valid fingerprint; {results[selected].accountEvidence!.ja4Groups} fingerprint group(s), largest group {results[selected].accountEvidence!.ja4LargestGroup}. {results[selected].accountEvidence!.matched-results[selected].accountEvidence!.ja4FieldReturned} verified event(s) had no JA4 field returned by the node, so their JA4 coverage is unknown. Shared fingerprints can reflect common software and do not identify an actor or organization.</p>}
						{(results[selected]?.accountEvidence?.fingerprintFallbacks ?? 0)>0 && <p>The Auth0 node rejected the fingerprint option; account correlation continued without fingerprint data.</p>}
						{results[selected]?.accountEvidence && <p>Later account success: {results[selected].accountEvidence!.accounts.filter(account=>account.successAfterSelected==='verified').length} verified account(s), including {results[selected].accountEvidence!.accounts.filter(account=>account.successAfterSelectedSameSource===true).length} with the same source and {results[selected].accountEvidence!.accounts.filter(account=>account.successAfterSelectedSameApplication===true).length} with the same application ID; {results[selected].accountEvidence!.accounts.filter(account=>account.successAfterSelected==='unverified').length} candidate(s) could not be verified. The returned page is limited; matching source or application does not prove that the same device or credential was used.</p>}
						{results[selected]?.accountEvidence?.accounts.some(account=>account.successAfterSelected==='verified') && <details><summary>View accounts with later success</summary><ul>{results[selected].accountEvidence!.accounts.filter(account=>account.successAfterSelected==='verified').map(account=><li key={account.userId}>{account.userId}</li>)}</ul></details>}
						{results[selected]?.accountEvidence && <details><summary>View reported applications</summary><p>Names come from checked source events and may not uniquely identify an application. {results[selected].accountEvidence!.missingApplication} verified event(s) had no usable application name.</p><ul>{results[selected].accountEvidence!.reportedApplications.map(item=><li key={item.name}>{item.name}: {item.count} event(s)</li>)}</ul>{results[selected].accountEvidence!.accounts.filter(account=>account.reportedApplications.length>0).map(account=><p key={account.userId}>{account.userId}: {account.reportedApplications.map(item=>`${item.name} (${item.count})`).join(', ')}</p>)}</details>}
						{results[selected]?.accountEvidence && <details><summary>View reported application IDs</summary><p>IDs are from checked source events. {results[selected].accountEvidence!.missingApplicationId} verified event(s) had no usable application ID. {results[selected].accountEvidence!.applicationFallbacks>0 ? 'The node rejected the application ID option; other checks continued. ' : ''}An event application is not necessarily the application configured for LoginLens.</p><ul>{results[selected].accountEvidence!.reportedApplicationIds.map(item=><li key={item.id}>{item.id}: {item.count} event(s)</li>)}</ul>{results[selected].accountEvidence!.accounts.filter(account=>account.reportedApplicationIds.length>0).map(account=><p key={account.userId}>{account.userId}: {account.reportedApplicationIds.map(item=>`${item.id} (${item.count})`).join(', ')}</p>)}</details>}
						{results[selected]?.accountEvidence && results[selected].accountEvidence!.reportedApplicationIds.length>0 && <details><summary>View application settings checks</summary><p>Current settings do not prove which flow was used or whether credentials are stale. {results[selected].accountEvidence!.applicationConfigUnchecked} application(s) were not checked.</p><ul>{results[selected].accountEvidence!.applicationConfigs.map(config=><li key={config.id}>{config.id}: {config.status==='verified' ? `type ${config.appType ?? 'unknown'}; token authentication ${config.authMethod ?? 'unknown'}; authorization code ${setting(config.authorizationCode)}; password ${setting(config.password)}; refresh token ${setting(config.refreshToken)}; client credentials ${setting(config.clientCredentials)}` : `unavailable${config.error ? ` (${config.error})` : ''}${config.error==='MISSING_SCOPE' ? ' — requires read:clients' : ''}${config.error==='FEATURE_UNAVAILABLE' ? ' — update the Auth0 node' : ''}`}</li>)}</ul></details>}
						{(current.tool === 'investigate_source_accounts' || current.tool === 'investigate_source_group') && results[selected]?.accountEvidence && <div className="lens-source-result">{(() => { const evidence = results[selected].accountEvidence!; return <><p>{evidence.checked} of {evidence.selected} selected failures checked; {evidence.matched} matched this source, {evidence.missingIdentity} could not be resolved to an account, {evidence.emailHintResolved} were linked by exact email as candidates, {evidence.failedEvents} could not be verified and {evidence.differentSource} had a different source.</p>{evidence.missingIdentity > 0 && <p>Unresolved: {evidence.unusableIdentifiers} missing or unsupported usernames · {evidence.ambiguousHints} ambiguous email matches · {evidence.unmatchedHints} unmatched email hints · {evidence.hintLookupFailures} lookup failures{evidence.hintLookupError ? ` (${evidence.hintLookupError})` : ''}.</p>}{evidence.unresolvedIdentifiers.length > 0 && <><h4>Unresolved submitted identifiers</h4><ul>{evidence.unresolvedIdentifiers.map(item => <li key={item.identifier}>{item.identifier}: {item.count} attempt(s) · {item.reason}</li>)}</ul><p>Submitted identifiers show what was targeted; they do not verify an account or the person who made the attempt.</p></>}<div className="lens-other-table"><table><thead><tr><th>Account ID</th><th>Selected failures</th><th>Recent failures</th><th>Recent same-source failures</th><th>Profile / blocks</th></tr></thead><tbody>{evidence.accounts.map(account => <tr key={account.userId}><td>{account.userId}</td><td>{account.selectedFailures} ({account.directFailures} direct · {account.emailHintFailures} email candidate)<br />Direct types: {account.directFailureTypes.wrongPassword} wrong password · {account.directFailureTypes.unknownUser} unknown user · {account.directFailureTypes.failedLogin} other failed login</td><td>{account.logs === 'retrieved' ? account.recentFailures : 'Unavailable'}</td><td>{account.sameSourceRecentFailures} of {account.recentDetails} verified{account.recentDetailsFailed ? ` · ${account.recentDetailsFailed} unavailable` : ''}</td><td>{account.profile !== 'verified' ? `Profile ${account.profile}` : `Admin block: ${account.blocked ? 'yes' : 'no'} · Brute-force block: ${account.bruteForceBlocked === null ? 'unknown' : account.bruteForceBlocked ? 'yes' : 'no'}`}{openAccountLead && account.profile === 'verified' && !validateTarget(account.userId,'user_id') && (account.directFailures > 0 || account.emailHintFailures > 0) && <><br/><button type="button" disabled={!contextValid()} onClick={() => {if (contextValid()) openAccountLead(account.userId, account.directFailures && account.emailHintFailures ? 'mixed' : account.directFailures ? 'direct' : 'email_candidate');}}>Prepare account investigation</button></>}</td></tr>)}</tbody></table></div>{evidence.accounts.filter(account => account.profileError || account.logsError || account.blocksError || account.invalidRecentEvents || account.recentDetailsUnchecked || account.logsPageFull || account.logsEmpty).map(account => <p key={account.userId}>{account.userId}: {[account.profileError, account.logsError, account.blocksError, account.invalidRecentEvents ? `${account.invalidRecentEvents} recent event(s) were duplicate or had invalid ID or time` : undefined, account.recentDetailsUnchecked ? `${account.recentDetailsUnchecked} recent failure detail(s) were not checked` : undefined, account.logsPageFull ? 'Recent log page was full' : undefined, account.logsEmpty ? 'No recent user logs returned' : undefined].filter(Boolean).join(' · ')}</p>)}<p>Unchecked: {evidence.unchecked} selected events and {evidence.uncheckedAccounts} accounts. Recent source detail checks {evidence.detailBudgetReached ? 'incomplete' : 'completed for the returned page'}. Email candidates match a unique profile but do not prove who initiated an attempt. Recent logs are one page and may omit older events.</p></>; })()}</div>}
						{current.tool === 'investigate_account_history' && results[selected]?.historyEvidence && <p>Older page: {results[selected].historyEvidence!.returned} returned · {results[selected].historyEvidence!.matchingSource} additional same-source failures · {results[selected].historyEvidence!.duplicates} previously seen · {results[selected].historyEvidence!.unavailable} unverified · {results[selected].historyEvidence!.unchecked} unchecked{results[selected].historyEvidence!.stopReason ? ` · stopped: ${results[selected].historyEvidence!.stopReason}` : ''}. {results[selected].historyEvidence!.pageFull ? 'The page is full; older results may remain.' : 'The page was short; retention and indexing remain unverified.'}</p>}
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
					<section aria-label="Recommended action"><h4>Recommended action</h4>{agentOutcome?.recommendation && !fallback.kind ? <><p>{agentOutcome.recommendation.action}</p><p>{agentOutcome.recommendation.reason}</p><p>Uncertainty: {agentOutcome.recommendation.uncertainty}</p><p>{model ? 'AI-generated interpretation; verify it against the recorded evidence before acting.' : 'Fictional example interpretation.'}</p>{agentOutcome.recommendation.references.map(ref=><button key={ref} onClick={() => {select(ref);workRef.current?.scrollIntoView({block:'start'});}}>Inspect {ref} ↑</button>)}</> : <><p>{fallback.action}</p><p>{fallback.reason}</p>{fallback.reference && <button onClick={() => { select(fallback.reference!); workRef.current?.scrollIntoView({block:'start'}); }}>Inspect supporting check ↑</button>}</>}{agentOutcome && <p>{agentOutcome.status === 'concluded' ? `Automatic follow-up completed in ${agentOutcome.requests} reasoning round(s).${agentOutcome.message ? ` ${agentOutcome.message}` : ''}` : `${agentOutcome.message ?? 'Automatic follow-up stopped.'} ${agentOutcome.requests} reasoning round(s) used.`}</p>}</section>
					{results['source-accounts']?.accountEvidence && <p>Account follow-up: {results['source-accounts'].accountEvidence!.matched} source failures verified, with {results['source-accounts'].accountEvidence!.accounts.length} reported account ID(s) and {results['source-accounts'].accountEvidence!.accounts.filter(account => account.profile === 'verified').length} verified profile(s). Repetition: {results['source-accounts'].accountEvidence!.accounts.filter(account => accountRepetition(account) === 'verified').length} verified account(s), {results['source-accounts'].accountEvidence!.accounts.filter(account => accountRepetition(account) === 'candidate').length} email-linked candidate(s), and {results['source-accounts'].accountEvidence!.accounts.filter(account => accountRepetition(account) === 'unverified').length} unverified profile(s). {results['source-accounts'].accountEvidence!.missingIdentity} selected event(s) could not be resolved to an account.</p>}
					{accountLinks.length>0 && <><p>Cross-source account comparison: {accountLinks.map(item=>`source group ${item.sourceRank}: ${item.accountIds.length} verified account(s) also directly linked to the largest group`).join(' · ')}. Counts cover checked events only; shared accounts do not identify who made the attempts.</p>{accountLinks.some(item=>item.accountIds.length>0) && <details><summary>View shared account IDs</summary><ul>{accountLinks.filter(item=>item.accountIds.length>0).map(item=><li key={item.sourceCheck}>Source group {item.sourceRank}: {item.accountIds.join(', ')}</li>)}</ul></details>}</>}
					<p>{model ? 'Deterministic summaries of the recorded results.' : 'Example findings from the local fixture.'}</p>
					<details><summary>View recorded result summaries</summary>
					{!report.length && <p>No findings available. Review the recorded step outcomes.</p>}
					{report.map((r) => (
						<article key={r.id}>
							<h4>{r.observation}</h4>
							<button onClick={() => { select(r.id); workRef.current?.scrollIntoView({ block: 'start' }); }}>Inspect evidence: {r.id} ↓</button>
						</article>
					))}
					</details>
					<p>{a.limitation} Remediation requires human review.</p>
					{assessment.gaps.length > 0 && <details><summary>What remains unchecked</summary><ul>{assessment.gaps.map(item => <li key={item}>{item}</li>)}</ul></details>}

				</section>
			)}

		</div>
	);
}
