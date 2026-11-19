// Explicit opt-in, non-production only. No model chat or raw results are printed.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { RocketRideClient } from 'rocketride';
import { createInvestigation, executeInvestigation, validateTarget } from '../src/investigation.ts';

const { SUPPORTPILOT_LIVE_CONFIRM, SUPPORTPILOT_TEST_SUBJECT, ROCKETRIDE_URI, ROCKETRIDE_APIKEY } = process.env;
if (SUPPORTPILOT_LIVE_CONFIRM !== 'NONPRODUCTION_READ_ONLY_AND_POSSIBLE_COSTS' || !SUPPORTPILOT_TEST_SUBJECT || !ROCKETRIDE_URI || !ROCKETRIDE_APIKEY || validateTarget(SUPPORTPILOT_TEST_SUBJECT)) {
 console.error('Not run. Set the explicit non-production confirmation, test subject, engine URI and engine API key; see docs/testing.md.');
 process.exitCode = 2;
} else {
 const pipeline = JSON.parse(await readFile(new URL('../src/investigation.pipe', import.meta.url), 'utf8'));
 const auth = pipeline.components?.find(item => item.id === 'tool_auth0_1');
 if (auth?.provider !== 'tool_auth0' || auth.config?.allowWrite !== false) throw Error('Pipeline read-only safeguards missing.');
 pipeline.project_id = randomUUID();
 const client = new RocketRideClient({ uri: ROCKETRIDE_URI, auth: ROCKETRIDE_APIKEY });
 let token;
 try {
  await client.connect();
  const task = await client.use({ pipeline, useExisting: false, ttl: 300, pipelineTraceLevel: 'none' });
  token = task.token;
  if (task.reused === true) throw Error('Unexpected reused task.');
  const running = await client.getTaskPipeline(token);
  const node = running?.components?.find(item => item.id === 'tool_auth0_1');
  if (node?.provider !== 'tool_auth0' || node.config?.allowWrite !== false) throw Error('Running task could not be verified as read-only.');
  const result = await executeInvestigation(createInvestigation(SUPPORTPILOT_TEST_SUBJECT.trim()), client, token, undefined, () => {});
  for (const step of result.steps) console.log(`${step.id}: ${step.state}`);
  if (['profile','logs','blocks'].some(id => !['completed','warning'].includes(result.steps.find(step => step.id === id)?.state))) {
   console.error('Smoke test incomplete: one or more required checks did not return a usable result.');
   process.exitCode = 1;
  }
 } catch {
  console.error('Live smoke test failed. Check engine availability, node configuration and read-only scopes without logging credentials or response contents.');
  process.exitCode = 1;
 } finally {
  if (token) await client.terminate(token).catch(() => { console.error('Task termination failed; check the engine task list.'); process.exitCode = 1; });
  await client.disconnect().catch(() => {});
 }
}
