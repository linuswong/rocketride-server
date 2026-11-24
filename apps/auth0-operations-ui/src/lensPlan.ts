import { invokeRead, type ToolClient } from './operations.ts';
import type { Anomaly } from './lensRules';
import type { Event } from './loginLensAnalytics';
import { normalize } from './loginLensAnalytics.ts';
import { classifyAnomaly, classifications } from './anomalyClassification.ts';
import { parsePlannerResponse, PlannerError, GraphValidationError, type DiagnosticUpdate, type GraphStructure } from './plannerResponse.ts';
import { AccountHistoryReadError, accountRepetition, investigateAccountHistoryPage, investigateSourceAccounts, retryableRateDelay, waitForRetry, type AccountHistoryPage, type SourceInvestigation } from './sourceInvestigation.ts';
import { safeError } from './investigationErrors.ts';

export const MAX_AUTOMATIC_FOLLOWUPS = 39;

export const manualQuestions = [
	'Why did these authentication attempts fail?',
	'Are there signs of unusual login behavior?',
	'Do the available protection settings explain these results?',
	'Is there enough evidence to determine a likely cause?',
] as const;
export type ManualContext = {
	mode: 'manual'; id: string; events: Event[]; start: number; end: number;
	question: typeof manualQuestions[number]; limitation: string;
};
export type InvestigationContext = Anomaly | ManualContext;
export const isManual = (context: InvestigationContext): context is ManualContext => 'mode' in context && context.mode === 'manual';

/** Selection checks prevent stale or invented browser references; they are not authorization. */
export function manualContext(loaded: Event[], references: string[], start: number, end: number, question: string): ManualContext {
	if (!manualQuestions.includes(question as typeof manualQuestions[number]) || !references.length || new Set(references).size !== references.length) invalid();
	const byId = new Map(loaded.map(event => [event.id, event]));
	if (byId.size !== loaded.length || references.some(id => !byId.has(id))) invalid();
	const events = references.map(id => byId.get(id)!);
	const context: ManualContext = {mode:'manual', id:'manual', events, start, end, question:question as ManualContext['question'],
		limitation:'Selected records are a tenant snapshot; retention and indexing coverage are not established. A selection is not an authorization boundary.'};
	validateContext(context);
	return context;
}

export const registry = {
	analyze_source_groups: 'Count source groups and compare the largest group’s representative IP with Auth0 trusted IP lists.',
	investigate_source_accounts: 'Resolve selected failures in the largest source group and follow account evidence.',
	investigate_source_group: 'Inspect another selected source group and follow its account evidence.',
	investigate_account_history: 'Inspect an older page of a previously verified account’s activity.',
	get_log_event: 'Read one event in the selected evidence. Supply ref from the evidence list.',
	get_brute_force_settings: 'Inspect whether account brute-force protection is enabled. No parameters.',
	get_ip_throttling_settings: 'Inspect whether suspicious network throttling is enabled. No parameters.',
	search_authentication_history: 'Retrieve bounded tenant-wide authentication activity in the selected window or an equal-length preceding window. Select period anomaly or previous_window. This is not account-specific.',
	search_logs: 'Retrieve up to 50 newest tenant-wide events of the selected evidence event type. Supply ref. These may be outside the selected window.',
};
// Compatibility with the Auth0 node metadata is checked by the node tests.
export const registryInputs = {
	get_log_event: ['log_id', 'analytics'],
	get_brute_force_settings: [],
	get_ip_throttling_settings: [],
	search_authentication_history: ['start', 'end'],
	search_logs: ['event_type', 'analytics', 'limit'],
} as const;
type Tool = keyof typeof registry;
export type Step = { id: string; tool: Tool; purpose: string; depends: string[]; ref?: string; period?: 'anomaly' | 'previous_24h' | 'previous_window'; sourceRank?: number; sourceRef?:string; accountIndex?:number; historyPage?:number; expected?: string };
export type Result = {
	state: 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'skipped';
	detail: string;
	facts?: Record<string, string | boolean | number>;
	accountEvidence?: SourceInvestigation;
	historyEvidence?: AccountHistoryPage;
};
export type Results = Record<string, Result>;
export type Model = (instructions: string, data: unknown, update?: DiagnosticUpdate) => Promise<string>;

export const refFor = (index: number) => 'E' + (index + 1);
function textField(v: unknown, max: number): v is string {
	return typeof v === 'string' && !!v.trim() && v.length <= max;
}
function object(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}
function invalid(): never {
	throw new Error('Invalid investigation proposal. Generate a new plan.');
}

export function layers(plan: Step[]): Step[][] {
	const done = new Set<string>(),
		levels: Step[][] = [];
	while (done.size < plan.length) {
		const ready = plan.filter((s) => !done.has(s.id) && s.depends.every((id) => done.has(id)));
		if (!ready.length || levels.length >= 4) invalid();
		levels.push(ready);
		for (const s of ready) done.add(s.id);
	}
	return levels;
}

