import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { detect } from '../src/lensRules.ts';
import { exampleEvents } from '../src/lensExample.ts';
import { normalize, summarize } from '../src/loginLensAnalytics.ts';
import { propose, validatePlan, execute, fixtureTools, findings, registry, registryInputs, assessPlan } from '../src/lensPlan.ts';
import { invokeRead } from '../src/operations.ts';
import { classifyAnomaly, classifications } from '../src/anomalyClassification.ts';
const now = Date.UTC(2026, 10, 18, 12),
	fixture = exampleEvents(now),
	alerts = detect(fixture);
const anomaly = alerts.find((a) => a.rule === 'Repeated account failures');
test('classification maps detected rules to objectives and preserves overlapping evidence', () => {
 const rows=Array.from({length:8},(_,i)=>({...fixture[0],id:'class'+i,time:now-i*100,kind:'failure',
  account:i<4?1:i,source:1,origin:{lat:20,lon:10,label:'approximate'}}));
 const candidates=detect(rows);
 const expected={
  'Repeated account failures':'repeated_account_failures',
  'Possible password spraying':'potential_password_spraying',
  'Geographic concentration':'geographic_anomaly',
 };
 for(const [rule,id] of Object.entries(expected)){
  const a=candidates.find(item=>item.rule===rule);
  assert.ok(a);
  const result=classifyAnomaly(a);
  assert.equal(result.primary,id); assert.equal(result.rule,rule); assert.equal(result.evidence,a.events);
  assert.ok(result.questions.length>0); assert.ok(classifications[id].label);
 }
 const cluster=classifyAnomaly(candidates.find(item=>item.rule==='Possible password spraying'));
 assert.ok(cluster.secondary.includes('repeated_account_failures'));
 assert.ok(cluster.secondary.includes('geographic_anomaly'));
 const incomplete=classifyAnomaly({...anomaly,rule:'unrecognized',events:[]});
 assert.equal(incomplete.primary,'insufficient_evidence');
 assert.match(incomplete.reasoning[0],/No supporting/);
});
test('classifies explicit protection and configuration evidence without asserting a cause',()=>{
 for (const [category,id] of [['Brute-force protection','protection_activity'],['Authentication configuration error','configuration_issue']]) {
  const result=classifyAnomaly({...anomaly,rule:'Unknown',events:[{...anomaly.events[0],category}]});
  assert.equal(result.primary,'insufficient_evidence'); assert.ok(result.secondary.includes(id));
  assert.ok(result.questions.length>0);
 }
 const result=classifyAnomaly({...anomaly,rule:'Failure volume spike'});
 assert.equal(result.primary,'authentication_failure_spike');
});
test('planner advertises exactly the tools covered by the node compatibility adapter', () => {
 assert.deepEqual(Object.keys(registry).filter(name => name !== 'analyze_source_groups').sort(), Object.keys(registryInputs).sort());
});
test('sign-ups are counted separately, missing geography stays unknown and inherited type names are excluded', () => {
	const rows = ['s', 'fp', 'ss', 'constructor'].map((type, i) => ({
		type,
		log_id: String(i),
		date: new Date(now).toISOString(),
		latitude: 200,
		longitude: 0,
		user_id: 'private',
	}));
	const { events, skipped } = normalize(rows);
	assert.equal(skipped, 1);
	assert.equal(events[0].origin, undefined);
	assert.ok(!JSON.stringify(events).includes('private'));
	const metrics = summarize(events, now, 1);
	assert.equal(metrics.rate, 50);
	assert.equal(metrics.signups, 1);
});
test('five rules require observed groupings, failures and baseline coverage', () => {
	const span = 900000;
	const history = Array.from({ length: 9 }, (_, i) => ({
		...fixture[0],
		time: now - (i + 1) * span,
		kind: 'success',
		id: 'h' + i,
	}));
	const failures = Array.from({ length: 10 }, (_, i) => ({
		...fixture[0],
		id: 'f' + i,
		time: now - i * 100,
		kind: 'failure',
		source: 1,
		account: i < 5 ? 1 : i,
	}));
	assert.equal(new Set(detect([...history, ...failures]).map((a) => a.rule)).size, 5);
	assert.deepEqual(detect(history), []);
	assert.ok(!detect(failures).some((a) => a.rule.includes('deviation') || a.rule.includes('spike')));
	assert.ok(!detect([...history, ...failures], undefined, false).some(a=>a.rule.includes('deviation') || a.rule.includes('spike')));
	assert.deepEqual(
		detect(failures.map((e) => ({ ...e, account: undefined, source: undefined, origin: undefined }))),
		[]
	);
});
test('history tool preserves partial coverage and rejects malformed metadata', async () => {
	const result = {success:true,events:[],count:0,pages:1,coverage:'partial',reason:'RATE_LIMITED',rejected:0,duplicates:0,retry_after_seconds:12};
	const client = {tool:async()=>result};
	assert.equal((await invokeRead(client,'token','search_authentication_history',{})).data.retry_after_seconds,12);
	result.pages = 6;
	assert.equal((await invokeRead(client,'token','search_authentication_history',{})).status,'error');
});
test('protection events are classified, kept out of sign-in rates and merged only on shared observed groups', async () => {
 const time=new Date(now).toISOString();
 const rows=['limit_wc','limit_sul','limit_mu'].map((type,i)=>({log_id:'protection'+i,type,date:time,account_group:1,source_group:2}));
 const normalized=normalize(rows).events;
 assert.equal(normalized.length,3);
 const metrics=summarize(normalized,now,1);
 assert.equal(metrics.protection,3); assert.equal(metrics.failure,0); assert.equal(metrics.signups,0); assert.equal(metrics.rate,null);
 const protection=detect(normalized);
 assert.equal(protection.length,1);
 assert.equal(classifyAnomaly(protection[0]).primary,'protection_activity');
 assert.equal(protection[0].events.length,3);
 const graph=await propose(protection[0]);
 const result=await execute(graph,protection[0],fixtureTools(protection[0]),'fixture',()=>{});
 assert.equal(result.event.state,'success');
 assert.match((await findings(graph,result)).find(f=>f.id==='event').uncertainty,/intent/);
 const failureRows=Array.from({length:4},(_,i)=>({log_id:'f'+i,type:'fp',date:new Date(now-(i+1)*1000).toISOString(),account_group:1,source_group:2}));
 const merged=detect(normalize([...failureRows,{...rows[0],date:new Date(now-2000).toISOString()}]).events);
 assert.equal(merged.filter(a=>a.rule==='Protection activity').length,0);
 assert.ok(merged.some(a=>a.events.some(e=>e.kind==='protection')));
 assert.ok(merged.some(a=>classifyAnomaly(a).secondary.includes('protection_activity')));
 const unlinked=detect(normalize([...failureRows,rows[0]]).events);
 assert.ok(unlinked.some(a=>a.rule==='Protection activity'));
});
test('equal historical windows use the same duration and never equate partial coverage with a baseline', async () => {
 const plan=[
  {id:'event',tool:'get_log_event',purpose:'Verify',depends:[],ref:'E1'},
  {id:'previous',tool:'search_authentication_history',purpose:'Compare prior window',depends:[],period:'previous_window'},
  {id:'current',tool:'search_authentication_history',purpose:'Review anomaly window',depends:[],period:'anomaly'},
 ];
 const calls=[];
 const result=await execute(plan,anomaly,{async tool(options){calls.push(options);return fixtureTools(anomaly).tool(options);}},'fixture',()=>{});
 const windows=calls.filter(c=>c.tool==='search_authentication_history').map(c=>c.input);
 assert.equal(windows.length,2);
 assert.equal(Date.parse(windows[0].end),Date.parse(windows[1].start));
 assert.equal(Date.parse(windows[0].end)-Date.parse(windows[0].start),Date.parse(windows[1].end)-Date.parse(windows[1].start));
 assert.equal(result.previous.facts.coverage,'partial');
 assert.ok(assessPlan(plan,anomaly).gaps.some(g=>g.includes('independently verified coverage')));
});
test('protection and signup events do not establish a comparable sign-in baseline', () => {
 const prior={...fixture[0],id:'prior-protection',kind:'protection',category:'IP protection',time:now-1800000};
 const priorWindow={...prior,id:'prior-window',time:now-900001};
 const spike=Array.from({length:8},(_,i)=>({...fixture[0],id:'spike'+i,kind:'failure',time:now-i*1000}));
 const alerts=detect([prior,priorWindow,...spike],undefined,true);
 assert.ok(!alerts.some(a=>a.rule==='Failure volume spike' || a.rule==='Failure rate deviation'));
});
test('three anomaly types can receive different validated model-generated graphs', async () => {
	const rows = Array.from({length:8},(_,i)=>({...fixture[0],id:'different'+i,kind:'failure',account:i<4?1:i,source:2,origin:{lat:20,lon:10,label:'20, 10'},time:now-i*100}));
	const generated=detect(rows);
	for (const rule of ['Repeated account failures','Possible password spraying','Geographic concentration']) {
		const current=generated.find(a=>a.rule===rule);
		assert.ok(current);
		const proposed=await propose(current,async()=>JSON.stringify({steps:[
			{id:'event',tool:'get_log_event',purpose:'Check the event',expected:'Event type',depends:[],ref:'E1'},
			...(rule==='Repeated account failures'?[{id:'account',tool:'get_brute_force_settings',purpose:'Check protection',expected:'Settings',depends:['event']}]:[]),
			...(rule==='Possible password spraying'?[{id:'network',tool:'get_ip_throttling_settings',purpose:'Check throttling',expected:'Settings',depends:[]}]:[]),
			...(rule==='Geographic concentration'?[{id:'history',tool:'search_authentication_history',purpose:'Compare preceding activity',expected:'Tenant-wide event counts',depends:['event'],period:'previous_24h'}]:[]),
		]}));
		assert.equal(proposed.length,3);
		assert.equal(proposed.at(-1).tool,'analyze_source_groups');
		assert.ok(Object.values(await execute(proposed,current,fixtureTools(current),'fixture',()=>{})).every(r=>r.state==='success'));
		const review=assessPlan(proposed,current);
		assert.ok(review.capabilities.some(capability=>capability.includes('selected event')));
		if(rule==='Geographic concentration') assert.ok(review.gaps.some(gap=>gap.includes('geographic baseline')));
		if(rule==='Repeated account failures') assert.ok(review.gaps.some(gap=>gap.includes('Account-specific')));
	}
	await assert.rejects(propose(anomaly,async()=>{throw new Error('provider unavailable');}));
	await assert.rejects(propose(anomaly,async()=>JSON.stringify({steps:[{id:'event',tool:'get_log_event',purpose:'Check',ref:'E1',depends:[]}]})));
});
test('model-proposed graph is reviewed, executed in dependency order, and findings cite retrieved evidence', async () => {
	const reference = await propose(anomaly);
	const graph = await propose(anomaly, async (_, data) => {
		assert.ok(!JSON.stringify(data).includes(anomaly.events[0].id));
		assert.equal(data.classification.primary,'Repeated account failures');
		assert.ok(data.classification.questions.some(question=>/account/i.test(question)));
		assert.match(data.restrictions.join(' '),/Account/);
		return JSON.stringify({ steps: [...reference].reverse() });
	});
	const states = [],
		calls = [];
	const results = await execute(
		graph,
		anomaly,
		{
			tool(args) {
				calls.push(args.tool);
				return fixtureTools(anomaly).tool(args);
			},
		},
		'fixture',
		(r) => states.push(r)
	);
	assert.equal(calls[0], 'get_log_event');
	assert.ok(states.some((r) => r.event.state === 'running'));
	const finding = {
		reference: 'event',
		possibleCause: 'A stale password is possible.',
		uncertainty: 'Intent is unknown.',
		nextStep: 'Verify the timestamp.',
		possibleRemediation: 'Review credential recovery if confirmed.',
	};
	const report = await findings(graph, results, async () => JSON.stringify({ findings: [finding] }));
	assert.equal(report[0].evidence.reference, 'E1');
	assert.notDeepEqual(await propose(alerts.find((a) => a.rule === 'Possible password spraying')), reference);
	await assert.rejects(
		findings(graph, results, async () => JSON.stringify({ findings: [{ ...finding, reference: 'unknown' }] }))
	);
});
test('same classification permits different evidence-driven graphs and reports missing checks', async () => {
 const one={id:'event',tool:'get_log_event',purpose:'Verify the failure',expected:'Event type',depends:[],ref:'E1'};
 const settings={id:'protection',tool:'get_brute_force_settings',purpose:'Inspect relevant protection',expected:'Enabled status',depends:[]};
 const sparse=await propose(anomaly,async()=>JSON.stringify({steps:[one]}));
 const expanded=await propose(anomaly,async()=>JSON.stringify({steps:[one,settings]}));
 assert.notDeepEqual(sparse,expanded);
 assert.ok(assessPlan(sparse,anomaly).gaps.some(gap=>gap.includes('No protection')));
 assert.ok(assessPlan(expanded,anomaly).capabilities.some(item=>item.includes('protection settings')));
 assert.ok(assessPlan(expanded,anomaly).gaps.some(gap=>gap.includes('do not establish')));
});
test('findings receive conflicting settings and reject citations to failed steps', async () => {
 const plan=[
  {id:'event',tool:'get_log_event',purpose:'Verify',depends:[],ref:'E1'},
  {id:'account',tool:'get_brute_force_settings',purpose:'Inspect',depends:[]},
  {id:'network',tool:'get_ip_throttling_settings',purpose:'Inspect',depends:[]},
 ];
 const results=await execute(plan,anomaly,fixtureTools(anomaly),'fixture',()=>{});
 const response={findings:[{reference:'account',possibleCause:'Settings differ.',uncertainty:'A setting does not establish what happened.',nextStep:'Review both settings.',possibleRemediation:'Review policy if drift is confirmed.'}]};
 await findings(plan,results,async(_,data)=>{
  assert.equal(data.observations.find(o=>o.id==='account').evidence.enabled,true);
  assert.equal(data.observations.find(o=>o.id==='network').evidence.enabled,false);
  return JSON.stringify(response);
 },anomaly);
 results.account={state:'failed',detail:'Unavailable'};
 await assert.rejects(findings(plan,results,async()=>JSON.stringify(response),anomaly));
});
test('deny unknown operations, arbitrary parameters, invalid references, cycles and unbounded graphs', async () => {
	const steps = await propose(anomaly),
		first = steps[0];
	for (const change of [
		{ tool: 'unblock_user' },
		{ input: { user_id: 'x' } },
		{ ref: 'E999' },
		{ id: 'constructor' },
		{ depends: ['absent'] },
		{ depends: [steps[1].id] },
	]) {
		assert.throws(() => validatePlan({ steps: [{ ...first, ...change }, steps[1]] }, anomaly));
	}
	for (const count of [5, 7]) {
		const large = { ...anomaly, events: fixture.slice(0, count) };
		assert.throws(() =>
			validatePlan(
				{
					steps: large.events.map((e, i) => ({
						...first,
						id: 'n' + i,
						ref: 'E' + (i + 1),
						depends: i ? ['n' + (i - 1)] : [],
					})),
				},
				large
			)
		);
	}
	await assert.rejects(propose(anomaly, async () => 'malformed'));
});
test('timeout, API failure and mismatched event preserve independent snapshot analysis', async () => {
	const graph = await propose(anomaly);
	for (const response of [
		() => new Promise(() => {}),
		async () => ({ success: false, error_code: 'DENIED' }),
		async () => ({ success: true, log_id: 'other' }),
	]) {
		let calls = 0;
		const results = await execute(
			graph,
			anomaly,
			{
				tool() {
					calls++;
					return response();
				},
			},
			'fixture',
			() => {},
			() => true,
			5
		);
		assert.equal(calls, 1);
		assert.equal(results.event.state, 'failed');
		assert.equal(results.account.state, 'skipped');
		assert.deepEqual((await findings(graph, results)).map(item => item.id), ['source-analysis']);
	}
});
test('history and recent-event steps use bounded bindings and expose only aggregate evidence', async () => {
 const steps = [
  {id:'event',tool:'get_log_event',purpose:'Verify event',depends:[],ref:'E1',expected:'Event type'},
  {id:'history',tool:'search_authentication_history',purpose:'Compare prior activity',depends:['event'],period:'previous_24h',expected:'Prior counts'},
  {id:'recent',tool:'search_logs',purpose:'Inspect recent failures',depends:[],ref:'E1',expected:'Latest count'},
 ];
 const inputs=[];
 const responses=fixtureTools(anomaly);
 const results=await execute(steps,anomaly,{async tool(o){inputs.push(o); return responses.tool(o);}},'fixture',()=>{});
 assert.ok(Object.values(results).every(r=>r.state==='success'));
 const history=inputs.find(x=>x.tool==='search_authentication_history').input;
 assert.equal(Date.parse(history.end),anomaly.start);
 assert.equal(Date.parse(history.end)-Date.parse(history.start),86400000);
 assert.deepEqual(inputs.find(x=>x.tool==='search_logs').input,{event_type:'fp',analytics:true,limit:50});
 assert.equal(results.history.facts.scope,'Tenant-wide');
 assert.ok(!JSON.stringify(results).includes(anomaly.events[0].id));
 const interpretation = await findings(steps,results);
 assert.match(interpretation.find(f=>f.id==='history').uncertainty,/tenant-wide/);
 assert.doesNotMatch(interpretation.find(f=>f.id==='history').possibleCause,/protection settings/i);
 for (const update of [{period:'arbitrary'}, {period:'anomaly',ref:'E1'}, {period:'previous_24h',input:{start:'x'}}]) {
  assert.throws(()=>validatePlan({steps:[steps[0],{...steps[1],...update}]},anomaly));
 }
 assert.throws(()=>validatePlan({steps:[steps[0],{...steps[2],ref:'E999'}]},anomaly));
});
test('independent steps run concurrently and failures skip only their dependents', async () => {
 const steps = [
  {id:'event',tool:'get_log_event',purpose:'Verify',depends:[],ref:'E1'},
  {id:'network',tool:'get_ip_throttling_settings',purpose:'Inspect',depends:[]},
  {id:'related',tool:'search_logs',purpose:'Inspect',depends:['event'],ref:'E1'},
 ];
 let release; const pending=new Promise(resolve=>{release=resolve;}); const started=[];
 const client={async tool(o){started.push(o.tool); if(o.tool==='get_log_event'){await pending;return {success:false,error_code:'DENIED'};} return fixtureTools(anomaly).tool(o);}};
 const run=execute(steps,anomaly,client,'fixture',()=>{});
 await delay(0);
 assert.deepEqual(started.sort(),['get_ip_throttling_settings','get_log_event']);
 release(); const result=await run;
 assert.equal(result.event.state,'failed'); assert.equal(result.related.state,'skipped'); assert.equal(result.network.state,'success');
});


