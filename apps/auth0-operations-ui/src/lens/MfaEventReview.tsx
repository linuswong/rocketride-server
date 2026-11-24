import React, { useEffect, useRef, useState } from 'react';
import type { OtherEvent } from '../loginLensAnalytics';
import { mfaEventAccount } from '../mfaEventReview';
import { invokeRead, type ToolClient } from '../operations';

export function MfaEventReview({event, client, connected, start, openAccount}: {event:OtherEvent; client:ToolClient | null; connected:boolean; start:()=>Promise<string>; openAccount?:(id:string)=>void}) {
 const [busy,setBusy] = useState(false);
 const [message,setMessage] = useState('');
 const [userId,setUserId] = useState<string>();
 const lock = useRef(false), active = useRef(true);
 useEffect(() => {active.current=true; return () => {active.current=false;};},[]);
 const read = async () => {
  if (!client || !connected || lock.current) return;
  lock.current=true; setBusy(true); setMessage(''); setUserId(undefined);
  try {
   const token=await start();
   if (!active.current) return;
   const evidence=await invokeRead(client,token,'get_log_event',{log_id:event.id});
   if (!active.current) return;
   if (evidence.status === 'error') {setMessage(`Event details unavailable: ${evidence.error ?? 'Unknown error'}`); return;}
   const match=mfaEventAccount(event,evidence);
   if (match.kind === 'mismatch') setMessage('Returned event details did not match the selected snapshot. No account lead was used.');
   else if (match.kind === 'no_user') setMessage('The matched event did not report a usable account ID. Ask the customer for an identifier.');
   else {setUserId(match.userId); setMessage('The matched event reports an account ID. The profile has not been checked; this does not establish who attempted sign-in or authorize access.');}
  } catch {if (active.current) setMessage('Event details could not be retrieved. Check the connection before trying again.');}
  finally {lock.current=false; if (active.current) setBusy(false);}
 };
 return <section aria-label="Selected MFA event"><h4>Selected MFA event</h4><p>Read the selected event to check whether Auth0 reports an account ID. This uses read:logs, does not run account checks, and may return no ID.</p><button type="button" disabled={busy || !connected || !client} onClick={()=>void read()}>{busy ? 'Reading event…' : 'Read event details'}</button><p role="status">{message}</p>{userId && <><p>Reported account ID: {userId}</p>{openAccount && <button type="button" onClick={()=>openAccount(userId)}>Prepare account investigation</button>}</>}</section>;
}