/** Describe what the chosen tools can establish; these are not automated conclusions. */
export function assessPlan(plan: Step[], anomaly: InvestigationContext): { capabilities: string[]; gaps: string[] } {
	const tools = new Set(plan.map(step => step.tool));
	const category = isManual(anomaly) ? undefined : classifyAnomaly(anomaly);
	const capabilities: string[] = [];
	const gaps: string[] = [];
	if (tools.has('analyze_source_groups')) capabilities.push('Count source groups and compare one representative IP with Auth0 trusted IP lists; missing sources remain unknown.');
	if (tools.has('analyze_source_groups')) gaps.push('A trusted-list match does not establish corporate ownership; ASN lookup is unavailable.');
	if (tools.has('get_log_event')) capabilities.push('Verify selected event type and timestamp.');
	if (tools.has('search_authentication_history')) capabilities.push('Inspect bounded tenant-wide event counts, subject to coverage and compatible time windows.');
	if (tools.has('search_logs')) capabilities.push('Inspect a latest tenant-wide page for the selected event type.');
	if (tools.has('get_brute_force_settings') || tools.has('get_ip_throttling_settings'))
		capabilities.push('Inspect current tenant protection settings.');
	if (tools.has('search_logs')) gaps.push('The latest event page may not cover the anomaly window or identify the same account or source.');
	if (tools.has('search_authentication_history') && category && [category.primary, ...category.secondary].includes('geographic_anomaly'))
		gaps.push('History counts are tenant-wide and do not establish a geographic baseline.');
	if (tools.has('search_authentication_history'))
		gaps.push('A short page does not prove retention or indexing coverage. Compare only equal windows with independently verified coverage.');
	if (!tools.has('investigate_source_accounts') && category && [category.primary, ...category.secondary].some(id => id === 'repeated_account_failures' || id === 'potential_password_spraying'))
		gaps.push('Account-specific activity and protection status cannot be resolved from these evidence references.');
	if (tools.has('investigate_source_accounts')) { capabilities.push('Resolve selected failures to accounts and follow their profile, block status and recent logs when available.'); gaps.push('Auth0 may omit account identifiers; account and event checks are bounded and recent logs are one page.'); }
	if (!tools.has('get_brute_force_settings') && !tools.has('get_ip_throttling_settings'))
		gaps.push('No protection configuration check is included.');
	if (tools.has('get_brute_force_settings') || tools.has('get_ip_throttling_settings'))
		gaps.push('Current settings alone do not establish whether a protection triggered during the anomaly.');
	return {capabilities, gaps};
}
function validateContext(anomaly: InvestigationContext): void {
	if (!Number.isFinite(anomaly.start) || !Number.isFinite(anomaly.end) || Math.abs(anomaly.start) > 8640000000000000 || Math.abs(anomaly.end) > 8640000000000000 || anomaly.start >= anomaly.end
		|| anomaly.end - anomaly.start > 7 * 86400000 || !Array.isArray(anomaly.events) || !anomaly.events.length
		|| anomaly.events.some(e => typeof e.id !== 'string' || !e.id.trim() || e.id.length > 300 || e.id === '.' || e.id === '..'
			|| !((e.kind === 'failure' && ['Failed login', 'Wrong password', 'Unknown user'].includes(e.category)) ||
				(e.kind === 'protection' && ['Brute-force protection', 'Account rate limited', 'IP protection'].includes(e.category)) ||
				(isManual(anomaly) && ((e.kind === 'success' && e.category === 'Successful login') || (e.kind === 'signup' && e.category === 'Successful sign-up'))))
			|| !Number.isFinite(e.time) || e.time < anomaly.start || e.time > anomaly.end) || new Set(anomaly.events.map(e => e.id)).size !== anomaly.events.length || (isManual(anomaly) && !manualQuestions.includes(anomaly.question))) invalid();
}
const stepFields = ['id', 'tool', 'purpose', 'depends', 'ref', 'period', 'sourceRank', 'sourceRef', 'accountIndex', 'historyPage', 'expected'];
const valueType = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const sharedAuthFailure=(value:unknown)=>['RATE_LIMITED','AUTH0_UNAVAILABLE','TIMEOUT','AUTHENTICATION_FAILED'].includes(safeError(value) ?? '');
function graphError(category: string, path: string, expected: string, value: unknown, explanation: string): never {
	throw new GraphValidationError({ category, path, expected, actual: valueType(value), explanation });
}
/** Keep only bounded structural metadata and allowlisted tool names, never model text or IDs. */
export function graphStructure(raw: unknown): GraphStructure {
	if (!object(raw)) return { rootType: valueType(raw) };
	if (!Array.isArray(raw.steps)) return { rootType: 'object' };
	return { rootType: 'object', stepCount: raw.steps.length, steps: raw.steps.slice(0, 6).map((step: unknown, index: number) => {
		if (!object(step)) return { index, type: valueType(step), tool: 'unavailable', hasRef: false, hasPeriod: false, dependencyCount: null, hasUnexpectedFields: false };
		return { index, type: 'object', tool: typeof step.tool === 'string' && Object.hasOwn(registry, step.tool) ? step.tool : 'unrecognized',
			hasRef: Object.hasOwn(step, 'ref'), hasPeriod: Object.hasOwn(step, 'period'),
			dependencyCount: Array.isArray(step.depends) ? Math.min(step.depends.length, 6) : null,
			hasUnexpectedFields: Object.keys(step).some(key => !stepFields.includes(key)) };
	}) };
}
export function validatePlan(raw: unknown, anomaly: InvestigationContext, options: { requireExpected?: boolean; maxSteps?: number } = {}): Step[] {
	validateContext(anomaly);
	if (!object(raw)) graphError('invalid_structure', '$', 'object containing only steps', raw, 'The graph must be an object.');
	if (Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'steps')) graphError('invalid_structure', '$', 'object containing only steps', raw, 'The graph must contain only the steps field.');
	if (!Array.isArray(raw.steps)) graphError('invalid_structure', '$.steps', 'array of 1 to 6 steps', raw.steps, 'Steps must be an array.');
	const maximum = options.maxSteps ?? 8;
	if (!raw.steps.length || raw.steps.length > maximum) graphError('node_count', '$.steps', `1 to ${maximum} steps`, raw.steps, `The graph must contain 1 to ${maximum} steps.`);
	const ids = new Set<string>(), calls = new Set<string>();
	const plan = raw.steps.map((s: unknown, index: number): Step => {
		const path = `$.steps[${index}]`;
		if (!object(s)) graphError('invalid_structure', path, 'step object', s, 'Each step must be an object.');
		if (Object.keys(s).some(key => !stepFields.includes(key))) graphError('invalid_argument_binding', path, 'only id, tool, purpose, expected, depends, ref, period', s, 'The step contains an unsupported field or argument binding.');
		if (!textField(s.id, 24) || !/^[a-z][a-z0-9-]*$/.test(s.id) || Object.hasOwn(Object.prototype, s.id)) graphError('invalid_id', `${path}.id`, 'unique lowercase ID, 1 to 24 characters, letters, digits and hyphens', s.id, 'The step ID is missing or invalid.');
		if (ids.has(s.id)) graphError('duplicate_id', `${path}.id`, 'unique step ID', s.id, 'Step IDs must be unique.');
		if (!textField(s.tool, 40)) graphError('missing_field', `${path}.tool`, 'allowed tool name', s.tool, 'A tool name is required.');
		if (!Object.hasOwn(registry, s.tool)) graphError('unsupported_tool', `${path}.tool`, 'one of the five listed tools', s.tool, 'The tool is not supported.');
		if (!textField(s.purpose, 180)) graphError('missing_field', `${path}.purpose`, 'nonempty string, at most 180 characters', s.purpose, 'A concise purpose is required.');
		if ((options.requireExpected || s.expected !== undefined) && !textField(s.expected, 180)) graphError('missing_field', `${path}.expected`, 'nonempty string, at most 180 characters', s.expected, 'Expected evidence is required for a model proposal.');
		if (!Array.isArray(s.depends) || s.depends.length > 5 || !s.depends.every(d => textField(d, 24)) || new Set(s.depends).size !== s.depends.length)
			graphError('invalid_dependency', `${path}.depends`, 'array of at most 5 unique step IDs', s.depends, 'Dependencies must be an array of unique step IDs.');
		const ref = s.ref;
		const needsRef = s.tool === 'get_log_event' || s.tool === 'search_logs';
		if (needsRef && ref === undefined) graphError('missing_field', `${path}.ref`, 'an event reference listed in the supplied evidence', ref, 'This tool requires an evidence reference.');
		if (needsRef && !anomaly.events.slice(0, 20).some((_, i) => ref === refFor(i))) graphError('unknown_event_reference', `${path}.ref`, 'an event reference listed in the supplied evidence', ref, 'This tool requires a supported evidence reference.');
		if (!needsRef && ref !== undefined) graphError('invalid_argument_binding', `${path}.ref`, 'ref omitted for this tool', ref, 'This tool does not accept an event reference.');
		if (s.tool === 'search_authentication_history' ? !['anomaly', 'previous_window', 'previous_24h'].includes(String(s.period)) : s.period !== undefined)
			graphError('invalid_argument_binding', `${path}.period`, s.tool === 'search_authentication_history' ? 'anomaly, previous_window, or previous_24h' : 'period omitted for this tool', s.period, 'The period binding is missing or not allowed for this tool.');
		const groups = new Set(anomaly.events.filter(event => event.kind === 'failure' && event.source !== undefined).map(event => event.source));
		if (s.tool === 'investigate_source_group' ? !Number.isInteger(s.sourceRank) || (s.sourceRank as number) < 2 || (s.sourceRank as number) > Math.min(groups.size,20) : s.sourceRank !== undefined)
			graphError('invalid_argument_binding', `${path}.sourceRank`, s.tool === 'investigate_source_group' ? 'a selected source rank from 2 to 20' : 'sourceRank omitted', s.sourceRank, 'The source group is missing or not allowed.');
		if (s.tool === 'investigate_account_history' ? !textField(s.sourceRef,24) || !Number.isInteger(s.accountIndex) || (s.accountIndex as number)<0 || (s.accountIndex as number)>=20 || !Number.isInteger(s.historyPage) || (s.historyPage as number)<1 || (s.historyPage as number)>4 || !s.depends.includes(s.sourceRef) : s.sourceRef !== undefined || s.accountIndex !== undefined || s.historyPage !== undefined)
			graphError('invalid_argument_binding', path, 'a verified source, account position and page 1 to 4', s, 'The account history binding is invalid.');
		const key = s.tool + '/' + (s.tool === 'investigate_account_history' ? `${s.sourceRef}/${s.accountIndex}/${s.historyPage}` : ref ?? s.period ?? s.sourceRank ?? '');
		if (calls.has(key)) graphError('duplicate_call', path, 'distinct tool and binding', s, 'The same tool and binding cannot be repeated.');
		ids.add(s.id); calls.add(key);
		return { id: s.id, tool: s.tool as Tool, purpose: s.purpose, depends: [...s.depends], ref: ref as string | undefined,
			period: s.period as Step['period'], sourceRank:s.sourceRank as number | undefined, sourceRef:s.sourceRef as string | undefined, accountIndex:s.accountIndex as number | undefined, historyPage:s.historyPage as number | undefined, expected: s.expected as string | undefined };
	});
	if (!plan.some(s => s.tool === 'get_log_event')) graphError('missing_evidence', '$.steps', 'at least one get_log_event call with a valid ref', raw.steps, 'At least one selected event must be checked.');
	for (const [index, step] of plan.entries()) {
		if (step.depends.some(id => !ids.has(id))) graphError('invalid_dependency', `$.steps[${index}].depends`, 'IDs of existing steps', step.depends, 'A dependency does not name a step in this graph.');
		if (step.tool === 'investigate_account_history' && !plan.some(parent=>parent.id===step.sourceRef && ['investigate_source_accounts','investigate_source_group'].includes(parent.tool))) graphError('invalid_dependency', `$.steps[${index}].sourceRef`, 'an existing source-account check', step.sourceRef, 'Account history requires a verified source check.');
	}
	const done = new Set<string>();
	let depth = 0;
	while (done.size < plan.length) {
		const ready = plan.filter(step => !done.has(step.id) && step.depends.every(id => done.has(id)));
		if (!ready.length) graphError('dependency_cycle', '$.steps', 'acyclic dependencies', raw.steps, 'The graph contains a dependency cycle.');
		if (++depth > 4) graphError('maximum_depth', '$.steps', 'maximum dependency depth of 4', raw.steps, 'The graph exceeds the maximum dependency depth.');
		for (const step of ready) done.add(step.id);
	}
	return plan;
}
export const plannerExample = { steps: [{ id: 'event', tool: 'get_log_event', purpose: 'Verify the selected event type.', expected: 'Recorded event type and time.', depends: [], ref: 'E1' }] };
/** Run every applicable bounded check with evidence bindings supported by this adapter. */
export function fullInvestigationPlan(a: InvestigationContext): Step[] {
	const matching = a.events.slice(0, 20).findIndex(event => event.kind === 'failure' || event.kind === 'protection');
	const steps: Step[] = [
		{id:'event', tool:'get_log_event', purpose:'Verify a selected event.', depends:[], ref:'E1'},
		{id:'account', tool:'get_brute_force_settings', purpose:'Inspect account protection settings.', depends:[]},
		{id:'network', tool:'get_ip_throttling_settings', purpose:'Inspect network throttling settings.', depends:[]},
		{id:'current', tool:'search_authentication_history', purpose:'Inspect activity in the selected window.', depends:[], period:'anomaly'},
		{id:'previous', tool:'search_authentication_history', purpose:'Inspect the preceding equal-length window.', depends:[], period:'previous_window'},
	];
	if (matching >= 0) steps.push({id:'recent', tool:'search_logs', purpose:'Inspect recent events of the selected type.', depends:[], ref:refFor(matching)});
	const plan = addSourceAnalysis(validatePlan({steps}, a), a);
	if (plan.some(step => step.id === 'source-analysis')) plan.push({id:'source-accounts',tool:'investigate_source_accounts',purpose:'Resolve the largest source’s failures to accounts and follow repeated activity.',depends:['source-analysis']});
	return validatePlan({steps:plan}, a);
}