test('source analysis counts selected failures and missing groups without requesting IP addresses', async () => {
 const events = anomaly.events.slice(0, 4).map((event, i) => ({...event, id:'source-test-'+i, source:i===3 ? undefined : i===2 ? 42 : 41}));
 const context = {...anomaly, events};
 const graph = await propose(context);
 let calls = 0;
 const results = await execute(graph, context, {tool:async options => { calls++; return fixtureTools(context).tool(options); }}, 'fixture', () => {});
 const result = results['source-analysis'];
 assert.deepEqual([result.facts.selectedFailures,result.facts.withSource,result.facts.missingSource,result.facts.sourceGroups,result.facts.largestGroup], [4,3,1,2,2]);
 assert.equal(calls, graph.length - 1);
 assert.ok(!JSON.stringify(result).includes('41'));
 let sent;
 await findings(graph, results, async (_, payload) => { sent = payload; return JSON.stringify({findings:[{reference:'source-analysis',possibleCause:'A shared source may be shared egress.',uncertainty:'One source is missing.',nextStep:'Review the common source because it groups two failures.',possibleRemediation:'Review before taking action.'}]}); }, context);
 assert.equal(sent.observations.find(item => item.id === 'source-analysis').evidence.largestGroup, 2);
 const missingContext = {...context, events: events.map(event => ({...event, source:undefined}))};
 const missingGraph = await propose(missingContext);
 const missingResults = await execute(missingGraph, missingContext, fixtureTools(missingContext), 'fixture', () => {});
 assert.equal(missingResults['source-analysis'].facts.missingSource, 4);
 assert.match(missingResults['source-analysis'].detail, /unavailable/);
});
