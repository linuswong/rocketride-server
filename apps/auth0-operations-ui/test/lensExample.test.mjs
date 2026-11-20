import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleEvents, exampleInventory } from '../src/lensExample.ts';
import { detect } from '../src/lensRules.ts';

test('demo user counts agree with the synthetic events and include inactive users', () => {
 const now = Date.parse('2026-11-19T12:00:00Z');
 const inventory = exampleInventory(now);
 const active = new Set(exampleEvents(now).filter(event => event.kind === 'success').map(event => event.account));
 assert.equal(inventory.active, active.size);
 assert.ok(inventory.active > 0);
 assert.ok(inventory.inactive > 0);
 assert.equal(inventory.total, inventory.active + inventory.inactive + inventory.unknown);
});


test('additional normal users add geographic activity without creating failure signals', () => {
 const events = exampleEvents(Date.parse('2026-11-19T12:00:00Z'));
 const normal = events.filter(event => event.account >= 1000);
 assert.ok(normal.length >= 400);
 assert.ok(normal.every(event => event.kind === 'success'));
 assert.equal(new Set(normal.map(event => event.account)).size, normal.length);
 assert.ok(new Set(normal.map(event => event.origin.label)).size >= 15);
 const failureSignals = list => detect(list).map(alert => [alert.rule, alert.explanation]).sort();
 assert.deepEqual(failureSignals(events), failureSignals(events.filter(event => event.account < 1000)));
});
