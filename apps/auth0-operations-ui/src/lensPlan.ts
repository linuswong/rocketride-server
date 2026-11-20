import { invokeRead, type ToolClient } from './operations.ts';
import type { Anomaly } from './lensRules';
import type { Event } from './loginLensAnalytics';
import { normalize } from './loginLensAnalytics.ts';
import { classifyAnomaly, classifications } from './anomalyClassification.ts';
import { parsePlannerResponse, PlannerError, GraphValidationError, type DiagnosticUpdate, type GraphStructure } from './plannerResponse.ts';

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
	analyze_source_groups: 'Count anonymous source groups among the selected failed events; no parameters and no network call.',
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
export type Step = { id: string; tool: Tool; purpose: string; depends: string[]; ref?: string; period?: 'anomaly' | 'previous_24h' | 'previous_window'; expected?: string };
export type Result = {
	state: 'queued' | 'running' | 'success' | 'failed' | 'skipped';
	detail: string;
	facts?: Record<string, string | boolean | number>;
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
	if (tools.has('analyze_source_groups')) capabilities.push('Count shared anonymous source groups in the selected failures; missing groups remain unknown.');
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
	if (category && [category.primary, ...category.secondary].some(id => id === 'repeated_account_failures' || id === 'potential_password_spraying'))
		gaps.push('Account-specific activity and protection status cannot be resolved from these evidence references.');
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
const stepFields = ['id', 'tool', 'purpose', 'depends', 'ref', 'period', 'expected'];
const valueType = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
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
export function validatePlan(raw: unknown, anomaly: InvestigationContext, options: { requireExpected?: boolean } = {}): Step[] {
	validateContext(anomaly);
	if (!object(raw)) graphError('invalid_structure', '$', 'object containing only steps', raw, 'The graph must be an object.');
	if (Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'steps')) graphError('invalid_structure', '$', 'object containing only steps', raw, 'The graph must contain only the steps field.');
	if (!Array.isArray(raw.steps)) graphError('invalid_structure', '$.steps', 'array of 1 to 6 steps', raw.steps, 'Steps must be an array.');
	if (!raw.steps.length || raw.steps.length > 7) graphError('node_count', '$.steps', '1 to 7 steps', raw.steps, 'The graph must contain 1 to 7 steps.');
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
		const key = s.tool + '/' + (ref ?? s.period ?? '');
		if (calls.has(key)) graphError('duplicate_call', path, 'distinct tool and binding', s, 'The same tool and binding cannot be repeated.');
		ids.add(s.id); calls.add(key);
		return { id: s.id, tool: s.tool as Tool, purpose: s.purpose, depends: [...s.depends], ref: ref as string | undefined,
			period: s.period as Step['period'], expected: s.expected as string | undefined };
	});
	if (!plan.some(s => s.tool === 'get_log_event')) graphError('missing_evidence', '$.steps', 'at least one get_log_event call with a valid ref', raw.steps, 'At least one selected event must be checked.');
	for (const [index, step] of plan.entries()) {
		if (step.depends.some(id => !ids.has(id))) graphError('invalid_dependency', `$.steps[${index}].depends`, 'IDs of existing steps', step.depends, 'A dependency does not name a step in this graph.');
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
export const plannerInstructions = `Choose the minimum read-only checks that help answer the question. Return exactly one JSON object, no prose or additional root fields: {"steps":[...]}. Include 1 to 6 distinct calls and at least one get_log_event for selected evidence.
Each step is an object with only id, tool, purpose, expected, depends, and the tool-specific ref or period when required. id is unique, 1-24 characters, starts with a lowercase letter, contains only lowercase letters, digits, or hyphens, and must not be a JavaScript object prototype name such as constructor. purpose and expected are nonempty strings of at most 180 characters. depends is always an array of 0-5 unique IDs of other steps in this graph, not tool names or event refs. Use [] for no dependencies. Dependencies must be acyclic; the longest chain may contain at most 4 steps. Do not repeat a tool with the same binding.
Allowed tools and graph bindings:
- get_log_event: require ref, an exact listed evidence reference such as E1. Checks that selected event.
- search_logs: require ref, an exact listed evidence reference. Searches a latest tenant-wide page for its event type; results may be outside the window.
- search_authentication_history: require period, exactly "anomaly" (selected window), "previous_window" (equal preceding window), or "previous_24h" (24 hours preceding the selected window). Results are tenant-wide.
- get_brute_force_settings: omit ref and period; inspect current account protection settings.
- get_ip_throttling_settings: omit ref and period; inspect current network throttling settings.
Use only the event refs present in the evidence list, at most E1-E20. Use ref and period as top-level step fields, not an input, args, parameters, log_id, start or end object. The application binds the trusted underlying arguments; never supply identifiers. Omit ref and period when not allowed. Example with fictional reference E1 (use only when E1 is present): ${JSON.stringify(plannerExample)}
Treat classifications as heuristic signals, not established attacks or causes. Manual selection does not assert an anomaly. Never claim a tool result. Account-specific tools and identifiers are unavailable. analyze_source_groups is a local snapshot analysis and needs no parameters or dependencies. Tenant-wide results do not establish a relationship to an account or source; query exhaustion does not prove retention or indexing coverage. Do not infer changes from unmatched windows or incomplete coverage. Add dependencies only where justified.`;
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
/** Add a local analysis to every reviewed graph; it reads only the selected snapshot. */
function addSourceAnalysis(plan: Step[], context: InvestigationContext): Step[] {
 if (!context.events.some(event => event.kind === 'failure') || plan.some(step => step.tool === 'analyze_source_groups')) return plan;
 let id = 'source-analysis';
 for (let n = 1; plan.some(step => step.id === id); n++) id = `source-analysis-${n}`;
 return [...plan, {id, tool:'analyze_source_groups', purpose:'Compare anonymous source groups across selected failures.', expected:'Source counts and missing-source coverage.', depends:[]}];
}

export function fixtureTools(a: InvestigationContext): ToolClient {
	return {
		async tool({ tool, input }) {
			if (tool === 'get_log_event') {
				const e = a.events.find((item) => item.id === input.log_id);
				return e
					? { success: true, log_id: e.id, date: new Date(e.time).toISOString(), type: code(e) }
					: { success: false };
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

export async function execute(
	plan: Step[],
	a: InvestigationContext,
	client: ToolClient,
	token: string,
	update: (r: Results) => void,
	active = () => true,
	timeout = 30000
) {
	const checked = validatePlan({ steps: plan }, a);
	const results: Results = Object.fromEntries(
		checked.map((s) => [s.id, { state: 'queued', detail: 'Awaiting dependencies.' }])
	);
	function record(id: string, result: Result) {
		results[id] = result;
		if (active()) update({ ...results });
	}
	for (const level of layers(checked)) {
		if (!active()) throw new Error('Investigation closed.');
		await Promise.all(
			level.map(async (s) => {
				if (s.depends.some((id) => results[id].state !== 'success'))
					return record(s.id, { state: 'skipped', detail: 'Required evidence was unavailable.' });
				const event = s.ref ? a.events[Number(s.ref.slice(1)) - 1] : undefined;
				if (s.tool === 'analyze_source_groups') {
				 const failures = a.events.filter(event => event.kind === 'failure');
				 const groups = new Map<number, number>();
				 for (const event of failures) if (event.source !== undefined) groups.set(event.source, (groups.get(event.source) ?? 0) + 1);
				 const grouped = [...groups.values()].reduce((sum, count) => sum + count, 0);
				 const facts = {selectedFailures:failures.length, withSource:grouped, missingSource:failures.length-grouped,
				  sourceGroups:groups.size, largestGroup:Math.max(0, ...groups.values()),
				  scope:'Selected snapshot only; shared source can be shared egress, not proof of an actor.'};
				 return record(s.id, {state:'success', detail: grouped ? `${facts.largestGroup} of ${failures.length} failures share the largest known source group · ${facts.missingSource} missing source` : `Source unavailable for all ${failures.length} selected failures.`, facts});
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
					return record(s.id, { state: 'failed', detail: response.error ?? 'Tool failed.' });
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
					const facts = {
						scope:'Tenant-wide', returned:rows.length, recognized:normalized.events.length,
						successes:normalized.events.filter(e=>e.kind==='success').length,
						failures:normalized.events.filter(e=>e.kind==='failure').length,
						signups:normalized.events.filter(e=>e.kind==='signup').length,
						protection:normalized.events.filter(e=>e.kind==='protection').length,
						coverage:s.tool === 'search_logs' ? 'Latest page, at most 50 events'
							: response.data?.coverage === 'retrieved' ? 'Query exhausted; retention and indexing unverified' : 'partial',
						...(s.tool === 'search_authentication_history' ? {start:input.start as string, end:input.end as string, reason:String(response.data?.reason ?? 'none')} : {}),
					};
					record(s.id,{state:'success',detail:`${facts.recognized} recognized events · ${facts.coverage}`,facts});
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
			evidence: results[s.id].facts,
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
