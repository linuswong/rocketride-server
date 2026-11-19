import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundaryHarness } from './boundary-harness.mjs';
function setup() {
 const memberships = new Map([['alice', new Set(['A'])], ['bob', new Set(['B'])]]);
 const records = { tickets:[{id:'a',organizationId:'A',customer:'same@example.com',status:'new',version:1},{id:'a2',organizationId:'A',customer:'other@example.com',status:'new',version:1},{id:'b',organizationId:'B',customer:'same@example.com',status:'new',version:1}], investigations:[{id:'ia',organizationId:'A',ticketId:'a'},{id:'ib',organizationId:'B',ticketId:'b'}], evidence:[{id:'eb',organizationId:'B',investigationId:'ib'}], drafts:[{id:'db',organizationId:'B',ticketId:'b'}] };
 return { memberships, boundary:new BoundaryHarness(memberships,records) };
}
test('trusted-boundary model denies forged scope, guessed IDs, and cross-ticket links', () => {
 const {boundary:b}=setup();
 assert.equal(b.get('alice','A','tickets','a').id,'a');
 assert.deepEqual(b.listTickets('alice','A').map(x=>x.id),['a','a2']);
 for (const attempt of [()=>b.get('alice','B','tickets','b'),()=>b.get('alice','A','tickets','b'),()=>b.get('alice','A','evidence','eb'),()=>b.get('alice','A','drafts','db'),()=>b.link('alice','A','a','ib'),()=>b.link('alice','A','a2','ia'),()=>b.updateStatus('alice','A','b','triaged',1)]) assert.throws(attempt,/Denied/);
 assert.equal(b.link('alice','A','a','ia').id,'ia');
});
test('membership is rechecked and updates reject invalid or stale versions', () => {
 const {boundary:b,memberships}=setup();
 assert.throws(()=>b.updateStatus('alice','A','a','invalid',1),/Invalid/);
 assert.equal(b.updateStatus('alice','A','a','triaged',1).version,2);
 assert.throws(()=>b.updateStatus('alice','A','a','resolved',1),/Conflict/);
 memberships.get('alice').delete('A');
 assert.throws(()=>b.get('alice','A','tickets','a'),/Denied/);
 assert.throws(()=>b.listTickets('alice','A'),/Denied/);
});
