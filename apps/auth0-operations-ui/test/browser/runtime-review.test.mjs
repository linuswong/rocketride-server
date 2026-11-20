/* global process, setTimeout, clearTimeout, URL, console, fetch, WebSocket */
// Run after building the isolated fixture; uses an installed Chromium browser and CDP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const browserPath = process.env.SUPPORTPILOT_BROWSER || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : 'chromium');
const root = path.resolve('test/browser/dist');
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch { /* Navigation can replace the execution context. */ } await new Promise(r => setTimeout(r, 50)); } throw new Error('Timed out waiting for browser condition'); };

test('engine response reaches graph review', {timeout: 45000}, async () => {
 const server = createServer(async (req, res) => { try { const file = path.resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname)); if (!file.startsWith(root + path.sep)) throw Error('invalid path'); const ext = path.extname(file); res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[ext] || 'application/octet-stream'); res.end(await readFile(file)); } catch { res.writeHead(404).end(); } });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const dir = await mkdtemp(path.join(tmpdir(), 'supportpilot-browser-'));
 const chrome = spawn(browserPath, ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'], {stdio:'ignore'});
 let socket;
 try {
  const port = await waitFor(async () => (await readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim());
  console.log('Browser started');
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.address().port}/?lensplanner&manual&runtime&response=${encodeURIComponent(process.env.LOGINLENS_RUNTIME_RESPONSE || '')}`)}`, {method:'PUT'})).json();
  console.log('Browser page opened');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.onopen = resolve; socket.onerror = reject; });
  console.log('Browser connected');
  let id = 0; const pending = new Map();
  socket.onmessage = event => { const msg = JSON.parse(event.data); if (msg.method === 'Runtime.exceptionThrown' || msg.method === 'Runtime.consoleAPICalled') console.log(JSON.stringify(msg)); if (msg.id && pending.has(msg.id)) { const [resolve,reject] = pending.get(msg.id); pending.delete(msg.id); if (msg.error) reject(Error(msg.error.message)); else resolve(msg.result); } };
  const send = (method, params = {}) => new Promise((resolve,reject) => { const seq = ++id; const timer = setTimeout(()=>{pending.delete(seq); reject(Error(`Browser command timed out: ${method}`));},5000); pending.set(seq,[value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);}]); socket.send(JSON.stringify({id:seq,method,params})); });
  const evaluate = async expression => {
   const result = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    .catch(error => { throw new Error(`${error.message} while evaluating ${expression}`, {cause: error}); });
   if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
   return result.result.value;
  };
  await send('Runtime.enable');

  await send('Emulation.setDeviceMetricsOverride',{width:1200,height:1000,deviceScaleFactor:1,mobile:false});
  await waitFor(()=>evaluate("document.querySelectorAll('nav button').length===5"));
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Load tenant events').click()");
  await waitFor(()=>evaluate("document.body.innerText.includes('Tenant snapshot')"));
  await evaluate("[...document.querySelectorAll('section')].find(s=>s.offsetParent && s.innerText.includes('Investigate selected activity')).querySelector('button').click()");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.offsetParent && b.textContent.includes('Propose AI investigation')).click()");
  await waitFor(()=>evaluate("document.querySelectorAll('.lens-graph .react-flow__node').length===1"));
  assert.match(await evaluate("document.body.innerText"),/Approve and run 1 reads/);
  assert.match(await evaluate("document.querySelector('.lens-graph').innerText"),/get_log_event/);
  assert.equal(await evaluate("document.documentElement.dataset.fixtureCalls"),'1');
  assert.doesNotMatch(await evaluate("document.body.innerText"),/Evidence and next steps/);
 } finally { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({id:999999,method:'Browser.close'})); await new Promise(resolve=>setTimeout(resolve,500)); } socket?.close(); chrome.kill(); server.closeAllConnections(); server.close(); if (dir.startsWith(path.join(tmpdir(),'supportpilot-browser-'))) await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200}); }
});
