// Explicitly authorized read-only test-user check; print no identifiers or configuration values.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {RocketRideClient} from 'rocketride';
import {invokeRead} from '../src/operations.ts';

const subject=process.env.LOGINLENS_TEST_EMAIL,uri=process.env.ROCKETRIDE_URI,auth=process.env.ROCKETRIDE_APIKEY;
if(process.env.LOGINLENS_LIVE_CONFIRM!=='AUTHORIZED_DEVELOPMENT_TENANT_READ_ONLY' || !subject || !uri || !auth) throw Error('Read-only authorization and engine settings required.');
const pipe=JSON.parse(await readFile(new URL('../src/auth0_telemetry.pipe',import.meta.url),'utf8'));pipe.project_id=randomUUID();
if(pipe.components.find(item=>item.id==='tool_auth0_1')?.config?.allowWrite!==false)throw Error('Read-only guard failed.');
const client=new RocketRideClient({uri,auth});let token;
try {
 await client.connect();token=(await client.use({pipeline:pipe,useExisting:false,ttl:300,pipelineTraceLevel:'none'})).token;
 const user=await invokeRead(client,token,'search_users',{email:subject,limit:2});
 if(user.status!=='success'||user.data.users.length!==1||user.data.users[0].email?.toLowerCase()!==subject.toLowerCase())throw Error('Test account unavailable.');
 const logs=await invokeRead(client,token,'get_user_logs',{user_id:user.data.users[0].user_id,limit:20});
 const event=logs.data?.events?.find(row=>['f','fp','fu'].includes(row.type)&&row.log_id);
 if(logs.status!=='success'||!event)throw Error('Test failure unavailable.');
 const detail=await invokeRead(client,token,'get_log_event',{log_id:event.log_id,include_application:true});
 if(detail.status!=='success'||detail.data?.user_id!==user.data.users[0].user_id||!detail.data?.client_id)throw Error('Test application unavailable.');
 try {
  const result=await client.tool({token,tool:'get_application_config',nodeId:'tool_auth0_1',input:{client_id:detail.data.client_id}});
  const code=typeof result?.error_code==='string'&&/^[A-Z_]{1,40}$/.test(result.error_code)?result.error_code:'none';
  const message=typeof result?.error==='string'?result.error:'';
  console.log('Settings result:',result?.success===true?'success':'failed','code:',code,'request rejected:',message==='Auth0 rejected the request.','invalid response:',message==='Auth0 returned an invalid response.','unexpected application:',/unexpected application/i.test(message),'invalid settings:',/invalid application settings/i.test(message));
 } catch(error) {console.log('Settings invocation failed; unknown-tool indication:',/unknown tool|not found|unsupported/i.test(error instanceof Error?error.message:''));}
} finally {if(token)await client.terminate(token).catch(()=>{});await client.disconnect().catch(()=>{});}