function rateLimitInfo(plan:Step[],results:Results): {present:boolean; seconds?:number} {
 const intervals:number[]=[]; let present=false,missing=false;
 for (const step of plan) {
  const result=results[step.id], account=result?.accountEvidence, facts=result?.facts;
  const entries:Array<[unknown,unknown]>=[[result?.detail,facts?.retryAfterSeconds],[facts?.historyError,facts?.historyRetryAfterSeconds],[result?.historyEvidence?.stopReason,result?.historyEvidence?.retryAfterSeconds],[facts?.allowlistError,facts?.allowlistRetryAfterSeconds],[facts?.aclError,facts?.aclRetryAfterSeconds],[account?.eventStopReason,account?.eventRetryAfterSeconds],[account?.accountStopReason,account?.accountRetryAfterSeconds],[account?.detailStopReason,account?.detailRetryAfterSeconds]];
  for (const [error,seconds] of entries) if (safeError(error)==='RATE_LIMITED') {
   present=true;
   if (typeof seconds==='number' && Number.isFinite(seconds) && seconds>=0 && seconds<=86400) intervals.push(seconds); else missing=true;
  }
 }
 return {present,...(present && !missing && intervals.length ? {seconds:Math.ceil(Math.max(...intervals))} : {})};
}

export function recommendedAction(plan: Step[], results: Results): { action: string; reason: string; reference?: string; kind?:'permissions' | 'prerequisite' | 'verified-block' } {
	const failed = plan.filter(step => results[step.id]?.state !== 'success');
	const event = results.event;
	const allSources = Object.entries(results).filter(([,result])=>result.accountEvidence);
	const source = results['source-accounts']?.accountEvidence;
	const primaryStep=plan.find(step=>step.tool==='investigate_source_accounts');
	const prioritySources=primaryStep ? allSources.filter(([id])=>id===primaryStep.id) : allSources;
	const blockedSource = prioritySources.find(([,result])=>result.accountEvidence!.accounts.some(account=>account.profile==='verified' && (account.blocked || account.bruteForceBlocked)));
	const blocked = prioritySources.reduce((sum,[,result])=>sum+result.accountEvidence!.accounts.filter(account=>account.profile==='verified' && (account.blocked || account.bruteForceBlocked)).length,0);
	if (blocked && blockedSource) return {action:'After confirming the block is no longer needed, have an authorized administrator clear the recorded account block to restore access.',reason:`${blocked} verified account finding(s) show administrative or brute-force blocks; a current block may not explain every failure.${failed.length ? ' Other checks remain incomplete.' : ''}`,reference:blockedSource[0],kind:'verified-block'};
	const missingScopes=new Set<string>();
	let missingReference:string | undefined;
	const scopesByTool:Partial<Record<Tool,string>>={get_log_event:'read:logs',search_logs:'read:logs',search_authentication_history:'read:logs',analyze_source_groups:'read:logs',investigate_source_group:'read:logs',get_brute_force_settings:'read:attack_protection',get_ip_throttling_settings:'read:attack_protection'};
	for (const step of plan) {
	 const result=results[step.id], evidence=result?.accountEvidence;
	 if (safeError(result?.detail)==='MISSING_SCOPE' && scopesByTool[step.tool]) {missingScopes.add(scopesByTool[step.tool]!);missingReference ??= step.id;}
	 if (result?.facts?.allowlistError==='MISSING_SCOPE') {missingScopes.add('read:attack_protection');missingReference ??= step.id;}
	 if (result?.facts?.aclError==='MISSING_SCOPE') {missingScopes.add('read:network_acls');missingReference ??= step.id;}
	 if (result?.facts?.historyError==='MISSING_SCOPE') {missingScopes.add('read:logs');missingReference ??= step.id;}
	 if (result?.historyEvidence?.stopReason==='MISSING_SCOPE') {missingScopes.add('read:logs');missingReference ??= step.id;}
	 if (step.tool==='investigate_account_history' && safeError(result?.detail)==='MISSING_SCOPE') {missingScopes.add('read:logs_users');missingReference ??= step.id;}
	 if (!evidence) continue;
	 if (evidence.applicationConfigs.some(item=>item.error==='MISSING_SCOPE')) {missingScopes.add('read:clients');missingReference ??= step.id;}
	 if (evidence.eventErrors?.MISSING_SCOPE || evidence.detailStopReason==='MISSING_SCOPE') {missingScopes.add('read:logs');missingReference ??= step.id;}
	 if (safeError(evidence.hintLookupError)==='MISSING_SCOPE' || evidence.accounts.some(account=>safeError(account.profileError)==='MISSING_SCOPE' || safeError(account.blocksError)==='MISSING_SCOPE')) {missingScopes.add('read:users');missingReference ??= step.id;}
	 if (evidence.accounts.some(account=>safeError(account.logsError)==='MISSING_SCOPE')) {missingScopes.add('read:logs_users');missingReference ??= step.id;}
	}
	const rate=rateLimitInfo(plan,results);
	if (missingScopes.size) return {action:`Grant the Auth0 Management API permissions ${[...missingScopes].sort().join(', ')} to the connected application, wait ${Math.max(30,rate.seconds ?? 0)} seconds${rate.present && rate.seconds===undefined ? ' and until the rate limit clears' : ''}, then rerun the investigation.`,reason:'Auth0 reported missing permission for one or more required reads; the incomplete evidence does not establish the anomaly’s cause.',reference:missingReference,kind:'permissions'};
	const stoppedSource=plan.find(step=>{const result=results[step.id];return [result?.accountEvidence?.eventStopReason,result?.accountEvidence?.accountStopReason,result?.accountEvidence?.detailStopReason,result?.historyEvidence?.stopReason,result?.facts?.historyError,result?.facts?.allowlistError,result?.facts?.aclError,result?.detail].some(sharedAuthFailure);});
	if (stoppedSource) {
	 const result=results[stoppedSource.id], reason=[result?.accountEvidence?.eventStopReason,result?.accountEvidence?.accountStopReason,result?.accountEvidence?.detailStopReason,result?.historyEvidence?.stopReason,result?.facts?.historyError,result?.facts?.allowlistError,result?.facts?.aclError,result?.detail].map(safeError).find(sharedAuthFailure);
	 const action=reason==='RATE_LIMITED' ? rate.seconds===undefined ? 'Wait for the Auth0 rate limit to clear, then rerun the investigation.' : `Wait at least ${rate.seconds} seconds for the Auth0 rate limit, then rerun the investigation.` : reason==='AUTHENTICATION_FAILED' ? 'Correct the Auth0 application credentials, then rerun the investigation.' : reason==='TIMEOUT' ? 'Wait for the timed-out request to finish, then rerun the investigation.' : 'Retry the investigation after the Auth0 service is available.';
	 return {action,reason:'A shared Auth0 failure stopped further reads, so the available evidence cannot establish the anomaly’s cause.',reference:stoppedSource.id,kind:'prerequisite'};
	}
	const older = Object.entries(results).find(([,result])=>(result.historyEvidence?.matchingSource ?? 0)>0);
	if (older) return {action:'The evidence does not establish a fix; update credentials only if they are confirmed stale.',reason:`An older page contains ${older[1].historyEvidence!.matchingSource} additional verified same-source failure(s).${failed.length ? ' Other checks remain incomplete.' : ''}`,reference:older[0]};
	const repeatedSource=allSources.find(([,result])=>result.accountEvidence!.accounts.some(account=>accountRepetition(account)==='verified'));
	if (repeatedSource) {
	 const repeated=repeatedSource[1].accountEvidence!.accounts.filter(account=>accountRepetition(account)==='verified');
	 return {action:'The evidence does not establish a fix; update credentials only if they are confirmed stale.',reason:`${repeated.length} verified account(s) are directly linked to repeated attempts or recent same-source failures; the cause is unconfirmed.${failed.length ? ' Other checks remain incomplete.' : ''}`,reference:repeatedSource[0]};
	}
	const candidateSource=allSources.find(([,result])=>result.accountEvidence!.accounts.some(account=>accountRepetition(account)==='candidate'));
	if (candidateSource) return {action:'Do not reset credentials solely for an email-derived candidate; confirm the account association before recovery.',reason:'The repeated pattern includes email-derived candidate links, which do not verify who initiated the attempts or establish a cause.',reference:candidateSource[0]};
	if (failed.length) return {action:'The available evidence cannot determine a fix; do not change credentials or protection settings solely for these events.', reason:`${failed.length} check(s) were incomplete, failed or skipped, so the available evidence cannot support a specific fix.`, reference:failed[0].id};
	if (source) {
		if (source.missingIdentity || source.failedEvents || source.unchecked || source.uncheckedAccounts || source.differentSource || !source.accounts.length || source.accounts.some(account => account.profile !== 'verified' || account.logs !== 'retrieved' || account.bruteForceBlocked === null || account.recentDetailsFailed || account.invalidRecentEvents || account.logsPageFull || account.logsEmpty) || source.detailBudgetReached)
			return {action:'Resolve the listed evidence gaps before selecting a remediation.',reason:'Some source events or account checks could not be verified; no specific cause is established.',reference:'source-accounts'};
		return {action:'Do not reset account credentials solely for these events; the checked accounts do not indicate a specific recovery action.',reason:`${source.matched} selected source events were checked across ${source.accounts.length} accounts; no repeated same-source failures or account blocks were found in the returned pages.`,reference:'source-accounts'};
	}
	if (event?.state === 'success' && event.facts?.category === 'Wrong password') return {
		action:'Verify the affected credentials with the account owner and update any confirmed stale credential.',
		reason:'A selected event reports an incorrect password; the event alone does not establish which credential is stale.', reference:'event',
	};
	if (event?.state === 'success' && event.facts?.category === 'Unknown user') return {
		action:'Verify the account identifier and its configured identity provider with the user.',
		reason:'A selected event reports an unknown username; the cause still requires confirmation.', reference:'event',
	};
	return {action:'Review the selected event and its source with the responsible identity administrator before changing protection settings.', reason:'The available checks do not establish a specific root cause.', reference:'event'};
}
export const plannerInstructions = `Choose the minimum read-only checks that help answer the question. Return exactly one JSON object, no prose or additional root fields: {"steps":[...]}. Include 1 to 6 distinct calls and at least one get_log_event for selected evidence.
Each step is an object with only id, tool, purpose, expected, depends, and the tool-specific ref or period when required. id is unique, 1-24 characters, starts with a lowercase letter, contains only lowercase letters, digits, or hyphens, and must not be a JavaScript object prototype name such as constructor. purpose and expected are nonempty strings of at most 180 characters. depends is always an array of 0-5 unique IDs of other steps in this graph, not tool names or event refs. Use [] for no dependencies. Dependencies must be acyclic; the longest chain may contain at most 4 steps. Do not repeat a tool with the same binding.
Allowed tools and graph bindings:
- get_log_event: require ref, an exact listed evidence reference such as E1. Checks that selected event.
- search_logs: require ref, an exact listed evidence reference. Searches a latest tenant-wide page for its event type; results may be outside the window.
- search_authentication_history: require period, exactly "anomaly" (selected window), "previous_window" (equal preceding window), or "previous_24h" (24 hours preceding the selected window). Results are tenant-wide.
- get_brute_force_settings: omit ref and period; inspect current account protection settings.
- get_ip_throttling_settings: omit ref and period; inspect current network throttling settings.
Use only the event refs present in the evidence list, at most E1-E20. Use ref and period as top-level step fields, not an input, args, parameters, log_id, start or end object. The application binds the trusted underlying arguments; never supply identifiers. Omit ref and period when not allowed. Example with fictional reference E1 (use only when E1 is present): ${JSON.stringify(plannerExample)}
Treat classifications as heuristic signals, not established attacks or causes. Manual selection does not assert an anomaly. Never claim a tool result. Account-specific tools and identifiers are unavailable. analyze_source_groups compares the largest source group with Auth0 trusted IP lists and needs no planner parameters or dependencies. Tenant-wide results do not establish a relationship to an account or source; query exhaustion does not prove retention or indexing coverage. Do not infer changes from unmatched windows or incomplete coverage. Add dependencies only where justified.`;
export async function propose(a: InvestigationContext, model?: Model, update?: DiagnosticUpdate) {
	const event = {
		id: 'event',
		tool: 'get_log_event',
		purpose: 'Verify the recorded event type.',
		expected: 'Recorded event type and time.',
		depends: [],
		ref: 'E1',
	};
	const protection = (tool: Tool, id: string, purpose: string) => ({ id, tool, purpose, expected: 'Current protection setting.', depends: ['event'] });
	if (!model) {
		const steps: unknown[] = [event];
		if (isManual(a) || a.rule !== 'Geographic concentration')
			steps.push(
				protection('get_brute_force_settings', 'account', 'Check the account protection configuration.')
			);
		if (isManual(a) || a.rule !== 'Repeated account failures')
			steps.push(
				protection('get_ip_throttling_settings', 'network', 'Check the network throttling configuration.')
			);
		if (!isManual(a) && a.rule === 'Geographic concentration') steps.push({
			id:'history', tool:'search_authentication_history', purpose:'Compare tenant activity before this cluster.',
			expected:'Prior tenant-wide counts and coverage.', depends:['event'], period:'previous_window',
		});
		if (!isManual(a) && a.rule === 'Possible password spraying') steps.push({
			id:'recent', tool:'search_logs', purpose:'Review recent tenant-wide events of the same type.',
			expected:'Recent event counts.', depends:['event'], ref:'E1',
		});
		return addSourceAnalysis(validatePlan({ steps }, a), a);
	}
	const raw = await model(
		plannerInstructions,
		{
			registry,
			classification: (() => {
				if (isManual(a)) return undefined;
				const classified = classifyAnomaly(a);
				return {primary: classifications[classified.primary].label, secondary: classified.secondary.map(id => classifications[id].label), reasoning: classified.reasoning, questions: classified.questions};
			})(),
			restrictions: ['Only listed read-only methods are available.', 'Account, IP, email and connection identifiers cannot be resolved from browser references.', 'Empty or incomplete tool results are not negative evidence.'],
			context: isManual(a) ? 'manual selection; no anomaly asserted' : 'detected anomaly',
			question: isManual(a) ? a.question : undefined,
			window: {start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString()},
			counts: {selected:a.events.length, failures:a.events.filter(e => e.kind === 'failure').length, successes:a.events.filter(e => e.kind === 'success').length, signups:a.events.filter(e => e.kind === 'signup').length, protection:a.events.filter(e => e.kind === 'protection').length},
			rule: isManual(a) ? undefined : a.rule,
			explanation: isManual(a) ? undefined : a.explanation,
			uncertainty: a.limitation,
			events: a.events.slice(0, 20).map((e, i) => ({
				ref: refFor(i),
				type: e.category,
				utc: new Date(e.time).toISOString(),
			})),
		}, update
	);
	const proposed = parsePlannerResponse(raw, update);
	try {
		const plan = validatePlan(proposed, a, { requireExpected: true });
		update?.({schema:'valid'});
		return addSourceAnalysis(plan, a);
	} catch (error) {
		if (error instanceof GraphValidationError) {
			update?.({schema:'invalid', category:error.issue.category, validation:error.issue, graphStructure:graphStructure(proposed)});
			throw error;
		}
		update?.({schema:'invalid', category:'invalid_context'});
		throw new PlannerError('invalid_graph');
	}
}
/** Add a source analysis based on the selected snapshot. */
function addSourceAnalysis(plan: Step[], context: InvestigationContext): Step[] {
 if (!context.events.some(event => event.kind === 'failure') || plan.some(step => step.tool === 'analyze_source_groups')) return plan;
 let id = 'source-analysis';
 for (let n = 1; plan.some(step => step.id === id); n++) id = `source-analysis-${n}`;
 return [...plan, {id, tool:'analyze_source_groups', purpose:'Compare the largest failure source with Auth0 trusted IP lists.', expected:'Source counts, representative IP and allowlist matches.', depends:[]}];
}

