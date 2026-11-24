import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractAnswers, interpretAgentOutput, planLookup, retrieveEvidence, invokeRead } from '../src/operations.ts';

const ok = data => ({ success: true, ...data });
const result = { search_users: ok({users:[{user_id:'auth0|123',email:'test@example.com'}],count:1}), get_user: ok({user_id:'auth0|123',email:'test@example.com',blocked:false,connections:[]}), get_user_logs: ok({events:[{log_id:'log1',date:null,type:'f',description:'Login failed.'}],count:1}), get_user_blocks: ok({has_blocks:false,block_count:0,blocks:[]}), search_logs: ok({events:[],count:0}) };
function clientWith(responses = result) { const calls = []; return { calls, async tool(opts) { calls.push(opts); return responses[opts.tool]; } }; }

test('answer extraction rejects malformed results and guard failures', () => {
 assert.deepEqual(extractAnswers({ result_types: { answer: 'answers', ignored: 'object' }, answer: [{ answer: ' evidence ' }, '', 5], ignored: 'secret' }), ['evidence']);
 assert.deepEqual(extractAnswers({}), []);
 assert.match(interpretAgentOutput({ result_types:{a:'answers'}, a:'require_tool_call is enabled but the agent produced an answer without invoking any tool' }).error, /discarded/);
 assert.equal(interpretAgentOutput({result_types:{a:'answers'},a:'Possible explanation: verify the logs.'}).text, 'Possible explanation: verify the logs.');
});
test('explicit log request makes a real named SDK invocation per request', async () => {
 const client = clientWith(); const plan = planLookup('Use search_logs to show recent events');
 assert.equal(plan.tool, 'search_logs');
 const one = await retrieveEvidence(client, 'token', plan); const two = await retrieveEvidence(client, 'token', plan);
 assert.equal(client.calls.length, 2); assert.equal(client.calls[0].tool, 'search_logs');
 assert.equal(client.calls[0].nodeId, 'tool_auth0_1'); assert.equal(one[0].status, 'success'); assert.equal(two[0].status, 'success');
});
test('lookup uses fresh exact-email results and reads account, logs and blocks', async () => {
 const client = clientWith();
 const evidence = await retrieveEvidence(client, 'token', planLookup('Investigate test@example.com'));
 assert.deepEqual(client.calls.map(c=>c.tool), ['search_users','get_user','get_user_logs','get_user_blocks']);
 assert.deepEqual(client.calls[1].input, {user_id:'auth0|123'});
 assert.deepEqual(evidence.map(e=>e.status), ['success','success','success','success']);
});
test('stale evidence is not reused if a later search is empty or fails', async () => {
 const client = clientWith(); await retrieveEvidence(client, 'token', planLookup('test@example.com'));
 const later = clientWith({search_users:ok({users:[],count:0})});
 const evidence = await retrieveEvidence(later, 'token', planLookup('test@example.com'));
 assert.deepEqual(later.calls.map(c=>c.tool),['search_users']); assert.equal(evidence.length,1); assert.equal(evidence[0].data.count,0);
});
test('missing, malformed, denied and rate-limited results are errors', async () => {
 for (const response of [undefined, {success:true,events:[],count:1}, {success:true,events:'bad',count:0}, {success:true,events:[{log_id:'x'}],count:1}, {success:false,error_code:'MISSING_SCOPE'}, {success:false,error_code:'RATE_LIMITED'}]) {
  const e = await invokeRead(clientWith({search_logs:response}),'token','search_logs',{}); assert.equal(e.status,'error'); assert.equal(e.data,undefined);
 }
});
test('application settings accept only the nonsecret response contract',async()=>{
 const config={client_id:'client-1',app_type:'spa',token_endpoint_auth_method:'none',authorization_code_enabled:true,password_enabled:false,refresh_token_enabled:null,client_credentials_enabled:false};
 const good=await invokeRead(clientWith({get_application_config:ok(config)}),'token','get_application_config',{client_id:'client-1'});
 assert.equal(good.status,'success');
 for(const bad of [{...config,client_secret:'private-secret'},{...config,password_enabled:'false'},{...config,app_type:'untrusted'}]) {
  const result=await invokeRead(clientWith({get_application_config:ok(bad)}),'token','get_application_config',{client_id:'client-1'});
  assert.equal(result.status,'error');assert.equal(result.data,undefined);assert.doesNotMatch(JSON.stringify(result),/private-secret/);
 }
});
test('unsupported and write tools are not invoked', async () => {
 const client = clientWith();
 assert.match(planLookup('delete_user user_id: auth0|123').error,/unavailable/);
 assert.equal((await invokeRead(client,'token','unblock_user',{})).status,'error'); assert.equal(client.calls.length,0);
 assert.match(planLookup('get_user_permissions').error,/user_id/);
});
test('named workflow-only tools never silently become a different email or log lookup',async()=>{
 for(const name of ['search_submitted_email_logs','get_blocks_by_email','search_authentication_history']) {
  const client=clientWith();
  const plan=planLookup(`Use ${name} for test@example.com and inspect failed logs`);
  assert.match(plan.error,/cannot be invoked|available from the account investigation/);
  assert.equal(plan.tool,undefined); assert.equal(plan.email,undefined);
  const evidence=await retrieveEvidence(client,'token',plan);
  assert.equal(evidence[0].status,'error'); assert.equal(client.calls.length,0);
 }
});
test('no identifier is inferred from previous messages or unsupported conclusions', () => {
 assert.deepEqual(planLookup('Is the account blocked?'), {});
 assert.equal(interpretAgentOutput({}).error, 'The agent returned no readable answer.');
 assert.match(interpretAgentOutput({result_types:{a:'answers'},a:'The root cause is a blocked account.'}).error, /discarded/);
 assert.match(interpretAgentOutput({result_types:{a:'answers'},a:'The investigation is complete.'}).error, /discarded/);
});
test('bundled pipeline remains read-only and requires a real agent tool call', () => {
 const p=JSON.parse(readFileSync(new URL('../src/investigation.pipe',import.meta.url),'utf8'));
 const auth=p.components.find(c=>c.provider==='tool_auth0'); const agent=p.components.find(c=>c.provider==='agent_rocketride');
 assert.equal(auth.config.allowWrite,false); assert.equal(auth.config.writeClientId,''); assert.equal(auth.config.writeClientSecret,''); assert.equal(agent.config.require_tool_call,true);
 assert.match(auth.config.clientSecret,/^\$\{ROCKETRIDE_[A-Z0-9_]+\}$/);
});
test('bundled AI pipelines use the Gemini key for their selected model', () => {
 for (const file of ['investigation.pipe', 'planner.pipe', 'synthetic_investigation.pipe']) {
  const pipeline = JSON.parse(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'));
  const models = pipeline.components.filter(c => c.provider.startsWith('llm_'));
  assert.equal(models.length, 1, file);
  const model = models[0];
  assert.equal(model.provider, 'llm_gemini', file);
  assert.equal(model.config.profile, 'models-gemini-3-1-flash-lite', file);
  assert.equal(model.config[model.config.profile].apikey, '${ROCKETRIDE_GEMINI_KEY}', file);
 }
});
