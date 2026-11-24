import React, { useEffect, useRef, useState } from 'react';
import { Background, Controls, MarkerType, Position, ReactFlow } from '@xyflow/react';
import { AnalysisDetails } from './AnalysisDetails';
import { Inspector } from './InvestigationWorkspace';
import { accountCandidates, createInvestigation, executeInvestigation, findings, safeEvidence, targetType, validateTarget, type Investigation, type NodeId, type TargetType } from './investigation';
import { demoAnalysis, demoClient, demoTarget } from './offlineDemo';
import { invokeRead, type Evidence, type ToolClient } from './operations';
import { accountCaseRecommendation, accountCaseSummary, accountEventLabel, accountHistoryDescription, accountTimeComparison, customerReplyDraft, identifierNextSteps, identifierProtectionAdvice, laterAccountSuccess, mfaEvidenceCaveat, matchesReportedApplication, nearReportedTime, recentAccountEvents, reportedIssue, type AccountCaseContext, type ReportedIssueCategory } from './accountCase';
import { accountAnalysisRecords } from './accountAnalysis';
import { parseAnalysisResponse } from './analysisResponse';
import type { HistoryStop } from './investigation';
import { mergeSubmittedEmailPages, observationTime, observedEvidence, pageObservationLines, submittedEmailWindow, submittedEmailWindowDescription, withRefreshFailure } from './submittedEmail';
import { localIncidentCandidates, supportedTimeZones, validTimeZone } from './incidentTime';
import { TelemetryTaskMismatchError, TelemetryTaskTimeoutError } from './telemetryTask';
import { runOptionalIdentifierChecks } from './optionalIdentifierChecks';
import { accountLeadLabel, validSourceEvent, type SourceEvent, type AccountPrefill } from './accountPrefill';

const timeZones = [...new Set(['UTC',...supportedTimeZones()])];

const positions: Partial<Record<NodeId, { x: number; y: number }>> = {
 search: {x: 0, y: 160}, match: {x: 260, y: 160}, 'not-found': {x: 520, y: 0},
 profile: {x: 520, y: 160}, logs: {x: 780, y: 80}, blocks: {x: 780, y: 240}, aggregate: {x: 1040, y: 160},
};