export function fixtureTools(a: InvestigationContext): ToolClient {
	const sourceGroups = [...new Set(a.events.map(event => event.source).filter((source): source is number => source !== undefined))];
	return {
		async tool({ tool, input }) {
			if (tool === 'get_log_event') {
				const e = a.events.find((item) => item.id === input.log_id);
				return e
					? { success: true, log_id: e.id, date: new Date(e.time).toISOString(), type: code(e), ...(input.analytics ? {} : {user_id:e.account ? `auth0|fixture-${e.account}` : null}), ...((input.include_source || input.compare_source) ? {source_ip:e.source === undefined ? null : `192.0.${2 + Math.floor((sourceGroups.indexOf(e.source) + 10) / 256)}.${(sourceGroups.indexOf(e.source) + 10) % 256}`} : {}), ...(input.compare_source ? {brute_force_allowlisted:true, ip_throttling_allowlisted:false} : {}) }
					: { success: false };
			}
			if (tool === 'compare_network_acl_ranges') {
			 const e=a.events.find(item=>item.id===input.log_id);
			 return e && e.source!==undefined ? {success:true,log_id:e.id,date:new Date(e.time).toISOString(),type:code(e),source_ip:`192.0.${2 + Math.floor((sourceGroups.indexOf(e.source) + 10) / 256)}.${(sourceGroups.indexOf(e.source) + 10) % 256}`,ip_range_matches:1,active_rules_checked:2,coverage:'retrieved'} : {success:false};
			}
			if (tool === 'get_user') return {success:true, user_id:input.user_id, blocked:false, connections:[]};
			if (tool === 'get_user_blocks') return {success:true, has_blocks:false, block_count:0, blocks:[]};
			if (tool === 'get_user_logs') {
				const events = a.events.filter(e => e.account && `auth0|fixture-${e.account}` === input.user_id).slice(0,20).map(e => ({log_id:e.id,date:new Date(e.time).toISOString(),type:code(e),description:e.category}));
				return {success:true,events,count:events.length};
			}
			if (tool === 'search_logs') {
				const events = a.events.filter(e => code(e) === input.event_type).map(e => ({
					log_id: e.id, date: new Date(e.time).toISOString(), type: code(e), description: e.category,
				}));
				return {success:true, events, count:events.length};
			}
			if (tool === 'search_authentication_history') {
				const events = a.events.filter(e => e.time >= Date.parse(String(input.start)) && e.time <= Date.parse(String(input.end))).map(e => ({
					log_id:e.id, date:new Date(e.time).toISOString(), type:code(e), description:e.category,
				}));
				return {success:true, events, count:events.length, pages:1, coverage:'partial', reason:'FIXTURE_SCOPE', rejected:0, duplicates:0, retry_after_seconds:null};
			}
			if (Object.hasOwn(registry, tool))
				return { success: true, enabled: tool === 'get_brute_force_settings' };
			return { success: false };
		},
	};
}
function code(e: Event) {
	const types: Record<string, string> = {'Unknown user':'fu', 'Wrong password':'fp', 'Failed login':'f',
		'Brute-force protection':'limit_wc', 'Account rate limited':'limit_sul', 'IP protection':'limit_mu',
		'Successful login':'s', 'Successful sign-up':'ss'};
	return types[e.category];
}

