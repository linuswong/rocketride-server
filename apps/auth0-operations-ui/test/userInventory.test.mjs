import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUserInventory } from '../src/userInventory.ts';
const now = Date.parse('2026-11-19T12:00:00Z');
const user = (id, last_login) => ({ user_id:id, last_login });
function clientFor(pages) {
 const calls = [];
 return { calls, client: { tool: async ({tool,input}) => {
  calls.push({tool,input}); const page = pages[input.page];
  if (page instanceof Error) return {success:false,error_code:'MISSING_SCOPE'};
  return {success:true,users:page,count:page.length};
 } } };
}
test('counts 30-day activity and separates unknown dates', async () => {
 const {client,calls} = clientFor([[user('1','2026-11-18T12:00:00Z'),user('2','2026-10-20T12:00:00Z'),user('3','2026-10-20T11:59:59Z'),user('4',null),user('5','bad'),user('6','2026-11-20T00:00:00Z')]]);
 assert.deepEqual(await loadUserInventory(client,'fixture',now),{status:'complete',total:6,active:2,inactive:1,unknown:3,checkedAt:now});
 assert.deepEqual(calls,[{tool:'list_users',input:{page:0,limit:50}}]);
});
test('paginates without returning identifiers and detects duplicates', async () => {
 const first=Array.from({length:50},(_,i)=>user(String(i),null));
 let setup=clientFor([first,[user('next','2026-11-18T00:00:00Z')]]);
 let result=await loadUserInventory(setup.client,'fixture',now);
 assert.equal(result.status,'complete'); assert.equal(result.total,51); assert.equal(result.active,1); assert.equal(setup.calls.length,2); assert.equal(JSON.stringify(result).includes('next'),false);
 setup=clientFor([first,[user('0',null)]]); result=await loadUserInventory(setup.client,'fixture',now); assert.equal(result.status,'partial');
});
test('reports errors and caps without claiming complete inventory', async () => {
 assert.equal((await loadUserInventory(clientFor([new Error('denied')]).client,'fixture',now)).status,'error');
 const pages=Array.from({length:20},(_,page)=>Array.from({length:50},(_,i)=>user(`${page}-${i}`,null)));
 const result=await loadUserInventory(clientFor(pages).client,'fixture',now);
 assert.equal(result.status,'partial'); assert.equal(result.total,1000); assert.match(result.reason,/limit/);
 assert.equal((await loadUserInventory(clientFor([pages[0],new Error('denied')]).client,'fixture',now)).status,'partial');
});
test('rejects oversized inventory pages without counting their contents',async()=>{
 const page=Array.from({length:50},(_,i)=>user(String(i),null));
 const oversized=Array.from({length:51},(_,i)=>user(`extra-${i}`,null));
 const first=await loadUserInventory(clientFor([oversized]).client,'fixture',now);
 assert.equal(first.status,'error'); assert.equal(first.total,0);
 const later=await loadUserInventory(clientFor([page,oversized]).client,'fixture',now);
 assert.equal(later.status,'partial'); assert.equal(later.total,50); assert.match(later.reason,/Invalid inventory page/);
});
