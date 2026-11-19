import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { investigateDemo } from '../src/demoAnalysis.ts';

const users = JSON.parse(readFileSync(new URL('../src/demo/users.json', import.meta.url)));
const cases = JSON.parse(readFileSync(new URL('../src/demo/investigations.synthetic.json', import.meta.url))).investigations;
const investigate = email => investigateDemo(email, users, cases);

test('brute-force evidence separates simulated protection from administrative block', () => {
 const result = investigate(' RILEY.CHEN@example.org ');
 assert.equal(result.profile.blocked, false);
 assert.equal(result.hasProtectionBlock, true);
 assert.equal(result.events[0].type, 'limit_wc');
 assert.equal(result.events[0].caseId, 'SYN-003');
});

test('administrative block, missing user, and MFA evidence are distinguished', () => {
 assert.equal(investigate('taylor.silva@example.net').profile.blocked, true);
 assert.equal(investigate('missing.person@example.org').profile, undefined);
 assert.equal(investigate('missing.person@example.org').events[0].type, 'fu');
 assert.equal(investigate('quinn.rivera@example.com').events[0].type, 'synthetic_mfa_failure');
});

test('successful login after failure keeps latest event first; no history does not invent activity', () => {
 const result = investigate('rowan.ellis@example.org');
 assert.deepEqual(result.events.map(event => event.type), ['s', 'fp']);
 assert.match(result.events[0].description, /Successful login after failed login/);
 const empty = investigate('drew.kim@example.net');
 assert.equal(empty.events.length, 0);
});

test('synthetic pipeline has a fresh isolated agent and no Auth0 tools', () => {
 const pipeline = JSON.parse(readFileSync(new URL('../src/synthetic_investigation.pipe', import.meta.url)));
 assert.deepEqual(pipeline.components.map(component => component.provider).sort(), ['agent_rocketride', 'chat', 'llm_gemini', 'memory_internal', 'response_answers']);
 assert.equal(pipeline.components.find(component => component.provider === 'agent_rocketride').config.require_tool_call, false);
});