/** ACL range membership is evidence of configuration, not an evaluated rule or ownership. */
async function compareNetworkAcl(sample:Event, sourceIp:unknown, facts:Record<string,string | number | boolean>, client:ToolClient, token:string, timeout:number, active:()=>boolean, progress:(message:string)=>void):Promise<void> {
 if (typeof sourceIp!=='string' || sourceIp==='Unavailable') { facts.aclCoverage='source_unavailable'; return; }
 let result=await invokeRead(client,token,'compare_network_acl_ranges',{log_id:sample.id},timeout);
 const delay=retryableRateDelay([result]);
 if (delay!==undefined && active()) {
  progress(`Auth0 rate limit: waiting ${delay} second(s) before retrying the ACL comparison…`);
  if (await waitForRetry(delay,active)) {result=await invokeRead(client,token,'compare_network_acl_ranges',{log_id:sample.id},timeout);facts.aclRateRetries=1;}
 }
 const data=result.data;
 if (result.status!=='success' || !data || data.log_id!==sample.id || data.type!==code(sample) || typeof data.date!=='string' || Date.parse(data.date)!==sample.time || data.source_ip!==sourceIp) {
  facts.aclCoverage='unavailable';
  const error=safeError(result.error); if (error) facts.aclError=error;
  if (error==='RATE_LIMITED' && result.retryAfterSeconds!==undefined && result.retryAfterSeconds<=86400) facts.aclRetryAfterSeconds=result.retryAfterSeconds;
  return;
 }
 facts.aclCoverage=String(data.coverage);
 facts.aclRulesChecked=data.active_rules_checked as number;
 if (typeof data.ip_range_matches==='number') facts.aclRangeMatches=data.ip_range_matches;
}

async function compareSource(sample:Event, facts:Record<string,string | number | boolean>, client:ToolClient, token:string, timeout:number, active:()=>boolean, progress:(message:string)=>void) {
 let result=await invokeRead(client,token,'get_log_event',{log_id:sample.id,analytics:true,compare_source:true},timeout);
 const delay=retryableRateDelay([result]);
 if (delay!==undefined && active()) {
  progress(`Auth0 rate limit: waiting ${delay} second(s) before retrying the trusted IP comparison…`);
  if (await waitForRetry(delay,active)) {result=await invokeRead(client,token,'get_log_event',{log_id:sample.id,analytics:true,compare_source:true},timeout);facts.allowlistRateRetries=1;}
 }
 return result;
}

