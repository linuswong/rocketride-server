import React, { useEffect, useRef, useState } from 'react';
import type { Event } from '../loginLensAnalytics';
import { failedEventLead } from '../failedEventReview';
import { invokeRead, type ToolClient } from '../operations';

type Lead = {kind:'user_id' | 'email'; value:string};
export function FailedEventReview({event,client,connected,start,openAccount}: {event:Event; client:ToolClient | null; connected:boolean; start:()=>Promise<string>; openAccount?:(lead:Lead)=>void}) {
 const [busy,setBusy]=useState(false), [message,setMessage]=useState('');
 const [lead,setLead]=useState<Lead>();
 const lock=useRef(false), active=useRef(true);
 useEffect(()=>{active.current=true; return ()=>{active.current=false;};},[]);
 const read=async()=>{
  if (!client || !connected || lock.current) return;
  lock.current=true; setBusy(true); setLead(undefined); setMessage('');
  try {
   const token=await start(); if (!active.current) return;
   const evidence=await invokeRead(client,token,'get_log_event',{log_id:event.id,include_identity_hint:true});
   if (!active.current) return;
   if (evidence.status==='error') {setMessage(`Event details unavailable: ${evidence.error ?? 'Unknown error'}`);return;}
   const result=failedEventLead(event,evidence);
   if (result.kind==='mismatch') setMessage('Returned event details did not match the selected snapshot. No account lead was used.');
   else if (result.kind==='no_lead') setMessage('The matched event did not report a usable account ID or supported email. Ask the customer for an identifier.');
   else {setLead(result);setMessage(result.kind==='email' ? 'This email was submitted in the event. It has not been matched to an account and does not identify the person who attempted sign-in.' : 'This event reports an account ID. The profile has not been checked and the ID does not identify the person who attempted sign-in.');}
  } catch {if (active.current) setMessage('Event details could not be retrieved. Check the connection before trying again.');}
  finally {lock.current=false;if(active.current) setBusy(false);}
 };
 return <section aria-label="Selected failed sign-in"><h4>Selected failed sign-in</h4><p>Read the selected event’s account ID or submitted username, if present. This uses read:logs, retrieves potentially personal data, and does not run account checks.</p><button type="button" disabled={busy || !connected || !client} onClick={()=>void read()}>{busy ? 'Reading event…' : 'Read sign-in event details'}</button><p role="status">{message}</p>{lead && <><p>{lead.kind==='email' ? 'Submitted email' : 'Reported account ID'}: {lead.value}</p>{openAccount && <button type="button" onClick={()=>openAccount(lead)}>Prepare account investigation</button>}</>}</section>;
}
