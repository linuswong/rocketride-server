// Local shell preview with a copied app and fictional offline data; no provider calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {cp,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const repo=path.resolve('../..');
const {startServer,stopServer}=createRequire(import.meta.url)(path.join(repo,'scripts/lib/server.js'));
const {DevSession,devPreviewUrl}=await import(pathToFileURL(path.join(repo,'packages/client-typescript/dist/cli/packages/client-typescript/src/app-dev/index.js')));
const {findApp}=await import(pathToFileURL(path.join(repo,'packages/client-typescript/dist/cli/packages/client-typescript/src/app-pack/index.js')));
const original=path.resolve('.');
const temp=await mkdtemp(path.join(tmpdir(),'loginlens-shell-preview-'));
const appDir=path.join(temp,'app');
const nodeSource=path.join(repo,'nodes/src/nodes/tool_auth0'), nodeStage=path.join(repo,'dist/server/nodes/tool_auth0');
const nodeFiles=['IInstance.py','auth0_client.py'], stagedOriginal=new Map(), stagedFixture=new Map(), replaced=new Set();
const browserPath=process.env.SUPPORTPILOT_BROWSER || (process.platform==='win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : 'chromium');
const waitFor=async(fn,ms=30000)=>{const until=Date.now()+ms;while(Date.now()<until){try{const result=await fn();if(result)return result;}catch{} await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Preview did not reach the expected state.');};
let server,session,browser,socket;
try {
 for(const file of nodeFiles){stagedOriginal.set(file,await readFile(path.join(nodeStage,file)));stagedFixture.set(file,await readFile(path.join(nodeSource,file)));await writeFile(path.join(temp,`backup-${file}`),stagedOriginal.get(file));}
 for(const file of nodeFiles){await writeFile(path.join(nodeStage,file),stagedFixture.get(file));replaced.add(file);}
 await cp(original,appDir,{recursive:true,filter:source=>!['node_modules','.rocketride','dist','test','docs'].includes(path.relative(original,source).split(path.sep)[0])});
 const pipelinePath=path.join(appDir,'src','auth0_telemetry.pipe');
 const pipeline=JSON.parse(await readFile(pipelinePath,'utf8'));
 Object.assign(pipeline.components.find(item=>item.provider==='tool_auth0').config,{domain:'loginlens-fixture.auth0.com',clientId:'fixture-client',clientSecret:'fixture-secret'});
 await writeFile(pipelinePath,JSON.stringify(pipeline));
 await symlink(path.join(original,'node_modules'),path.join(appDir,'node_modules'),process.platform==='win32'?'junction':'dir');
 const {app}=await findApp(temp,appDir); if(!app) throw Error('Copied app was not discovered.');
 const started=await startServer({script:'ai/eaas.py',basePort:43000,env:{UV_OFFLINE:'1',ROCKETRIDE_APIKEY:'MYAPIKEY',ROCKETRIDE_MOCK:path.join(original,'test/runtime/auth0-mock'),ROCKETRIDE_MOCK_SUBMITTED_EMAIL:'1',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'127.0.0.1,localhost',RR_SUBPROCESS_ENV:'HTTPS_PROXY,NO_PROXY,UV_OFFLINE'}});
 server=started.server;
 session=new DevSession({app,workspaceRoot:temp,engineOrigin:started.uri,install:false,watchPackageJson:false,onLine:line=>{if(/build|error|failed/i.test(line))console.log(`Preview: ${line}`);},onState:(state)=>{if(['building','ok','error'].includes(state))console.log(`Preview build: ${state}`);}});
 const origin=await Promise.race([session.start(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Dev preview timed out.')),60000);timer.unref();})]);
 const bundleUrl=new URL(`/apps/${encodeURIComponent(app.id)}/dev/remoteEntry.js`,origin);
 try{await waitFor(async()=>{const bundle=await fetch(bundleUrl,{signal:AbortSignal.timeout(5000)});return bundle.ok;},180000);}
 catch{throw Error('Dev preview bundle was not ready within 180 seconds.');}
 const preview=devPreviewUrl(origin,app.id,{engineOrigin:started.uri,token:'MYAPIKEY'});
 const profile=path.join(temp,'browser');
 browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 const port=await waitFor(async()=>(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0].trim());
 const page=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(preview)}`,{method:'PUT'})).json();
 socket=new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let sequence=0;const pending=new Map();
 socket.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id && pending.has(msg.id)){const [resolve,reject]=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(Error(msg.error.message)):resolve(msg.result);}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser command timed out: ${method}`));},10000);pending.set(id,[value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);}]);socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error('Browser evaluation failed.');return result.result.value;};
 await send('Runtime.enable');
 await send('Emulation.setTimezoneOverride',{timezoneId:'UTC'});
 await waitFor(()=>evaluate("document.body.innerText.includes('Investigate a login issue')"),60000);
 await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Propose offline example').click()");
 await waitFor(()=>evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent==='Approve and run checks')"));
 await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve and run checks').click()");
 await waitFor(()=>evaluate("document.body.innerText.includes('INVESTIGATION SUMMARY')"));
 assert.match(await evaluate('document.body.innerText'),/OFFLINE FIXTURE/);
 await waitFor(()=>evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent==='Propose investigation' && !button.disabled)"));
 await evaluate("(() => { const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; for(const [selector,value] of [['#account-investigation-target','person@example.com'],['input[type=datetime-local]','2026-01-01T12:00']]) {const input=document.querySelector(selector);set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));} })()");
 await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Propose investigation').click()");
 await waitFor(()=>evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent==='Approve and run checks')"));
 await waitFor(()=>evaluate("document.querySelectorAll('fieldset input[type=checkbox]').length===2"));
 await evaluate("document.querySelectorAll('fieldset input[type=checkbox]').forEach(input=>input.click())");
 await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Approve and run checks').click()");
 await waitFor(()=>evaluate("document.body.innerText.includes('INVESTIGATION SUMMARY · TOOL RESULTS')"));
 await waitFor(()=>evaluate("document.body.innerText.includes('1 brute-force protection record(s) returned')"));
 await waitFor(()=>evaluate("document.body.innerText.includes('1 matching event(s) returned')"));
 assert.match(await evaluate('document.body.innerText'),/Invalid email or username \(fu\)/);
 await evaluate("[...document.querySelectorAll('nav button')].find(button=>button.textContent==='Alerts').click()");
 await waitFor(()=>evaluate("[...document.querySelectorAll('button')].some(button=>button.textContent==='Load tenant events')"));
 await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Load tenant events').click()");
 await waitFor(()=>evaluate("document.body.innerText.includes('Unknown user') && !!document.querySelector('.lens-failures td button')"));
 await evaluate("[...document.querySelectorAll('.lens-failures td button')].find(button=>button.textContent==='Check account lead').click()");
 await evaluate("[...document.querySelectorAll('[aria-label=\"Selected failed sign-in\"] button')].find(button=>button.textContent==='Read sign-in event details').click()");
 await waitFor(()=>evaluate("document.body.innerText.includes('This email was submitted in the event')"));
 await evaluate("[...document.querySelectorAll('[aria-label=\"Selected failed sign-in\"] button')].find(button=>button.textContent==='Prepare account investigation').click()");
 await waitFor(()=>evaluate("!!document.querySelector('[aria-label=\"Incoming account lead\"]')"));
 await evaluate("[...document.querySelectorAll('[aria-label=\"Incoming account lead\"] button')].find(button=>button.textContent==='Use lead in a new form').click()");
 await waitFor(()=>evaluate("document.querySelector('#account-investigation-target')?.value==='person@example.com'"));
 await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Use selected event time for investigation').click()");
 await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Propose investigation').click()");
 await waitFor(()=>evaluate("document.querySelector('[aria-label=\"Proposed investigation details\"]')?.innerText.includes('selected event time, not customer-reported')"));
 assert.match(await evaluate('document.body.innerText'),/Source event: shell-failure/);
 console.log('RocketRide shell completed account investigations and the failed-event-to-account handoff using offline Auth0 fixtures.');
} finally {
 socket?.close(); browser?.kill();
 if(session) await session.stop().catch(()=>{});
 if(server) await stopServer({server}).catch(()=>{});
 for(const file of replaced){const current=await readFile(path.join(nodeStage,file));if(!current.equals(stagedFixture.get(file)))throw Error(`Staged ${file} changed; backup remains in ${temp}.`);await writeFile(path.join(nodeStage,file),stagedOriginal.get(file));}
 if(path.dirname(path.resolve(temp))!==path.resolve(tmpdir()) || !path.basename(temp).startsWith('loginlens-shell-preview-')) throw Error('Unexpected temporary preview directory.');
 await rm(temp,{recursive:true,force:true});
}
