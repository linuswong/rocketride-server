// Explicit opt-in against the designated development tenant and test email only.
// Prints pass/fail categories, never identifiers, timestamps, credentials, or provider responses.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { RocketRideClient } from 'rocketride';
import { invokeRead } from '../src/operations.ts';
import { submittedEmailWindow } from '../src/submittedEmail.ts';
import { validateTarget } from '../src/investigation.ts';
import { verifyTelemetryPipeline } from '../src/telemetryTask.ts';

const { LOGINLENS_LIVE_CONFIRM, LOGINLENS_TEST_EMAIL, LOGINLENS_INCIDENT_TIME, ROCKETRIDE_URI, ROCKETRIDE_APIKEY } = process.env;
const email = LOGINLENS_TEST_EMAIL?.trim();
const window = LOGINLENS_INCIDENT_TIME && /(?:Z|[+-]\d{2}:\d{2})$/i.test(LOGINLENS_INCIDENT_TIME)
 ? submittedEmailWindow(LOGINLENS_INCIDENT_TIME) : undefined;
if (LOGINLENS_LIVE_CONFIRM !== 'AUTHORIZED_DEVELOPMENT_TENANT_READ_ONLY' || !email || !email.includes('@') || email.includes('|') || validateTarget(email) || !window || !ROCKETRIDE_URI || !ROCKETRIDE_APIKEY) {
 console.error('Not run. Supply the non-production confirmation, designated test email, past incident time with timezone, engine URI and API key; see docs/testing.md.');
 process.exitCode = 2;
} else {
 const pipeline = JSON.parse(await readFile(new URL('../src/auth0_telemetry.pipe', import.meta.url), 'utf8'));
 pipeline.project_id = randomUUID();
 verifyTelemetryPipeline(pipeline, pipeline.project_id);
 const client = new RocketRideClient({uri:ROCKETRIDE_URI, auth:ROCKETRIDE_APIKEY});
 let token;
 try {
  await client.connect();
  const task = await client.use({pipeline, useExisting:false, ttl:300, pipelineTraceLevel:'none'});
  token = task.token;
  if (task.reused === true) throw Error('Unexpected reused task.');
  verifyTelemetryPipeline(await client.getTaskPipeline(token), pipeline.project_id);
  for (const [label, tool, input] of [
   ['Submitted-email tenant log search', 'search_submitted_email_logs', {email, ...window}],
   ['Submitted-email protection check', 'get_blocks_by_email', {email}],
  ]) {
   const evidence = await invokeRead(client, token, tool, input);
   console.log(`${label}: ${evidence.status === 'success' ? 'PASS' : 'INCOMPLETE'}`);
   if (evidence.status !== 'success') process.exitCode = 1;
  }
 } catch {
  console.error('Live check failed. Verify the engine, updated node and test-tenant scopes without exposing credentials or provider responses.');
  process.exitCode = 1;
 } finally {
  if (token) await client.terminate(token).catch(() => { console.error('Task termination failed; inspect the engine task list.'); process.exitCode = 1; });
  await client.disconnect().catch(() => {});
 }
}