export async function execute(
	plan: Step[],
	a: InvestigationContext,
	client: ToolClient,
	token: string,
	update: (r: Results) => void,
	active = () => true,
	timeout = 30000,
	snapshot?: Event[],
	previousResults?: Results
) {
	const checked = validatePlan({ steps: plan }, a, {maxSteps:previousResults ? 8 + MAX_AUTOMATIC_FOLLOWUPS : 8});
	const results: Results = Object.fromEntries(
		checked.map((s) => [s.id, previousResults?.[s.id] ?? { state: 'queued', detail: 'Awaiting dependencies.' }])
	);
	function record(id: string, result: Result) {
		results[id] = result;
		if (active()) update({ ...results });
	}
	for (const level of layers(checked)) {
		if (!active()) throw new Error('Investigation closed.');
		await Promise.all(
			level.map(async (s) => {
				if (results[s.id].state !== 'queued') return;
				if (s.tool==='investigate_source_accounts' && Object.values(results).some(result=>[result.detail,result.facts?.historyError,result.facts?.allowlistError,result.facts?.aclError].some(sharedAuthFailure))) return record(s.id,{state:'skipped',detail:'Account reads stopped after an Auth0 failure.'});
				if (s.depends.some((id) => results[id].state !== 'success' && !(s.tool==='investigate_account_history' && results[id].state==='partial') && !(s.tool==='investigate_source_accounts' && id==='source-analysis' && results[id].state==='partial' && typeof results[id].facts?.sourceIp==='string' && results[id].facts?.sourceIp!=='Unavailable' && !sharedAuthFailure(results[id].facts?.allowlistError) && !sharedAuthFailure(results[id].facts?.aclError))))
					return record(s.id, { state: 'skipped', detail: 'Required evidence was unavailable.' });
				const event = s.ref ? a.events[Number(s.ref.slice(1)) - 1] : undefined;
				if (s.tool === 'investigate_account_history') {
				 const origin=results[s.sourceRef!], account=origin?.accountEvidence?.accounts[s.accountIndex!];
				 const sourceIp=s.sourceRef==='source-accounts' ? results['source-analysis']?.facts?.sourceIp : origin?.facts?.sourceIp;
				 const earlier=checked.filter(step=>step.tool==='investigate_account_history' && step.sourceRef===s.sourceRef && step.accountIndex===s.accountIndex && (step.historyPage ?? 0)<s.historyPage!);
				 const previous=earlier.find(step=>step.historyPage===s.historyPage!-1);
				 const hasNext=s.historyPage===1 ? account?.logsPageFull : previous && results[previous.id]?.historyEvidence?.pageFull;
				 if (!account || account.profile!=='verified' || typeof sourceIp!=='string' || sourceIp==='Unavailable' || !hasNext)
				  return record(s.id,{state:'skipped',detail:'A verified account and an unexhausted previous page are required.'});
				 const seen=[...(origin.accountEvidence?.verifiedEventIds ?? []),...account.verifiedRecentEventIds,...earlier.flatMap(step=>results[step.id]?.historyEvidence?.verifiedEventIds ?? [])];
				 record(s.id,{state:'running',detail:`Checking older account history, page ${s.historyPage}…`});
				 try {
				  const historyEvidence=await investigateAccountHistoryPage(account,sourceIp,s.historyPage!,seen,client,token,active,timeout);
				  const facts={page:historyEvidence.page,returned:historyEvidence.returned,failures:historyEvidence.failures,verified:historyEvidence.verified,matchingSource:historyEvidence.matchingSource,duplicates:historyEvidence.duplicates,unavailable:historyEvidence.unavailable,unchecked:historyEvidence.unchecked,rateRetries:historyEvidence.rateRetries,pageFull:historyEvidence.pageFull};
				  return record(s.id,{state:historyEvidence.pageFull || historyEvidence.unavailable || historyEvidence.duplicates || historyEvidence.unchecked || historyEvidence.stopReason ? 'partial' : 'success',detail:`Page ${historyEvidence.page}: ${historyEvidence.matchingSource} additional same-source failure(s) verified.`,facts,historyEvidence});
				 } catch (failure) { return record(s.id,{state:'failed',detail:failure instanceof Error ? failure.message : 'Account history unavailable.',...(failure instanceof AccountHistoryReadError && failure.retryAfterSeconds!==undefined && failure.retryAfterSeconds<=86400 ? {facts:{retryAfterSeconds:failure.retryAfterSeconds}} : {})}); }
				}
				if (s.tool === 'investigate_source_group') {
				 const groups = new Map<number, Event[]>();
				 for (const item of a.events) if (item.kind === 'failure' && item.source !== undefined) groups.set(item.source,[...(groups.get(item.source) ?? []),item]);
				 const ranked = [...groups.entries()].sort((left,right)=>right[1].length-left[1].length);
				 const group = ranked[(s.sourceRank ?? 0)-1];
				 if (!group?.[1].length) return record(s.id,{state:'skipped',detail:'The selected source group is unavailable.'});
				 const [sourceId,selected] = group, sample = selected[0];
				 const facts:Record<string,string | number | boolean> = {sourceRank:s.sourceRank!,selectedFailures:selected.length};
				 if (snapshot) {
				  const traffic=snapshot.filter(item=>item.source===sourceId && item.time>=a.start && item.time<=a.end && (item.kind==='failure' || item.kind==='success'));
				  const failures=traffic.filter(item=>item.kind==='failure').length;
				  facts.windowFailures=failures; facts.windowSuccesses=traffic.length-failures;
				  facts.windowFailureRate=traffic.length ? Math.round(failures*1000/traffic.length)/10 : 'Unavailable';
				 }
				 record(s.id,{state:'running',detail:`Verifying source group ${s.sourceRank}…`,facts});
				 const response=await compareSource(sample,facts,client,token,timeout,active,message=>record(s.id,{state:'running',detail:message,facts}));
				 if (!active()) throw new Error('Investigation closed.');
				 const valid=(value:Record<string,unknown> | undefined)=>!!value && value.log_id===sample.id && value.type===code(sample) && typeof value.date==='string' && Date.parse(value.date)===sample.time && (value.source_ip===null || typeof value.source_ip==='string');
				 let data=response.data;
				 if (response.status!=='success' || !valid(data)) {
				  const error=safeError(response.error);
				  if (error && sharedAuthFailure(error)) {
				   facts.allowlistStatus='Unavailable'; facts.allowlistError=error;
				   if (error==='RATE_LIMITED' && response.retryAfterSeconds!==undefined && response.retryAfterSeconds<=86400) facts.allowlistRetryAfterSeconds=response.retryAfterSeconds;
				   return record(s.id,{state:'partial',detail:'Source comparison stopped after an Auth0 failure.',facts});
				  }
				  const fallback=await invokeRead(client,token,'get_log_event',{log_id:sample.id,analytics:true,include_source:true},timeout);
				  if (fallback.status!=='success' || !valid(fallback.data)) return record(s.id,{state:'failed',detail:fallback.error ?? 'Source event could not be verified.',facts});
				  data=fallback.data; facts.allowlistStatus='Unavailable';
				  if (safeError(response.error)) facts.allowlistError=safeError(response.error)!;
				  if (safeError(response.error)==='RATE_LIMITED' && response.retryAfterSeconds!==undefined && response.retryAfterSeconds<=86400) facts.allowlistRetryAfterSeconds=response.retryAfterSeconds;
				 }
				 facts.sourceIp=typeof data?.source_ip==='string' ? data.source_ip : 'Unavailable';
				 facts.bruteForceAllowlisted=typeof response.data?.brute_force_allowlisted==='boolean' ? response.data.brute_force_allowlisted : 'Unknown';
				 facts.throttlingAllowlisted=typeof response.data?.ip_throttling_allowlisted==='boolean' ? response.data.ip_throttling_allowlisted : 'Unknown';
				 if (facts.sourceIp==='Unavailable') return record(s.id,{state:'partial',detail:'Source IP was unavailable; accounts could not be correlated.',facts});
				 if (!sharedAuthFailure(facts.allowlistError)) await compareNetworkAcl(sample,facts.sourceIp,facts,client,token,timeout,active,message=>record(s.id,{state:'running',detail:message,facts}));
				 if (sharedAuthFailure(facts.allowlistError) || sharedAuthFailure(facts.aclError)) return record(s.id,{state:'partial',detail:'Source comparison stopped after an Auth0 failure.',facts});
				 const accountEvidence=await investigateSourceAccounts(selected,facts.sourceIp,client,token,message=>record(s.id,{state:'running',detail:message,facts}),active,timeout);
				 const partial=facts.aclCoverage!=='retrieved' || facts.allowlistStatus==='Unavailable' || accountEvidence.fingerprintFallbacks>0 || accountEvidence.applicationFallbacks>0 || accountEvidence.applicationConfigUnchecked>0 || accountEvidence.applicationConfigs.some(item=>item.status!=='verified') || accountEvidence.missingIdentity>0 || accountEvidence.failedEvents>0 || accountEvidence.differentSource>0 || accountEvidence.unchecked>0 || accountEvidence.uncheckedAccounts>0 || accountEvidence.detailBudgetReached || accountEvidence.accounts.some(account=>account.profile!=='verified' || account.logs!=='retrieved' || account.bruteForceBlocked===null || account.recentDetailsFailed>0 || account.invalidRecentEvents>0 || account.logsPageFull || account.logsEmpty);
				 return record(s.id,{state:partial?'partial':'success',detail:`Source group ${s.sourceRank}: ${accountEvidence.matched} of ${accountEvidence.selected} failures verified across ${accountEvidence.accounts.length} account(s).`,facts,accountEvidence});
				}
				if (s.tool === 'investigate_source_accounts') {
				 const source = results['source-analysis']?.facts;
				 const sourceIp = source?.sourceIp;
				 const failures = a.events.filter(item => item.kind === 'failure' && item.source !== undefined);
				 const groups = new Map<number, number>();
				 for (const item of failures) groups.set(item.source!, (groups.get(item.source!) ?? 0) + 1);
				 const largest = [...groups.entries()].sort((a,b)=>b[1]-a[1])[0];
				 if (!largest || typeof sourceIp !== 'string' || sourceIp === 'Unavailable') return record(s.id,{state:'skipped', detail:'Source IP is unavailable; account correlation cannot be verified.'});
				 const selected = failures.filter(item => item.source === largest[0]);
				 const accountEvidence = await investigateSourceAccounts(selected,sourceIp,client,token,message => record(s.id,{state:'running',detail:message}),active,timeout);
				 const partial = accountEvidence.fingerprintFallbacks > 0 || accountEvidence.applicationFallbacks > 0 || accountEvidence.applicationConfigUnchecked > 0 || accountEvidence.applicationConfigs.some(item=>item.status!=='verified') || accountEvidence.missingIdentity > 0 || accountEvidence.failedEvents > 0 || accountEvidence.differentSource > 0 || accountEvidence.unchecked > 0 || accountEvidence.uncheckedAccounts > 0 || accountEvidence.detailBudgetReached || accountEvidence.accounts.some(account => account.profile !== 'verified' || account.logs !== 'retrieved' || account.bruteForceBlocked === null || account.recentDetailsFailed > 0 || account.invalidRecentEvents > 0 || account.logsPageFull || account.logsEmpty);
				 return record(s.id,{state:partial ? 'partial' : 'success',detail:`${accountEvidence.matched} of ${accountEvidence.selected} source failures verified · ${accountEvidence.accounts.length} account(s) identified · ${accountEvidence.missingIdentity} missing account ID`,accountEvidence});
				}
				if (s.tool === 'analyze_source_groups') {
				 const failures = a.events.filter(event => event.kind === 'failure');
				 const groups = new Map<number, number>();
				 for (const event of failures) if (event.source !== undefined) groups.set(event.source, (groups.get(event.source) ?? 0) + 1);
				 const grouped = [...groups.values()].reduce((sum, count) => sum + count, 0);
				 const facts: Record<string, string | number | boolean> = {selectedFailures:failures.length, withSource:grouped, missingSource:failures.length-grouped,
				  sourceGroups:groups.size, largestGroup:Math.max(0, ...groups.values()),
				  scope:'Selected snapshot only; shared source can be shared egress, not proof of an actor.'};
				 const largest = [...groups.entries()].sort((a,b) => b[1] - a[1])[0];
				 if (largest && snapshot) {
				  const traffic = snapshot.filter(item => item.source === largest[0] && item.time >= a.start && item.time <= a.end && (item.kind === 'failure' || item.kind === 'success'));
				  const sourceFailures = traffic.filter(item => item.kind === 'failure').length;
				  facts.windowFailures = sourceFailures;
				  facts.windowSuccesses = traffic.length - sourceFailures;
				  facts.windowFailureRate = traffic.length ? Math.round(sourceFailures * 1000 / traffic.length) / 10 : 'Unavailable';
				  facts.windowCoverage = 'Loaded snapshot only; retention, indexing and pagination may limit coverage.';
				 }
				 const sample = failures.find(event => event.source === largest?.[0]);
				 if (sample) {
				  record(s.id, {state:'running', detail:'Checking the largest source against Auth0 trusted IP lists.'});
				  const response = await compareSource(sample,facts,client,token,timeout,active,message=>record(s.id,{state:'running',detail:message,facts}));
				  if (!active()) throw new Error('Investigation closed.');
				  const r = response.data;
				  const valid = (value: Record<string, unknown> | undefined) => !!value && value.log_id === sample.id && value.type === code(sample) && typeof value.date === 'string' && Date.parse(value.date) === sample.time && (value.source_ip === null || typeof value.source_ip === 'string');
				  let source = r;
				  if (response.status !== 'success' || !valid(r)) {
				   const error=safeError(response.error);
				   if (error && sharedAuthFailure(error)) {
				    facts.allowlistStatus='Unavailable'; facts.allowlistError=error;
				    if (error==='RATE_LIMITED' && response.retryAfterSeconds!==undefined && response.retryAfterSeconds<=86400) facts.allowlistRetryAfterSeconds=response.retryAfterSeconds;
				    return record(s.id,{state:'partial',detail:'Source comparison stopped after an Auth0 failure.',facts});
				   }
				   const fallback = await invokeRead(client,token,'get_log_event',{log_id:sample.id,analytics:true,include_source:true},timeout);
				   if (fallback.status !== 'success' || !valid(fallback.data)) return record(s.id,{state:'failed',detail:fallback.error ?? 'Source event could not be verified.',facts});
				   source = fallback.data;
				   facts.allowlistStatus = 'Unavailable';
				   if (safeError(response.error)) facts.allowlistError=safeError(response.error)!;
				   if (safeError(response.error)==='RATE_LIMITED' && response.retryAfterSeconds!==undefined && response.retryAfterSeconds<=86400) facts.allowlistRetryAfterSeconds=response.retryAfterSeconds;
				  }
				  facts.sourceIp = typeof source?.source_ip === 'string' ? source.source_ip : 'Unavailable';
				  facts.bruteForceAllowlisted = typeof r?.brute_force_allowlisted === 'boolean' ? r.brute_force_allowlisted : 'Unknown';
				  facts.throttlingAllowlisted = typeof r?.ip_throttling_allowlisted === 'boolean' ? r.ip_throttling_allowlisted : 'Unknown';
				  facts.asn = 'Unavailable from this check';
				  if (!sharedAuthFailure(facts.allowlistError)) await compareNetworkAcl(sample,facts.sourceIp,facts,client,token,timeout,active,message=>record(s.id,{state:'running',detail:message,facts}));
				 }
				 return record(s.id, {state:facts.aclCoverage && facts.aclCoverage!=='retrieved' || facts.allowlistStatus==='Unavailable' ? 'partial' : 'success', detail: grouped ? `${facts.largestGroup} of ${failures.length} failures share the largest known source group · ${facts.missingSource} missing source` : `Source unavailable for all ${failures.length} selected failures.`, facts});
				}
				record(s.id, { state: 'running', detail: 'Waiting for the tool response.' });
				const input = s.tool === 'get_log_event' ? {log_id:event!.id, analytics:true}
					: s.tool === 'search_logs' ? {event_type:code(event!), analytics:true, limit:50}
					: s.tool === 'search_authentication_history' ? {
						start:new Date(s.period === 'anomaly' ? a.start : a.start - (s.period === 'previous_window' ? a.end - a.start : 86400000)).toISOString(),
						end:new Date(s.period === 'anomaly' ? a.end : a.start).toISOString(),
					} : {};
				const response = await invokeRead(
					client,
					token,
					s.tool,
					input,
					s.tool === 'search_authentication_history' ? Math.max(timeout, 180000) : timeout
				);
				if (response.status === 'error')
					return record(s.id, { state: 'failed', detail: response.error ?? 'Tool failed.', ...(response.retryAfterSeconds!==undefined && response.retryAfterSeconds<=86400 ? {facts:{retryAfterSeconds:response.retryAfterSeconds}} : {}) });
				if (s.tool === 'get_log_event' && event) {
					const r = response.data;
					if (
						!r ||
						r.log_id !== event.id ||
						r.type !== code(event) ||
						typeof r.date !== 'string' ||
						Date.parse(r.date) !== event.time
					)
						return record(s.id, {
							state: 'failed',
							detail: 'Returned event did not match the selected evidence.',
						});
					record(s.id, {
						state: 'success',
						detail: event.category,
						facts: { reference: s.ref!, category: event.category, utc: new Date(event.time).toISOString() },
					});
				} else if (s.tool === 'search_logs' || s.tool === 'search_authentication_history') {
					const rows = response.data?.events;
					if (!Array.isArray(rows)) return record(s.id, {state:'failed',detail:'Invalid event result.'});
					if (s.tool === 'search_logs' && rows.some(row => !row || row.type !== code(event!)))
						return record(s.id, {state:'failed',detail:'Returned events did not match the requested event type.'});
					const normalized = normalize(rows);
					const historyError=s.tool==='search_authentication_history' && response.data?.coverage==='partial' ? safeError(response.data?.reason) : undefined;
					const historyRetryAfterSeconds=historyError==='RATE_LIMITED' && typeof response.data?.retry_after_seconds==='number' && response.data.retry_after_seconds<=86400 ? response.data.retry_after_seconds : undefined;
					const facts = {
						scope:'Tenant-wide', returned:rows.length, recognized:normalized.events.length,
						successes:normalized.events.filter(e=>e.kind==='success').length,
						failures:normalized.events.filter(e=>e.kind==='failure').length,
						signups:normalized.events.filter(e=>e.kind==='signup').length,
						protection:normalized.events.filter(e=>e.kind==='protection').length,
						coverage:s.tool === 'search_logs' ? 'Latest page, at most 50 events'
							: response.data?.coverage === 'retrieved' ? 'Query exhausted; retention and indexing unverified' : 'partial',
						...(s.tool === 'search_authentication_history' ? {start:input.start as string, end:input.end as string, reason:String(response.data?.reason ?? 'none')} : {}),
						...(historyError ? {historyError} : {}),
						...(historyRetryAfterSeconds!==undefined ? {historyRetryAfterSeconds} : {}),
					};
					record(s.id,{state:facts.coverage==='partial' ? 'partial' : 'success',detail:`${facts.recognized} recognized events · ${facts.coverage}`,facts});
				} else {
					const enabled = response.data?.enabled === true;
					record(s.id, {
						state: 'success',
						detail: enabled ? 'Protection enabled' : 'Protection disabled',
						facts: { enabled },
					});
				}
			})
		);
	}
	return results;
}

