import test from 'node:test';
import assert from 'node:assert/strict';
import { withRequestTimeout } from '../src/requestTimeout.ts';
test('local timeout reports uncertain remote state without initiating retries', async () => {
 let complete;
 const remote = new Promise(resolve => { complete = resolve; });
 await assert.rejects(withRequestTimeout(remote, 'Starting', 5), /Remote work may still be running/);
 complete('finished');
 assert.equal(await remote, 'finished');
 assert.equal(await withRequestTimeout(Promise.resolve('ok'), 'Starting', 50), 'ok');
});