export function AccountInvestigation({active, client, connected, start, analyze, busy, setBusy, prefill}: {
 active: boolean; client: ToolClient | null; connected: boolean; start: () => Promise<string>; prefill?: AccountPrefill;
 analyze: (token: string, evidence: Evidence[], stop?: HistoryStop) => Promise<string>; busy: boolean; setBusy: (value: boolean) => void;
}) {
 const [target, setTarget] = useState('');
 const [targetChoice, setTargetChoice] = useState<TargetType | undefined>();
 const [sourceLink, setSourceLink] = useState<AccountPrefill['link']>();
 const handledPrefill = useRef<string>();
 const [pendingLead, setPendingLead] = useState<AccountPrefill>();
 const [candidateId, setCandidateId] = useState('');
 const [exactLookup, setExactLookup] = useState<Evidence>();
 const [exactCandidate, setExactCandidate] = useState('');
 const [expectedEmail, setExpectedEmail] = useState<string>();
 const [incidentTime, setIncidentTime] = useState('');
 const [incidentZone, setIncidentZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
 const [incidentChoice, setIncidentChoice] = useState('');
 const [leadEventTime, setLeadEventTime] = useState<string>();
 const [leadSourceEvent, setLeadSourceEvent] = useState<SourceEvent>();
 const [eventAnchor, setEventAnchor] = useState<string>();
 const [application, setApplication] = useState('');
 const [symptom, setSymptom] = useState('');
 const [issueCategory, setIssueCategory] = useState<ReportedIssueCategory | ''>('');
 const [ticket, setTicket] = useState('');
 const [draftChanged, setDraftChanged] = useState(false);
 const [contextNeedsReview, setContextNeedsReview] = useState(false);
 const [context, setContext] = useState<AccountCaseContext>({incidentTime:'', application:'', symptom:'', ticket:''});
 const [result, setResult] = useState<Investigation>();
 const [phase, setPhase] = useState<'Evidence review' | 'Proposed' | 'Executing' | 'Completed'>('Evidence review');
 const [runStage, setRunStage] = useState<'connecting' | 'account' | 'identifier'>();
 const [manualStage, setManualStage] = useState('');
 const [offline, setOffline] = useState(false);
 const [selected, select] = useState<NodeId>();
 const [selectedLogPage, setSelectedLogPage] = useState<number>();
 const [error, setError] = useState('');
 const [consent, setConsent] = useState(false);
 const [analysis, setAnalysis] = useState('');
 const [analysisBusy, setAnalysisBusy] = useState(false);
 const [handoffStatus, setHandoffStatus] = useState('');
 const [replyDraft, setReplyDraft] = useState<string>();
 const [replyStatus, setReplyStatus] = useState('');
 const [contextUpdateStatus, setContextUpdateStatus] = useState('');
 const [replyNeedsReview, setReplyNeedsReview] = useState(false);
 const [submittedLogs, setSubmittedLogs] = useState<Evidence>();
 const [submittedMore, setSubmittedMore] = useState<Evidence[]>([]);
 const [submittedPageError, setSubmittedPageError] = useState<Evidence>();
 const [submittedRefreshError, setSubmittedRefreshError] = useState<Evidence>();
 const [identifierBlocks, setIdentifierBlocks] = useState<Evidence>();
 const [identifierRefreshError, setIdentifierRefreshError] = useState<Evidence>();
 const [skippedChecks, setSkippedChecks] = useState<string[]>([]);
 const [includeSubmittedLogs, setIncludeSubmittedLogs] = useState(false);
 const [includeIdentifierBlocks, setIncludeIdentifierBlocks] = useState(false);
 const workRef = useRef<HTMLElement>(null);
 const lock = useRef(false);
 const analysisLock = useRef(false);
 const identifierEmail = result && targetType(result.target,result.targetType) === 'email' ? result.target : expectedEmail;
 useEffect(() => {
  if (!active || busy || analysisBusy || !prefill || handledPrefill.current === prefill.requestId) return;
  const identifier = 'email' in prefill ? prefill.email : prefill.userId;
  const kind = 'email' in prefill ? 'email' : 'user_id';
  if (validateTarget(identifier,kind)) return;
  handledPrefill.current = prefill.requestId; setPendingLead(prefill); setError('');
 }, [active,busy,analysisBusy,prefill]);
 const leadPending = !!pendingLead || !!(prefill && handledPrefill.current !== prefill.requestId);
 const usePendingLead = () => {
  if (!pendingLead || busy || analysisBusy) return;
  const identifier = 'email' in pendingLead ? pendingLead.email : pendingLead.userId;
  const kind = 'email' in pendingLead ? 'email' : 'user_id';
  if (validateTarget(identifier,kind)) return;
  const sourceEvent = validSourceEvent(pendingLead.sourceEvent), sourceTime = observationTime(pendingLead.eventTime);
  setTarget(identifier); setTargetChoice(kind); setSourceLink(pendingLead.link); setLeadEventTime(sourceTime); setLeadSourceEvent(sourceEvent?.time === sourceTime ? sourceEvent : undefined); setEventAnchor(undefined);
  setIncidentTime(''); setIncidentZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); setIncidentChoice('');
  setApplication(''); setSymptom(''); setTicket(''); setIssueCategory(''); setContextNeedsReview(false); setDraftChanged(true); setError(''); setPendingLead(undefined);
 };
 const prepare = (example: boolean) => {
  if (analysisLock.current || leadPending || contextNeedsReview) return;
  const value = example ? demoTarget : target.trim();
  const chosen = example ? undefined : targetChoice;
  const problem = validateTarget(value, chosen);
  if (problem) { setError(problem); return; }
  if (!example && incidentTime && !validTimeZone(incidentZone)) { setError('Enter a valid IANA timezone, such as America/Los_Angeles or UTC.'); return; }
  const candidates = !example && incidentTime && !eventAnchor ? localIncidentCandidates(incidentTime,incidentZone) : [];
  if (!example && incidentTime && !eventAnchor && !candidates.length) { setError('That local time is invalid or did not occur because the clock changed. Enter another time.'); return; }
  if (candidates.length > 1 && !candidates.includes(incidentChoice)) { setError('That local time occurred more than once. Select the correct UTC time.'); return; }
  const selectedTime = eventAnchor && !example ? eventAnchor : candidates.length > 1 ? incidentChoice : candidates[0] ?? '';
  setContext(example ? {incidentTime:'2026-01-01T12:00:00.000Z', incidentZone:'UTC', application:'Fictional application', symptom:'The user reported a sign-in failure.', ticket:'DEMO-1'} : {incidentTime:selectedTime, incidentZone:selectedTime ? eventAnchor ? 'UTC' : incidentZone : undefined, timeSource:eventAnchor ? 'event' : 'reported', application:application.trim(), symptom:symptom.trim(), ticket:ticket.trim(), issueCategory:issueCategory || undefined, sourceLink:sourceLink, sourceEvent:leadSourceEvent});
  setDraftChanged(false); setError(''); setOffline(example); setResult(createInvestigation(value, targetType(value, chosen))); setCandidateId(''); setExactLookup(undefined); setExactCandidate(''); setExpectedEmail(undefined); select(undefined); setSelectedLogPage(undefined); setAnalysis(''); setSubmittedLogs(undefined); setSubmittedMore([]); setSubmittedPageError(undefined); setSubmittedRefreshError(undefined); setIdentifierBlocks(undefined); setIdentifierRefreshError(undefined); setSkippedChecks([]); setIncludeSubmittedLogs(false); setIncludeIdentifierBlocks(false); setHandoffStatus(''); setReplyDraft(undefined); setReplyStatus(''); setContextUpdateStatus(''); setReplyNeedsReview(false); setConsent(false); setPhase('Proposed');
 };
 const proposeCandidate = () => {
  if (!result || offline || busy || analysisBusy || phase !== 'Completed' || !accountCandidates(result).includes(candidateId)) return;
  const email = result.target;
  setTarget(candidateId); setTargetChoice('user_id'); setExpectedEmail(email); setContext(previous => ({...previous,reportedEmail:email,selectedFromMultiple:true}));
  setResult(createInvestigation(candidateId,'user_id')); setCandidateId(''); select(undefined); setSelectedLogPage(undefined);
  setError(''); setAnalysis(''); setIncludeSubmittedLogs(false); setIncludeIdentifierBlocks(false); setHandoffStatus(''); setReplyDraft(undefined); setReplyStatus(''); setContextUpdateStatus(''); setReplyNeedsReview(false); setConsent(false); setPhase('Proposed');
 };
 const exactCandidates = () => {
  if (!result || exactLookup?.status !== 'success' || exactLookup.input?.email !== result.target || !Array.isArray(exactLookup.data?.users) || exactLookup.data.users.length > 19 || exactLookup.data.count !== exactLookup.data.users.length) return [];
  const users = exactLookup.data.users as Array<Record<string, unknown>>;
  if (!users.every(user => user && user.email === result.target && typeof user.user_id === 'string' && user.user_id === user.user_id.trim() && !validateTarget(user.user_id,'user_id'))) return [];
  const ids = users.map(user => user.user_id as string);
  return new Set(ids).size === ids.length ? ids : [];
 };
 const lookupExactEmail = async () => {
  if (!result || offline || !connected || !client || busy || analysisBusy || lock.current || phase !== 'Completed' || result.steps.find(step => step.id === 'search')?.evidence?.data?.count !== 0 || targetType(result.target,result.targetType) !== 'email') return;
  lock.current = true; setBusy(true); setManualStage('Checking exact-case email…'); setError(''); setExactCandidate('');
  try { setExactLookup(safeEvidence(observedEvidence(await invokeRead(client,await start(),'get_users_by_email',{email:result.target})))); }
  catch (failure) { setExactLookup({tool:'get_users_by_email',status:'error',error:failure instanceof TelemetryTaskTimeoutError ? failure.message : 'The exact-case email lookup could not be started.'}); }
  finally {lock.current = false; setManualStage(''); setBusy(false);}
 };
 const proposeExactCandidate = () => {
  if (!result || busy || analysisBusy || phase !== 'Completed' || !exactCandidates().includes(exactCandidate)) return;
  const email = result.target;
  setTarget(exactCandidate); setTargetChoice('user_id'); setExpectedEmail(email); setContext(previous => ({...previous,reportedEmail:email,selectedFromExactLookup:true}));
  setResult(createInvestigation(exactCandidate,'user_id')); setExactCandidate(''); setExactLookup(undefined); select(undefined); setSelectedLogPage(undefined);
  setError(''); setAnalysis(''); setIncludeSubmittedLogs(false); setIncludeIdentifierBlocks(false); setHandoffStatus(''); setReplyDraft(undefined); setReplyStatus(''); setContextUpdateStatus(''); setReplyNeedsReview(false); setConsent(false); setPhase('Proposed');
 };
 const run = async () => {
  if (!result || lock.current || leadPending || contextNeedsReview || (!offline && (!connected || !client))) return;
  lock.current = true; setBusy(true); setError(''); setRunStage('connecting'); setPhase('Executing');
  try {
   const token = offline ? 'offline' : await start();
   setRunStage('account');
   const completed = await executeInvestigation(result, offline ? demoClient : client!, token, undefined, setResult, {incidentTime:context.incidentTime,expectedEmail});
   if (!offline && client && targetType(result.target,result.targetType) === 'email' && (includeSubmittedLogs || includeIdentifierBlocks)) {
    setRunStage('identifier');
    const extra = await runOptionalIdentifierChecks(client,token,completed,context.incidentTime,{logs:includeSubmittedLogs,blocks:includeIdentifierBlocks});
    setSubmittedLogs(extra.logs); setIdentifierBlocks(extra.blocks); setSkippedChecks(extra.skipped);
    if (extra.skipped.length) setError(`Approved checks not run: ${extra.skipped.join(', ')}. Review the prior results and incident time before retrying.`);
   }
   setPhase('Completed');
  } catch (failure) {
   setError(failure instanceof TelemetryTaskTimeoutError ? failure.message : failure instanceof TelemetryTaskMismatchError ? 'The running Auth0 task has different connection settings. Stop it in RocketRide or wait for it to expire before trying again.' : 'Investigation could not be completed. Inspect recorded results before retrying.');
   setResult(previous => previous && {...previous, steps: previous.steps.map(step => step.state === 'running' ? {...step, state:'failed', summary:'The application could not confirm this step completed.'} : step.state === 'queued' ? {...step, state:'skipped', summary:'Investigation stopped before this step began.'} : step)});
   setPhase('Completed');
  } finally { lock.current = false; setRunStage(undefined); setBusy(false); }
 };
 const generate = async () => {
  if (!result || !consent || analysisLock.current) return;
  const records = accountAnalysisRecords(result), evidence = records.map(record => record.evidence);
  if (!evidence.some(item => item.status === 'success')) return;
  analysisLock.current = true; setConsent(false); setAnalysisBusy(true); setError('');
  try {
   if (offline) {
    const example = parseAnalysisResponse(await demoAnalysis());
    if (!example) throw new Error('Invalid fictional example.');
    const references = records.flatMap((record,index) => record.evidence.status === 'success' && ['profile','logs','blocks'].includes(record.source) ? [`E${index+1}`] : []).slice(0,4);
    setAnalysis(JSON.stringify({...example,references}));
   } else setAnalysis(await analyze('', evidence, result.accountHistory?.stop));
  }
  catch { setError('AI analysis was unavailable. The recorded evidence remains available.'); }
  finally { analysisLock.current = false; setAnalysisBusy(false); }
 };
 const searchSubmittedLogs = async () => {
  if (!result || offline || !connected || !client || lock.current || analysisLock.current) return;
  const window = submittedEmailWindow(context.incidentTime);
  if (!window || !identifierEmail) { setError('Use an email and an investigation time in the past to search tenant logs.'); return; }
  lock.current = true; setBusy(true); setManualStage('Searching submitted-email tenant logs…'); setError(''); setHandoffStatus('');
  try {
   const next = observedEvidence(await invokeRead(client, await start(), 'search_submitted_email_logs', {email:identifierEmail,...window}));
   if (next.status === 'success' || submittedLogs?.status !== 'success') { setSubmittedLogs(next); setSubmittedMore([]); setSubmittedPageError(undefined); setSubmittedRefreshError(undefined); }
   else setSubmittedRefreshError(next);
   setSkippedChecks(previous => previous.filter(item => item !== 'tenant log search'));
  }
  catch (failure) { const message = failure instanceof TelemetryTaskTimeoutError ? failure.message : failure instanceof TelemetryTaskMismatchError ? 'The running Auth0 task has different connection settings. Stop it in RocketRide or wait for it to expire before trying again.' : 'The submitted-email log search could not be started.'; setError(message); if (submittedLogs?.status === 'success') setSubmittedRefreshError({tool:'search_submitted_email_logs',status:'error',error:message}); }
  finally { lock.current = false; setManualStage(''); setBusy(false); }
 };
 const searchMoreSubmittedLogs = async () => {
  if (!result || !identifierEmail || offline || !connected || !client || lock.current || analysisLock.current || !submittedLogs || submittedLogs.status !== 'success' || submittedPageError || submittedRefreshError) return;
  const current = mergeSubmittedEmailPages(submittedLogs,submittedMore);
  const page = submittedMore.length + 1;
  const startTime = submittedLogs.input?.start, endTime = submittedLogs.input?.end;
  if (page > 4 || current?.data?.page_full !== true || current.data.repeated_page === true || submittedLogs.input?.email !== identifierEmail || typeof startTime !== 'string' || typeof endTime !== 'string') return;
  lock.current = true; setBusy(true); setManualStage('Searching the next submitted-email log page…'); setError(''); setHandoffStatus('');
  try {
   const next = observedEvidence(await invokeRead(client,await start(),'search_submitted_email_logs',{email:identifierEmail,start:startTime,end:endTime,page}));
   if (next.status === 'success') setSubmittedMore(previous => [...previous,next]); else setSubmittedPageError(next);
  } catch (failure) { setSubmittedPageError({tool:'search_submitted_email_logs',status:'error',error:'The next tenant-log page could not be started.'}); setError(failure instanceof TelemetryTaskTimeoutError ? failure.message : failure instanceof TelemetryTaskMismatchError ? 'The running Auth0 task has different connection settings. Stop it in RocketRide or wait for it to expire before trying again.' : 'The next tenant-log page could not be started.'); }
  finally { lock.current = false; setManualStage(''); setBusy(false); }
 };
 const checkIdentifierBlocks = async () => {
  if (!result || !identifierEmail || offline || !connected || !client || lock.current || analysisLock.current) return;
  lock.current = true; setBusy(true); setManualStage('Checking submitted-email protection records…'); setError(''); setHandoffStatus('');
  try {
   const next = observedEvidence(await invokeRead(client, await start(), 'get_blocks_by_email', {email:identifierEmail}));
   if (next.status === 'success' || identifierBlocks?.status !== 'success') { setIdentifierBlocks(next); setIdentifierRefreshError(undefined); }
   else setIdentifierRefreshError(next);
   setSkippedChecks(previous => previous.filter(item => item !== 'protection check'));
  }
  catch (failure) { const message = failure instanceof TelemetryTaskTimeoutError ? failure.message : failure instanceof TelemetryTaskMismatchError ? 'The running Auth0 task has different connection settings. Stop it in RocketRide or wait for it to expire before trying again.' : 'The submitted-email protection check could not be started.'; setError(message); if (identifierBlocks?.status === 'success') setIdentifierRefreshError({tool:'get_blocks_by_email',status:'error',error:message}); }
  finally { lock.current = false; setManualStage(''); setBusy(false); }
 };
 const steps = result?.steps.filter(step => positions[step.id]) ?? [];
 const current = steps.find(step => step.id === selected);
 const nodes = steps.map(step => ({id:step.id, position:positions[step.id]!, sourcePosition:Position.Right, targetPosition:Position.Left,
  className:'lens-node ' + (step.state === 'completed' ? 'success' : step.state === 'queued' ? 'pending' : step.state) + (selected === step.id ? ' selected' : ''),
  data:{label:<><small>{step.state === 'queued' ? 'Proposed' : step.state}</small><strong>{step.label}</strong><span>{step.state === 'queued' ? step.purpose : step.summary}</span></>}}));
 const edges = steps.flatMap(step => step.dependencies.filter(id => positions[id]).map(id => ({id:id + '-' + step.id, source:id, target:step.id, animated:step.state === 'running', markerEnd:{type:MarkerType.ArrowClosed}, style:{stroke:'var(--ll-accent, #3da54e)'}})));
 const observation = result ? findings(result) : [];
 const combinedSubmittedLogs = withRefreshFailure(mergeSubmittedEmailPages(submittedLogs,submittedMore,submittedPageError),submittedRefreshError);
 const combinedIdentifierBlocks = withRefreshFailure(identifierBlocks,identifierRefreshError);
 const recommendation = result && phase === 'Completed' ? accountCaseRecommendation(result,combinedSubmittedLogs,combinedIdentifierBlocks,skippedChecks) : undefined;
 const emailNextSteps = identifierNextSteps(combinedSubmittedLogs,combinedIdentifierBlocks);
 const candidates = result && phase === 'Completed' && !offline ? accountCandidates(result) : [];
 const runningLabels = result?.steps.filter(step => step.state === 'running').map(step => step.label) ?? [];
 const runStatus = runStage === 'connecting' ? (offline ? 'Starting the fictional example…' : 'Starting and verifying the read-only task…') : runStage === 'account' ? (runningLabels.length ? `Running: ${runningLabels.join(', ')}.` : 'Preparing account checks…') : runStage === 'identifier' ? 'Running approved submitted-email checks…' : '';
 const laterSuccess = result && phase === 'Completed' ? laterAccountSuccess(result, context.incidentTime) : undefined;
 const inspect = (id: NodeId, page?: number) => { select(id); setSelectedLogPage(id === 'logs' ? page ?? 1 : undefined); workRef.current?.scrollIntoView({block:'start'}); };
 const updateReportedContext = (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  if (busy || analysisBusy || phase !== 'Completed') return;
  const values = new FormData(event.currentTarget);
  const applicationValue = values.get('application'), symptomValue = values.get('symptom'), ticketValue = values.get('ticket'), categoryValue = values.get('category');
  if (typeof applicationValue !== 'string' || applicationValue.length > 200 || typeof symptomValue !== 'string' || symptomValue.length > 1000 || typeof ticketValue !== 'string' || ticketValue.length > 70 || typeof categoryValue !== 'string' || (categoryValue !== '' && !reportedIssue(categoryValue))) return;
  setContext(previous => ({...previous, application:applicationValue.trim(), symptom:symptomValue.trim(), ticket:ticketValue.trim(), issueCategory:categoryValue ? categoryValue as ReportedIssueCategory : undefined}));
  setHandoffStatus(''); setReplyStatus('');
  if (replyDraft !== undefined) setReplyNeedsReview(true);
  setContextUpdateStatus('Reported details updated locally. No checks were run and the Jira request was not verified.');
 };
 const copyHandoff = async () => {
  if (!result) return;
  try { await navigator.clipboard.writeText(accountCaseSummary(result, context, offline, combinedSubmittedLogs, combinedIdentifierBlocks, skippedChecks)); setHandoffStatus('Summary copied. Paste it into an authorized ticket.'); }
  catch { setHandoffStatus('Copy is unavailable. Select the summary text and copy it manually.'); }
 };
 const copyReply = async () => {
  if (!replyDraft) return;
  try { await navigator.clipboard.writeText(replyDraft); setReplyStatus('Draft copied. Review it in your support system before sending.'); }
  catch { setReplyStatus('Copy is unavailable. Select the draft text and copy it manually.'); }
 };
 const inspectedPage = selected === 'logs' && selectedLogPage ? result?.accountHistory?.pages[selectedLogPage - 1] : undefined;
 const inspectorStep = current && inspectedPage ? {...current, label:`${current.label} · page ${selectedLogPage}`, evidence:inspectedPage, started:undefined, ended:undefined, summary:`Returned account-log page ${selectedLogPage}. See Output for the recorded response.`} : current;
 const incidentCandidates = incidentTime ? localIncidentCandidates(incidentTime,incidentZone) : [];
 return <div className="lens lens-case">
  <div className="lens-case-head"><span className="lens-kicker">LOGIN SUPPORT</span><h1>Investigate a login issue</h1><p>Start with a reported problem and review read-only account evidence.</p></div>
  {pendingLead && <section className="lens-card" aria-label="Incoming account lead"><h3>Account lead ready</h3><p>{'email' in pendingLead ? pendingLead.email : pendingLead.userId} · {accountLeadLabel(pendingLead.link)}. Confirm the intended account independently; this lead does not establish who attempted sign-in or grant authorization.</p><p>Using this lead replaces the current form fields with a fresh form. Any existing investigation result stays visible until you propose a new investigation.</p><button type="button" disabled={busy || analysisBusy} onClick={usePendingLead}>Use lead in a new form</button><button type="button" disabled={busy || analysisBusy} onClick={()=>setPendingLead(undefined)}>Dismiss lead</button></section>}
  <section className="lens-card" onChangeCapture={() => {if (result) setDraftChanged(true);}}><label htmlFor="account-investigation-target">Email address or Auth0 user ID</label><div className="lens-account-input"><input id="account-investigation-target" value={target} onChange={event => {if (target.trim() && event.target.value !== target && (incidentTime || eventAnchor || application.trim() || symptom.trim() || ticket.trim() || issueCategory)) setContextNeedsReview(true); setTarget(event.target.value); setTargetChoice(undefined); setSourceLink(undefined); setLeadEventTime(undefined); setLeadSourceEvent(undefined); setError('');}} placeholder="name@example.com or auth0|123" disabled={busy || analysisBusy}/></div>
   {sourceLink && <p>Identifier selected from an event investigation ({accountLeadLabel(sourceLink)}). Confirm the intended account independently; this does not prove who attempted login or grant authorization. Propose and approve new checks to investigate it.</p>}
   {target.includes('@') && targetType(target,'user_id') && <label>Identifier type<select id="identifier-type" value={targetChoice ?? ''} disabled={busy || analysisBusy} onChange={event => {if (targetChoice && targetChoice !== event.target.value && (incidentTime || eventAnchor || application.trim() || symptom.trim() || ticket.trim() || issueCategory)) setContextNeedsReview(true); setTargetChoice(event.target.value === 'email' ? 'email' : event.target.value === 'user_id' ? 'user_id' : undefined); setSourceLink(undefined); setLeadSourceEvent(undefined); setLeadEventTime(undefined); setError('');}}><option value="">Choose identifier type</option><option value="email" disabled={!targetType(target,'email')}>Email address{!targetType(target,'email') ? ' (unsupported format)' : ''}</option><option value="user_id">Auth0 user ID</option></select></label>}
   {contextNeedsReview && <div role="alert"><p>The identifier changed while this form contains reported details. Confirm they belong with the new identifier, or clear them before proposing checks.</p><button type="button" disabled={busy || analysisBusy} onClick={()=>setContextNeedsReview(false)}>Use these details</button><button type="button" disabled={busy || analysisBusy} onClick={()=>{setIncidentTime(''); setEventAnchor(undefined); setIncidentZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); setIncidentChoice(''); setApplication(''); setSymptom(''); setTicket(''); setIssueCategory(''); setContextNeedsReview(false);}}>Clear reported details</button></div>}
   {leadSourceEvent && <p>Source event: {leadSourceEvent.id} · {accountEventLabel(leadSourceEvent.type)} · {leadSourceEvent.time} (UTC). This event does not establish who attempted sign-in.</p>}
   {leadEventTime && <div><p>Selected event time: {leadEventTime} (UTC). It is the event's timestamp, not a customer-reported incident time.</p><button type="button" disabled={busy || analysisBusy} onClick={()=>{setIncidentTime(''); setIncidentChoice(''); setEventAnchor(leadEventTime); setIncidentZone('UTC'); if (result) setDraftChanged(true);}}>Use selected event time for investigation</button></div>}
   {eventAnchor && <p>Investigation time: {eventAnchor} (selected event time, not customer-reported). Entering a customer-reported time or changing the timezone replaces it.</p>}
   <div className="lens-case-context"><label>Approximate customer-reported time (optional)<input type="datetime-local" value={incidentTime} onChange={event => {setIncidentTime(event.target.value);setEventAnchor(undefined);setIncidentChoice('');}} disabled={busy}/></label><label>Reported timezone<input list="incident-time-zones" value={incidentZone} onChange={event => {setIncidentZone(event.target.value);setEventAnchor(undefined);setIncidentChoice('');}} disabled={busy} placeholder="America/Los_Angeles or UTC"/></label><datalist id="incident-time-zones">{timeZones.map(zone => <option key={zone} value={zone}/>)}</datalist>{incidentCandidates.length > 1 && <label>This local time occurred more than once. Select the correct occurrence<select id="incident-occurrence" value={incidentChoice} onChange={event => setIncidentChoice(event.target.value)} disabled={busy}><option value="">Choose an occurrence</option>{incidentCandidates.map(time => <option key={time} value={time}>{new Date(time).toLocaleString(undefined,{timeZone:incidentZone,timeZoneName:'short'})} · {time} UTC</option>)}</select></label>}<label>Application (optional)<input value={application} maxLength={200} onChange={event => setApplication(event.target.value)} disabled={busy}/></label><label>Jira request key (optional)<input value={ticket} maxLength={70} onChange={event => setTicket(event.target.value)} disabled={busy} placeholder="SUPPORT-123"/></label><label>Reported sign-in problem (optional)<select id="reported-issue-category" value={issueCategory} onChange={event => setIssueCategory(reportedIssue(event.target.value) ? event.target.value as ReportedIssueCategory : '')} disabled={busy || analysisBusy}><option value="">Not specified</option><option value="password">Password or credentials</option><option value="mfa">MFA or verification</option><option value="identifier">Email or account identifier</option><option value="redirect">Redirect or application access</option></select></label><label>Reported symptom (optional)<textarea value={symptom} maxLength={1000} onChange={event => setSymptom(event.target.value)} disabled={busy} rows={2}/></label></div>
   <div className="lens-account-input"><button className="primary" disabled={!connected || busy || analysisBusy || leadPending || contextNeedsReview} onClick={() => prepare(false)}>Propose investigation</button><button disabled={busy || analysisBusy || leadPending || contextNeedsReview} onClick={() => prepare(true)}>Propose offline example</button></div><p>Proposing a graph does not contact Auth0 or an AI provider. An investigation time can trigger up to five account-log page reads; the application does not filter results.</p></section>
  {result && <section ref={workRef} className="lens-card lens-work"><div className="lens-card-head"><div><span className="lens-kicker">INVESTIGATION GRAPH · {offline ? 'OFFLINE FIXTURE' : 'READ-ONLY'}</span><h3>{phase}</h3><p>{targetType(result.target, result.targetType) === 'email' ? 'Email' : 'Auth0 user ID'}: {result.target}</p></div>{phase === 'Proposed' && <button className="primary" disabled={busy || leadPending || contextNeedsReview || (!offline && !connected)} onClick={() => void run()}>Approve and run checks</button>}</div>
   <p role="status" aria-live="polite">{phase === 'Executing' ? runStatus : phase === 'Completed' ? 'Checks have stopped. Review the results and any errors.' : ''}</p>
   {phase === 'Proposed' && <p>{offline ? 'Checks use fictional fixture responses.' : 'Approved checks retrieve account profile, recent logs and block records from Auth0. An investigation time can trigger up to five pages of account logs.'} {expectedEmail && 'The selected profile must still match the reported email before logs or blocks are read.'} AI analysis requires a separate action.</p>}
   {phase === 'Proposed' && <div className="lens-proposal-context" aria-label="Proposed investigation details"><h4>Details for this proposal</h4><p>Account: {result.target} ({targetType(result.target,result.targetType) === 'email' ? 'email' : 'Auth0 user ID'}){expectedEmail && <> · Reported email: {expectedEmail}</>}</p><p>Investigation time: {context.incidentTime || 'Not provided'}{context.incidentTime && (context.timeSource === 'event' ? ' (selected event time, not customer-reported)' : ` (UTC; investigation timezone: ${context.incidentZone})`)} · Application: {context.application || 'Not provided'}</p><p>Reported problem: {reportedIssue(context.issueCategory)?.label || 'Not specified'} · Symptom: {context.symptom || 'Not provided'} · Jira request: {context.ticket || 'Not provided'} (not verified)</p><p>These details are operator-reported, not verified evidence.</p>{draftChanged && <p role="status">The form has changed since this proposal. Approval uses the details shown here; propose again to use the edited form.</p>}</div>}
   {phase === 'Proposed' && !offline && targetType(result.target,result.targetType) === 'email' && <fieldset><legend>Optional submitted-email checks</legend><p>These checks can help when no account is found. A submitted email does not prove who attempted login or identify a unique account.</p><label><input type="checkbox" checked={includeIdentifierBlocks} onChange={event => setIncludeIdentifierBlocks(event.target.checked)}/> Check brute-force records for the submitted email (read:users)</label><br/><label><input type="checkbox" checked={includeSubmittedLogs} disabled={!submittedEmailWindow(context.incidentTime)} onChange={event => setIncludeSubmittedLogs(event.target.checked)}/> Search one tenant-log page around the investigation time (read:logs)</label>{!submittedEmailWindow(context.incidentTime) && <p>Provide a past investigation time to include the tenant-log search.</p>}</fieldset>}
   <div className="lens-graph">{active && <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => inspect(node.id as NodeId)} minZoom={0.15}><Controls showInteractive={false}/><Background color="#2b2e2c"/></ReactFlow>}</div>
   <details><summary>Review proposed checks and dependencies</summary>{steps.map(step => <div key={step.id} className="lens-category"><button onClick={() => inspect(step.id)}>{step.label}</button><span>{step.purpose} · After {step.dependencies.join(', ') || 'approval'}</span></div>)}</details>
   {inspectorStep && <aside className="lens-inspector"><button onClick={() => {select(undefined); setSelectedLogPage(undefined);}}>Close inspector</button>{selectedLogPage && <p>Page numbers here start at 1; the Auth0 API page argument starts at 0.</p>}<Inspector key={`${inspectorStep.id}-${selectedLogPage ?? 'all'}`} step={inspectorStep} result={result} pageNumber={selectedLogPage}/></aside>}
  </section>}
  {error && <p role="alert">{error}</p>}
  {result && phase === 'Completed' && <section className="lens-card lens-report"><span className="lens-kicker">INVESTIGATION SUMMARY · {offline ? 'FIXTURE' : 'TOOL RESULTS'}</span><h3>Evidence and next steps</h3>{recommendation && <><h4>{recommendation.status}</h4><p>{recommendation.reason}</p>{recommendation.actions.map((action, index) => <p key={index}>{action.text} <button onClick={() => inspect(action.source, 'page' in action ? action.page : undefined)}>Inspect evidence{'page' in action && action.page ? ` · page ${action.page}` : ''}</button></p>)}</>}
   <p role="status" aria-live="polite">{manualStage}</p>
   {emailNextSteps.length > 0 && <><h4>Submitted-email next steps</h4><ul>{emailNextSteps.map((item,index)=><li key={index}>{item}</li>)}</ul></>}
   {candidates.length > 0 && <section><h4>Multiple matching accounts</h4><p>Confirm the intended account independently. A shared email or selection does not establish authorization. Proposing a selected account replaces the account investigation results. Submitted-email results remain separate and do not establish that the events belong to the selected account. No account check runs until you approve the new proposal.</p><label>Account ID<select value={candidateId} onChange={event => setCandidateId(event.target.value)} disabled={busy || analysisBusy}><option value="">Choose an account ID</option>{candidates.map(id=><option key={id} value={id}>{id}</option>)}</select></label><button type="button" disabled={!candidateId || busy || analysisBusy} onClick={proposeCandidate}>Propose selected account</button></section>}
   {!offline && targetType(result.target,result.targetType) === 'email' && result.steps.find(step => step.id === 'search')?.evidence?.status === 'success' && result.steps.find(step => step.id === 'search')?.evidence?.data?.count === 0 && <section><h4>Check exact-case email</h4><p>Auth0 offers a separate lookup that can find recently updated profiles before indexed search catches up. It is case-sensitive and may miss accounts with different capitalization. This is not proof of identity or authorization.</p><button type="button" disabled={busy || analysisBusy || !connected} onClick={() => void lookupExactEmail()}>Check exact-case email</button>{exactLookup?.status === 'error' && <p role="alert">Exact-case lookup failed: {exactLookup.error}</p>}{exactLookup?.status === 'success' && <><p>{String(exactLookup.data?.count)} exact-case match(es) returned. Confirm the intended account independently; other accounts may exist.</p>{exactCandidates().length > 0 && <><label>Account ID<select aria-label="Exact-case account ID" value={exactCandidate} onChange={event=>setExactCandidate(event.target.value)}><option value="">Choose an account ID</option>{exactCandidates().map(id=><option key={id} value={id}>{id}</option>)}</select></label><button type="button" disabled={!exactCandidate || busy || analysisBusy} onClick={proposeExactCandidate}>Propose exact-case account</button></>}</>}</section>}
   <h4>Reported context</h4><p>Investigation time: {context.incidentTime || 'Not provided'}{context.incidentTime && (context.timeSource === 'event' ? ' (selected event time, not customer-reported)' : ` (UTC; investigation timezone: ${context.incidentZone})`)} · Application: {context.application || 'Not provided'} · Jira request: {context.ticket || 'Not provided'} (not verified)</p>{context.reportedEmail && <p>Reported email: {context.reportedEmail}. The selected account's current profile must match this email.</p>}{context.selectedFromMultiple && <p>Account manually selected from multiple email matches. Selection does not establish authorization or who attempted the login.</p>}{context.selectedFromExactLookup && <p>Account manually selected from a case-sensitive email lookup after the indexed search returned no match. Selection does not establish authorization or who attempted the login.</p>}{context.sourceLink && <p>Identifier selected from an event investigation ({accountLeadLabel(context.sourceLink)}). This does not establish authorization or who attempted the login.</p>}{validSourceEvent(context.sourceEvent) && <p>Source event: {context.sourceEvent!.id} · {accountEventLabel(context.sourceEvent!.type)} · {context.sourceEvent!.time} (UTC). This event is a lead, not proof of who attempted sign-in.</p>}<p>Symptom: {context.symptom || 'Not provided'}</p><p>Reported problem category: {reportedIssue(context.issueCategory)?.label || 'Not specified'} (operator-reported; not confirmed by evidence).</p>{reportedIssue(context.issueCategory) && <p>Suggested review: {reportedIssue(context.issueCategory)?.advice}</p>}
   <details key={result.id}><summary>Update reported details</summary><p>Update these local notes without running checks. To change the account or investigation time, propose a new investigation. Jira keys are not verified.</p><form aria-label="Update reported details" onSubmit={updateReportedContext}><fieldset disabled={busy || analysisBusy}><label>Application<input name="application" defaultValue={context.application} maxLength={200}/></label><label>Reported sign-in problem<select name="category" defaultValue={context.issueCategory || ''}><option value="">Not specified</option><option value="password">Password or credentials</option><option value="mfa">MFA or verification</option><option value="identifier">Email or account identifier</option><option value="redirect">Redirect or application access</option></select></label><label>Reported symptom<textarea name="symptom" defaultValue={context.symptom} maxLength={1000} rows={2}/></label><label>Jira request key<input name="ticket" defaultValue={context.ticket} maxLength={70}/></label><button type="submit">Update local details</button></fieldset></form><p role="status">{contextUpdateStatus}</p></details>
   <h4>Returned account events</h4><p>{accountHistoryDescription(result)} Events within one hour of the investigation time are marked for comparison. {context.application && 'Matching application names are hints; names can change or be shared and do not prove the event is related.'}</p><p>{accountTimeComparison(result,context.incidentTime)}</p>{recentAccountEvents(result).length ? <ul>{recentAccountEvents(result).map((event, index) => <li key={index}>{event.time} · {accountEventLabel(event.type)} · {event.application}{nearReportedTime(event.time, context.incidentTime) && ' · within 1 hour of investigation time'}{matchesReportedApplication(event.application,context.application) && ' · matches reported application name'}</li>)}</ul> : <p>No dated events available in the returned pages.</p>}
   {mfaEvidenceCaveat(result) && <p>{mfaEvidenceCaveat(result)}</p>}
   {laterSuccess && <p>An Auth0 login at {laterSuccess.successTime} succeeded after a failed login at {laterSuccess.failureTime}; both reported the application name {laterSuccess.application} near the investigation time. These events may be unrelated and do not confirm the customer reached the application.</p>}
   {!offline && identifierEmail && <section><h4>Check protection for the submitted email</h4><p>Auth0 may have brute-force records even when no profile is found. This read-only check requires read:users and the updated Auth0 node. Records do not establish who attempted login or whether a particular login is effectively blocked. Results are included in the handoff, not AI analysis.</p><button type="button" disabled={busy || analysisBusy || !connected} onClick={() => void checkIdentifierBlocks()}>Check submitted-email protection</button>{identifierBlocks?.status === 'error' && <p role="alert">Protection check failed: {identifierBlocks.error}</p>}{identifierBlocks?.status === 'success' && <>{observationTime(identifierBlocks.observedAt) && <p>Protection response received at {identifierBlocks.observedAt} (browser clock).</p>}<p>{String(identifierBlocks.data?.block_count)} brute-force protection record(s) returned.</p><p>{identifierProtectionAdvice(identifierBlocks)}</p></>}{identifierRefreshError && <p role="alert">A later protection check failed: {identifierRefreshError.error}. Earlier results may be stale.</p>}</section>}
   {!offline && identifierEmail && <section><h4>Find attempts using the submitted email</h4><p>Some failed attempts are absent from account history. Search one page of tenant logs within one hour of the investigation time, ending no later than now. If a page is full, you can request up to four older pages individually. Requires read:logs and an updated Auth0 node. A matching submitted email does not prove who made the attempt or which account it belongs to. Results are included in the handoff but not AI analysis.</p><button type="button" disabled={busy || analysisBusy || !connected || !submittedEmailWindow(context.incidentTime)} onClick={() => void searchSubmittedLogs()}>Search submitted email in tenant logs</button>{!submittedEmailWindow(context.incidentTime) && <p>Provide a past incident time and propose the investigation again to enable this search.</p>}{combinedSubmittedLogs?.status === 'error' && <p role="alert">Tenant log search failed: {combinedSubmittedLogs.error}</p>}{combinedSubmittedLogs?.status === 'success' && <>{submittedEmailWindowDescription(combinedSubmittedLogs,context.incidentTime) && <p>{submittedEmailWindowDescription(combinedSubmittedLogs,context.incidentTime)}</p>}{pageObservationLines(combinedSubmittedLogs).map((line,index)=><p key={index}>{line}</p>)}<p>{String(combinedSubmittedLogs.data?.count)} matching event(s) returned across {String(combinedSubmittedLogs.data?.pages_read)} page(s). {combinedSubmittedLogs.data?.page_full ? 'The last provider page was full; more results may exist.' : 'The last provider page was not full.'} {String(combinedSubmittedLogs.data?.rejected)} returned row(s) were excluded during verification; {String(combinedSubmittedLogs.data?.duplicate_count)} duplicate event(s) were excluded across pages. Retention, indexing and omitted identifiers can still hide events.</p><ul>{(combinedSubmittedLogs.data?.events as Array<Record<string,unknown>>).map((event,index)=><li key={index}>{String(event.date)} · {accountEventLabel(String(event.type))} · {typeof event.client_name === 'string' ? event.client_name : 'Unknown application'}{matchesReportedApplication(event.client_name,context.application) && ' · matches reported application name'} · page {String(event.source_page)}</li>)}</ul>{submittedPageError && <p role="alert">An older page failed: {submittedPageError.error}. Earlier results remain available.</p>}{submittedRefreshError && <p role="alert">A later search failed: {submittedRefreshError.error}. Earlier results may be stale; further paging is paused until a new search succeeds.</p>}{combinedSubmittedLogs.data?.repeated_page === true && <p>An older page repeated previously returned events; further reads stopped.</p>}{submittedMore.length >= 4 && combinedSubmittedLogs.data?.page_full === true && <p>The five-page limit was reached; more results may exist.</p>}{combinedSubmittedLogs.data?.page_full === true && submittedMore.length < 4 && !submittedPageError && !submittedRefreshError && combinedSubmittedLogs.data?.repeated_page !== true && <button type="button" disabled={busy || analysisBusy || !connected} onClick={() => void searchMoreSubmittedLogs()}>Search next tenant-log page</button>}</>}</section>}
   {result.accountHistory && result.accountHistory.pages.length > 1 && <details><summary>Inspect older account-log pages</summary>{result.accountHistory.pages.slice(1).map((page, index) => <details key={index}><summary>Page {index + 2} · {String(page.data?.count ?? 0)} returned events</summary><pre>{JSON.stringify(page.data, null, 2)}</pre></details>)}</details>}
   <h4>What remains unknown</h4><p>The returned pages may not cover the investigation time, and Auth0 events cannot establish whether the customer reached the application. The current account and protection checks do not establish the cause of every failure.</p>{result.steps.filter(step => ['profile','logs','blocks'].includes(step.id) && ['failed','skipped','warning'].includes(step.state)).map(step => <p key={step.id}>{step.label}: {step.summary} <button onClick={() => inspect(step.id)}>Inspect check</button></p>)}
   <details><summary>View recorded result summaries</summary>{observation.length ? observation.map((item, index) => <article key={index}><h4>{item.text}</h4><p>{item.category}</p><button onClick={() => inspect(item.source,item.page)}>Inspect evidence: {item.source}{item.page ? ` · page ${item.page}` : ''} ↑</button></article>) : <p>No findings available. Review the recorded step outcomes.</p>}</details><p>Results may be incomplete. Remediation requires human review.</p>
   <details><summary>Prepare a support handoff</summary><p>This locally generated summary includes the account identifier, reported context and any submitted-email checks. Review it before copying it into an authorized ticket; it is not automatically sent or saved.</p><textarea className="lens-case-handoff" aria-label="Support handoff summary" readOnly value={accountCaseSummary(result, context, offline, combinedSubmittedLogs, combinedIdentifierBlocks, skippedChecks)} rows={12} onFocus={event => event.currentTarget.select()}/><button type="button" onClick={() => void copyHandoff()}>Copy summary</button>{handoffStatus && <p role="status">{handoffStatus}</p>}</details>
   <details><summary>Prepare a customer reply</summary><p>This editable draft is created locally. Review it for the customer and your support policies before copying; it is not sent or saved.</p>{replyNeedsReview && <p>Reported details changed after this draft was created. Review the existing draft before copying; it was not automatically changed.</p>}{replyDraft === undefined ? <button type="button" onClick={() => setReplyDraft(customerReplyDraft(context,offline))}>Create reply draft</button> : <><textarea className="lens-case-handoff" aria-label="Customer reply draft" value={replyDraft} rows={9} onChange={event => {setReplyDraft(event.target.value);setReplyStatus('');}}/><button type="button" disabled={!replyDraft.trim()} onClick={() => void copyReply()}>Copy reply</button>{replyStatus && <p role="status">{replyStatus}</p>}</>}</details>
   <div className="lens-ai-analysis"><div className="lens-ai-heading"><span className="lens-ai-icon" aria-hidden="true">✦</span><div><span className="lens-kicker">AI-ASSISTED ANALYSIS</span><h3>What happened and what to do next</h3></div></div><p>{offline ? 'Generate a local fictional example analysis.' : 'Check categories, counts, account verification and block status, and coverage status are sent to an external model. Account identifiers, reported context and raw events are excluded. Provider charges may apply.'}</p><label><input type="checkbox" checked={consent} disabled={analysisBusy} onChange={event => setConsent(event.target.checked)}/> {offline ? 'I want to see the fictional example analysis.' : 'I authorize external model analysis and associated charges.'}</label><button className="primary" disabled={!consent || analysisBusy || !accountAnalysisRecords(result).some(record => record.evidence.status === 'success') || (!offline && !connected)} onClick={() => void generate()}>{analysisBusy ? 'Analyzing evidence…' : analysis ? 'Generate again' : 'Generate AI analysis ✦'}</button>{analysis && <><p>References identify supplied checks; they do not prove the interpretation. Verify every claim before acting.</p><AnalysisDetails text={analysis} onReference={reference => {const index=Number(reference.slice(1))-1; const record=accountAnalysisRecords(result)[index]; if (record?.evidence.status === 'success') inspect(record.source,record.page);}}/></>}</div>
  </section>}
 </div>;
}
