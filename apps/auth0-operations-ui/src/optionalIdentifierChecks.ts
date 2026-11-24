import type { Investigation } from './investigation.ts';
import { safeError } from './investigationErrors.ts';
import { invokeRead, type Evidence, type ToolClient } from './operations.ts';
import { observedEvidence, submittedEmailWindow } from './submittedEmail.ts';

/** Stop additional reads on unknown or potentially shared provider failures. */
function stopsFurtherReads(evidence: Evidence | undefined): boolean {
 if (evidence?.status !== 'error') return false;
 return !['MISSING_SCOPE','FEATURE_UNAVAILABLE','SEARCH_INCOMPLETE'].includes(safeError(evidence.error) ?? '');
}

/** Run only explicitly approved, identifier-based checks, using the existing task. */
export async function runOptionalIdentifierChecks(client: ToolClient, token: string, result: Investigation, incidentTime: string, options: {logs:boolean; blocks:boolean}): Promise<{logs?:Evidence; blocks?:Evidence; skipped:string[]}> {
 const pending = [...(options.logs ? ['tenant log search'] : []),...(options.blocks ? ['protection check'] : [])];
 const output: {logs?:Evidence; blocks?:Evidence; skipped:string[]} = {skipped:[]};
 if (result.steps.some(step => stopsFurtherReads(step.evidence)) || stopsFurtherReads(result.accountHistory?.error)) return {...output,skipped:pending};
 if (options.logs) {
  const window = submittedEmailWindow(incidentTime);
  if (!window) output.skipped.push('tenant log search');
  else {
   output.logs = observedEvidence(await invokeRead(client,token,'search_submitted_email_logs',{email:result.target,...window}));
   if (stopsFurtherReads(output.logs)) {
    if (options.blocks) output.skipped.push('protection check');
    return output;
   }
  }
 }
 if (options.blocks) output.blocks = observedEvidence(await invokeRead(client,token,'get_blocks_by_email',{email:result.target}));
 return output;
}