type Interpretation = {
	reference: string;
	possibleCause: string;
	uncertainty: string;
	nextStep: string;
	possibleRemediation: string;
};
export async function findings(plan: Step[], results: Results, model?: Model, anomaly?: InvestigationContext) {
	const observations = plan
		.filter((s) => results[s.id]?.state === 'success')
		.map((s) => ({
			id: s.id,
			tool: s.tool,
			observation: results[s.id].detail,
			  evidence: results[s.id].facts ? Object.fromEntries(Object.entries(results[s.id].facts!).filter(([key]) => key !== 'sourceIp')) : undefined,
		}));
	if (!observations.length) return [];
	const fixture = observations.map((item): Interpretation => {
		const event = item.tool === 'get_log_event';
		const protectionEvent = event && ['Brute-force protection', 'Account rate limited', 'IP protection'].includes(String(item.evidence?.category));
		const sourceAnalysis = item.tool === 'analyze_source_groups';
		const activity = item.tool === 'search_logs' || item.tool === 'search_authentication_history';
		return {
			reference: item.id,
			possibleCause: sourceAnalysis ? 'Shared sources may reflect shared networks or repeated activity.' : event && !['Failed login', 'Wrong password', 'Unknown user'].includes(String(item.evidence?.category)) && !protectionEvent ? 'The event alone does not establish a cause.' : activity
				? 'The observed volume could reflect normal traffic or a change in authentication activity.'
				: protectionEvent ? 'Repeated or rate-limited attempts may have triggered a protection.'
				: event
				? 'Incorrect or stale credentials could explain this failure.'
				: 'Protection settings may influence how retries are handled.',
			uncertainty: sourceAnalysis ? 'Missing source data and shared networks limit attribution.' : activity
				? 'These tenant-wide counts do not identify the cause or establish a link to a particular account.'
				: protectionEvent ? 'One protection event does not establish malicious intent or current account status.'
				: event
				? 'One event cannot establish who initiated the sign-in.'
				: 'Current configuration does not establish what happened during an earlier attempt.',
			nextStep: sourceAnalysis ? 'Review shared source groups with network context to distinguish shared access from unusual activity.' : activity
				? 'Compare the returned coverage and time window with independently verified activity.'
				: protectionEvent ? 'Review the event time and applicable protection settings.'
				: event
				? 'Compare the event time with the sign-in report.'
				: 'Compare the observed configuration with the approved tenant policy.',
			possibleRemediation: sourceAnalysis ? 'Review any response with the security team before taking action.' : activity
				? 'Review mitigation options only after confirming the pattern and its cause.'
				: protectionEvent ? 'Review the protection policy and legitimate access through the normal approval process.'
				: event
				? 'If a stale credential is verified, have the owner update it through the standard recovery process.'
				: 'If configuration drift is confirmed, ask the tenant administrator to review a policy change.',
		};
	});
	const data = {
		observations,
		rule: anomaly && !isManual(anomaly) ? anomaly.rule : undefined,
		signal: anomaly && !isManual(anomaly) ? anomaly.explanation : undefined,
		context: anomaly && isManual(anomaly) ? 'manual selection; no anomaly asserted' : 'detected anomaly',
		limitation: anomaly?.limitation,
		missing: plan.filter((s) => results[s.id]?.state !== 'success').map((s) => s.tool),
		questions: anomaly ? isManual(anomaly) ? [anomaly.question] : classifyAnomaly(anomaly).questions : [],
	};
	const response = model
		? await model(
					'Interpret the supplied investigation context and current tool observations. When an analyze_source_groups observation is present, include a finding citing its exact id and report its largestGroup, selectedFailures and missingSource counts. Do not recommend redoing that completed analysis. A manual selection does not establish an anomaly. Explicitly state when the evidence is insufficient. Return only {"findings":[{"reference":"successful step id","possibleCause":"conditional hypothesis with alternatives","uncertainty":"missing evidence and unanswered questions","nextStep":"specific verification","possibleRemediation":"conditional suggestion for human review"}]}. Use the id field of a successful observation as each reference, never the event reference within its evidence. Use distinct successful step references. Every field must be a nonempty string of at most 240 characters. Make nextStep one short, actionable sentence explaining why the action helps, at most 140 characters. Ground each interpretation in its cited observation. Missing evidence is not a negative result. Do not assert an attack, affected identities, a verified cause, or an action taken.',
					data
				)
		: undefined;
	const fenced = response?.trim().match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
	const raw: unknown = response === undefined ? { findings: fixture } : JSON.parse(fenced?.[1] ?? response);
	if (
		!object(raw) ||
		Object.keys(raw).length !== 1 ||
		!Array.isArray(raw.findings) ||
		!raw.findings.length ||
		raw.findings.length > observations.length
	)
		throw new Error('Invalid findings response.');
	const seen = new Set<string>();
	return raw.findings.map((item: unknown) => {
		if (
			!object(item) ||
			Object.keys(item).length !== 5 ||
			!textField(item.reference, 24) ||
			!textField(item.possibleCause, 240) ||
			!textField(item.uncertainty, 240) ||
			!textField(item.nextStep, 240) ||
			!textField(item.possibleRemediation, 240)
		)
			throw new Error('Invalid finding.');
		const exact = observations.find((o) => o.id === item.reference);
		const referencedSteps = plan.filter((step) => step.ref === item.reference);
		const observation = exact ?? (referencedSteps.length === 1 ? observations.find((o) => o.id === referencedSteps[0].id) : undefined);
		if (!observation || seen.has(observation.id)) throw new Error('Unknown or duplicate evidence citation.');
		seen.add(observation.id);
		return {
			...observation,
			possibleCause: item.possibleCause,
			uncertainty: item.uncertainty,
			nextStep: item.nextStep,
			possibleRemediation: item.possibleRemediation,
		};
	});
}
