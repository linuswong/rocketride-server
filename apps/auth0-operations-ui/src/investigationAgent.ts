import { parsePlannerResponse } from './plannerResponse.ts';
import { errorCounts, safeError } from './investigationErrors.ts';
import { accountRepetition } from './sourceInvestigation.ts';
import { MAX_AUTOMATIC_FOLLOWUPS } from './lensPlan.ts';
import type { InvestigationContext, Model, Result, Results, Step } from './lensPlan.ts';

export const MAX_AGENT_REQUESTS = 20;
const MAX_FOLLOWUP_CHECKS = MAX_AUTOMATIC_FOLLOWUPS;
const MAX_SOURCE_GROUPS = 20;
export type AgentRecommendation = {action:string; reason:string; uncertainty:string; references:string[]};
export type AgentOutcome = {plan:Step[]; results:Results; recommendation?:AgentRecommendation; status:'concluded' | 'limit' | 'unavailable'; requests:number; message?:string};
type Candidate = {id:string; tool:'get_log_event' | 'search_logs' | 'search_authentication_history' | 'investigate_source_group' | 'investigate_account_history'; ref?:string; period?:'previous_24h'; sourceRank?:number; sourceRef?:string; accountIndex?:number; historyPage?:number; depends?:string[]; label:string};
const eventCodes: Record<string,string> = {'Failed login':'f','Wrong password':'fp','Unknown user':'fu','Brute-force protection':'limit_wc','Account rate limited':'limit_sul','IP protection':'limit_mu','Successful login':'s','Successful sign-up':'ss'};
const safeFacts = new Set(['sourceRank','page','verified','matchingSource','duplicates','unavailable','unchecked','rateRetries','pageFull','selectedFailures','withSource','missingSource','sourceGroups','largestGroup','windowFailures','windowSuccesses','windowFailureRate','bruteForceAllowlisted','throttlingAllowlisted','aclRulesChecked','aclRangeMatches','aclRateRetries','allowlistRateRetries','retryAfterSeconds','enabled','returned','recognized','successes','failures','signups','protection']);
const record = (v:unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sentence = (v:unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 300 && !/[\x00-\x1f\x7f]/.test(v);
const genericAction = /^(?:please\s+)?(?:review|inspect|check|investigate|analyse|analyze)\s+(?:the\s+)?(?:(?:checked|observed|verified|repeated|selected|current|available|source|second)\s+){0,3}(?:pattern|activity|failures|anomaly|group|event|events|evidence|results|logs)\s*[.!]?$/i;
const manualLogReview = /^(?:please\s+)?(?:review|inspect|check|investigate|analyse|analyze)\s+(?:the\s+)?(?:(?:checked|observed|verified|repeated|selected|current|available|source|relevant|authentication|access|sign-in|security|audit)\s+){0,3}(?:logs?|events?|failures?|attempts?|patterns?|activity|evidence)\b/i;
const manualSourceReview = /^(?:please\s+)?(?:review|inspect|check|cross[- ]?reference|compare)\b[^\n]{0,240}\b(?:ip(?:v[46])?(?:\s+address(?:es)?)?|asn|source\s+group)\b/i;
const manualProtectionReview = /^(?:please\s+)?(?:review|inspect|check|investigate|evaluate)\b[^\n]{0,240}\b(?:allowlist(?:ed|ing)?|bruteforceallowlisted|throttlingallowlisted|brute[- ]force protection|ip throttling|protection settings|security polic(?:y|ies))\b/i;
const manualAccountCorrelation = /^(?:please\s+)?(?:(?:cross[- ]?reference|correlate|compare)\b[^\n]{0,200}\b(?:accounts?|account\s+identifiers?|user\s+ids?)\b|(?:review|inspect|check|investigate|analy[sz]e)\s+(?:the\s+)?(?:(?:specific|identified|linked|repeated|selected|verified)\s+){0,3}(?:account\s+)?(?:failures|attempts|activity|patterns?)(?:\s+(?:and|then)\b[^\n]*)?\s*[.!]?\s*$)/i;
const manualApplicationReview = /^(?:please\s+)?(?:review|inspect|check|investigate|evaluate)\b[^\n]{0,180}\b(?:application|client)(?:'s)?\b[^\n]{0,100}\b(?:configuration|settings)\b/i;
const blockRemoval = /\b(?:unblock|unlock|(?:remove|clear|lift)\b[^\n]{0,60}\b(?:block|lockout))\b/i;
const credentialChange = /\b(?:reset|rotate|change|replace|update)\b[^\n]{0,60}\b(?:passwords?|credentials?)\b|\b(?:passwords?|credentials?)[\s-]+(?:reset|rotation|change|replacement)\b/i;
const conditionalCredentialChange = /\b(?:if|after|once|when)\b[^\n]{0,120}\b(?:confirm(?:ed|ing)?|verif(?:ied|ying)|establish(?:ed|ing)?)\b[^\n]{0,100}\b(?:stale|compromised|exposed|leaked|invalid)\b|\b(?:if|after|once|when)\b[^\n]{0,120}\b(?:stale|compromised|exposed|leaked|invalid)\b[^\n]{0,100}\b(?:confirm(?:ed|ing)?|verif(?:ied|ying)|establish(?:ed|ing)?)\b/i;
const mfaChange = /\b(?:enable|enforce|require|implement|disable|remove|change)\b[^\n]{0,60}\b(?:mfa|multi[- ]factor(?: authentication)?)\b/i;
const protectionChange = /\b(?:enable|enforce|require|implement|disable|remove|change|block|add|tighten|loosen)\b[^\n]{0,100}\b(?:rate[- ]?limit(?:ing)?|captcha|throttl(?:ing|e)|allowlist|brute[- ]force protection|ip protection)\b/i;
const conditionalProtectionChange = /\b(?:if|after|once|when)\b[^\n]{0,120}\b(?:confirm(?:ed|ing)?|verif(?:ied|ying)|establish(?:ed|ing)?)\b[^\n]{0,100}\b(?:abuse|attack|malicious|policy|configuration|misconfiguration)\b|\b(?:if|after|once|when)\b[^\n]{0,120}\b(?:abuse|attack|malicious|policy|configuration|misconfiguration)\b[^\n]{0,100}\b(?:confirm(?:ed|ing)?|verif(?:ied|ying)|establish(?:ed|ing)?)\b/i;
const negatedAction = /^(?:please\s+)?(?:do not|don't|never|avoid)\b/i;
const emptyRecommendation = /^(?:none\b|no (?:action|further action|recommendation)\b)/i;
const noUncertainty = /^(?:none\b|no (?:uncertainty|uncertainties|limitations?)\b)/i;
const broadAbsence = /\bno\s+(?:(?:further|other|additional)\s+)?(?:failed\s+)?(?:failures?|attempts?|logins?|suspicious\s+activity|malicious\s+activity|indicators?\s+of\s+(?:abuse|attack|malicious\s+intent))\b/i;
const boundedAbsence = /\b(?:returned|checked|retrieved|inspected|verified)\s+(?:pages?|events?|logs?|history|records?)\b/i;
const assertedOngoingAttack = /\b(?:continued|ongoing|persistent)\s+(?:credential\s+(?:testing|stuffing)|password\s+spraying|attack(?:s)?)\b/i;

/** Candidate bindings are generated from selected evidence; the model cannot supply tool parameters. */
export function agentCandidates(context:InvestigationContext, plan:Step[], results:Results = {}): Candidate[] {
 // A shared Auth0 failure stopped account reads; do not bypass that stop by
 // scheduling another read through the model's follow-up graph.
 const stopped=Object.values(results).some(result=>['RATE_LIMITED','AUTH0_UNAVAILABLE','TIMEOUT','AUTHENTICATION_FAILED'].some(code=>result.accountEvidence?.eventStopReason===code || result.accountEvidence?.accountStopReason===code || result.accountEvidence?.detailStopReason===code || result.historyEvidence?.stopReason===code || safeError(result.detail)===code || safeError(result.facts?.historyError)===code || safeError(result.facts?.allowlistError)===code || safeError(result.facts?.aclError)===code));
 if (stopped) return [];
 const selected = context.events.slice(0,20);
 const candidates:Candidate[] = [];
 const alreadyVerified = new Set(Object.values(results).flatMap(result=>result.accountEvidence?.verifiedEventIds ?? []));
 for (const sourceStep of plan.filter(step=>['investigate_source_accounts','investigate_source_group'].includes(step.tool))) {
  const source=results[sourceStep.id]?.accountEvidence;
  source?.accounts.forEach((account,index)=>{
   if (account.profile!=='verified' || !account.logsPageFull) return;
   const prior=plan.filter(step=>step.tool==='investigate_account_history' && step.sourceRef===sourceStep.id && step.accountIndex===index).sort((a,b)=>(b.historyPage ?? 0)-(a.historyPage ?? 0));
   const last=prior[0], next=last ? (last.historyPage ?? 0)+1 : 1;
   if (next>4 || (last && (!results[last.id]?.historyEvidence?.pageFull || !!results[last.id]?.historyEvidence?.stopReason))) return;
   candidates.push({id:`history-${sourceStep.id}-${index}-${next}`,tool:'investigate_account_history',sourceRef:sourceStep.id,accountIndex:index,historyPage:next,depends:[sourceStep.id],label:`Inspect older activity for anonymous account ${sourceStep.id}-A${index+1}, page ${next+1}`});
  });
 }
 const groups=new Map<number,number>();
 for (const event of context.events) if (event.kind==='failure' && event.source!==undefined) groups.set(event.source,(groups.get(event.source) ?? 0)+1);
 const ranked=[...groups.values()].sort((a,b)=>b-a);
 for (let rank=2;rank<=Math.min(ranked.length,MAX_SOURCE_GROUPS);rank++) if (!plan.some(step=>step.tool==='investigate_source_group' && step.sourceRank===rank))
  candidates.push({id:`source-${rank}`,tool:'investigate_source_group',sourceRank:rank,label:`Inspect source group ${rank}: ${ranked[rank-1]} selected failures and linked accounts`});
 for (let i=0;i<selected.length;i++) {
  const ref=`E${i+1}`;
  if (!alreadyVerified.has(selected[i].id) && !plan.some(step=>step.tool==='get_log_event' && step.ref===ref)) candidates.push({id:`event-${i+1}`,tool:'get_log_event',ref,label:`Verify ${ref}: ${selected[i].category}`});
 }
 const existingTypes = new Set(plan.filter(step=>step.tool==='search_logs' && step.ref).map(step=>eventCodes[selected[Number(step.ref!.slice(1))-1]?.category]));
 const seen = new Set(existingTypes);
 for (let i=0;i<selected.length;i++) {
  const code=eventCodes[selected[i].category];
  if (!code || !['f','fp','fu','limit_wc','limit_sul','limit_mu'].includes(code) || seen.has(code)) continue;
  seen.add(code); candidates.push({id:`recent-${i+1}`,tool:'search_logs',ref:`E${i+1}`,label:`Check the newest page for ${selected[i].category}`});
 }
 const duration=context.end-context.start;
 if (duration !== 86400000 && !plan.some(step=>step.tool==='search_authentication_history' && step.period==='previous_24h')) candidates.push({id:'prior-24h',tool:'search_authentication_history',period:'previous_24h',label:'Check the preceding 24-hour tenant-wide window'});
 // Keep source comparisons visible even when many accounts have full pages,
 // and prefer the first older page of each account before going deeper.
 candidates.sort((a,b)=>{
  const priority=(candidate:Candidate)=>candidate.tool==='investigate_source_group' ? 0 : candidate.tool==='investigate_account_history' ? 1 : 2;
  return priority(a)-priority(b) || (a.historyPage ?? 0)-(b.historyPage ?? 0);
 });
 return candidates.slice(0,40);
}

function requiredCandidate(candidates:Candidate[],plan:Step[],results:Results):Candidate | undefined {
 const history=candidates.find(candidate=>candidate.tool==='investigate_account_history');
 const repeated=Object.values(results).some(result=>{
  const evidence=result.accountEvidence;
  return !!evidence && (evidence.accounts.some(account=>['verified','candidate'].includes(accountRepetition(account))) || evidence.unresolvedIdentifiers.some(identifier=>identifier.count>1));
 });
 const source=repeated ? candidates.find(candidate=>candidate.tool==='investigate_source_group') : undefined;
 if (!history || !source) return history ?? source ?? (repeated ? candidates[0] : undefined);
 const followups=plan.filter(step=>/^followup-\d+$/.test(step.id));
 const sourceCount=followups.filter(step=>step.tool==='investigate_source_group').length;
 const historyCount=followups.filter(step=>step.tool==='investigate_account_history').length;
 return sourceCount<historyCount ? source : history;
}

/** Count only direct event-to-account links with verified profiles in both groups. */
export function sourceAccountLinks(plan:Step[],results:Results) {
 const primary=plan.find(step=>step.tool==='investigate_source_accounts');
 const primaryAccounts=primary && results[primary.id]?.accountEvidence?.accounts;
 if (!primary || !primaryAccounts) return [];
 const known=new Set(primaryAccounts.filter(account=>account.profile==='verified' && account.directFailures>0).map(account=>account.userId));
 return plan.filter(step=>step.tool==='investigate_source_group' && results[step.id]?.accountEvidence).map(step=>({
  primaryCheck:primary.id,sourceCheck:step.id,sourceRank:step.sourceRank,
  accountIds:[...new Set(results[step.id].accountEvidence!.accounts.filter(account=>account.profile==='verified' && account.directFailures>0 && known.has(account.userId)).map(account=>account.userId))],
 }));
}
/** The model receives aggregate counts, never the linked account IDs. */
export function sourceAccountOverlaps(plan:Step[],results:Results) {
 return sourceAccountLinks(plan,results).map(({accountIds,...source})=>({...source,sharedVerifiedAccounts:accountIds.length}));
}

/** Send only fixed categories, timestamps and aggregate numbers; never IDs, IPs, usernames or raw tool text. */
export function agentEvidence(context:InvestigationContext, plan:Step[], results:Results) {
 const followups=plan.filter(step=>/^followup-\d+$/.test(step.id)).length;
 const sourceGroups=new Set(context.events.filter(event=>event.kind==='failure' && event.source!==undefined).map(event=>event.source));
 return {
  window:{start:new Date(context.start).toISOString(),end:new Date(context.end).toISOString()},
  selection:{totalEvents:context.events.length,shownEvents:Math.min(context.events.length,20)},
  followupLimitReached:followups>=MAX_FOLLOWUP_CHECKS && agentCandidates(context,plan,results).length>0,
  sourceGroupsBeyondLimit:Math.max(0,sourceGroups.size-MAX_SOURCE_GROUPS),
  sourceGroupLimitNote:'Source groups beyond the top 20 are not followed; a nonzero sourceGroupsBeyondLimit is incomplete coverage.',
  fingerprintCoverageNote:'JA4 coverage is unknown for matched events where the node did not return a JA4 field. Missing or invalid values do not establish that clients lack JA4.',
  laterSuccessNote:'A verified later success confirms an account login after its latest directly linked selected failure. The same-source and same-application flags compare identifiers only when both are available; even a match may involve a different device or credential. Not seen is limited to the returned user-log page and does not establish absence.',
  applicationNote:'Application ID counts use identifiers directly reported by verified events; name counts use non-unique labels. Missing IDs or names are unknown, and shared IDs or names do not establish stale credentials or a common actor.',
  applicationConfigNote:'Application settings are current nonsecret configuration, not proof of which flow a past event used or whether a credential is stale. Null settings and unexamined applications are unknown.',
  crossSourceAccounts:sourceAccountOverlaps(plan,results),
  limitations:['Source traffic is limited to the loaded snapshot. A short page does not prove Auth0 retention or indexing completeness. Repeated accounts require a verified profile and direct event links; candidateRepeated relies on email-derived links and unverifiedRepeated lacks a verified profile. Per-account failure categories count verified event-to-ID links only; a wrong-password event alone does not establish stale credentials or who submitted them. A shared JA3 or JA4 fingerprint may represent common client software and does not establish a common actor or malicious intent.', 'An IP appearing in an ACL match range does not prove the full rule applied, the action taken, or corporate ownership. ASN ownership is not resolved.', 'Auth0 account profiles and blocks require read:users; user logs require read:logs_users; event logs require read:logs; attack-protection lists require read:attack_protection; tenant ACLs require read:network_acls.'],
  events:context.events.slice(0,20).map((event,index)=>({ref:`E${index+1}`,category:event.category,utc:new Date(event.time).toISOString()})),
  observations:plan.map(step=>{
   const result=results[step.id];
   const facts=Object.fromEntries(Object.entries(result?.facts ?? {}).filter(([key,value])=>safeFacts.has(key) && (typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value)))));
   const account=result?.accountEvidence;
   const coverage=result?.facts?.coverage;
   return {id:step.id,tool:step.tool,state:result?.state ?? 'queued',facts,
    ...(safeError(result?.detail) ? {errorCode:safeError(result?.detail)} : {}),
    ...(safeError(result?.facts?.allowlistError) ? {allowlistError:safeError(result?.facts?.allowlistError)} : {}),
    ...(safeError(result?.facts?.aclError) ? {aclError:safeError(result?.facts?.aclError)} : {}),
    ...(safeError(result?.facts?.historyError) ? {historyError:safeError(result?.facts?.historyError)} : {}),
    ...(typeof result?.facts?.historyRetryAfterSeconds==='number' ? {historyRetryAfterSeconds:result.facts.historyRetryAfterSeconds} : {}),
    ...(typeof result?.facts?.allowlistRetryAfterSeconds==='number' ? {allowlistRetryAfterSeconds:result.facts.allowlistRetryAfterSeconds} : {}),
    ...(typeof result?.facts?.aclRetryAfterSeconds==='number' ? {aclRetryAfterSeconds:result.facts.aclRetryAfterSeconds} : {}),
    ...(['retrieved','partial','source_unavailable','unavailable'].includes(String(result?.facts?.aclCoverage)) ? {aclCoverage:result?.facts?.aclCoverage} : {}),
    ...(safeError(result?.historyEvidence?.stopReason) ? {historyStop:safeError(result?.historyEvidence?.stopReason)} : {}),
    ...(typeof result?.historyEvidence?.retryAfterSeconds==='number' ? {historyRetryAfterSeconds:result.historyEvidence.retryAfterSeconds} : {}),
    ...(step.ref && /^E(?:[1-9]|1\d|20)$/.test(step.ref) ? {eventRef:step.ref} : {}),
    ...(['anomaly','previous_window','previous_24h'].includes(step.period ?? '') ? {period:step.period} : {}),
    ...(coverage === 'partial' ? {coverage:'partial'} : coverage === 'Query exhausted; retention and indexing unverified' ? {coverage:'query exhausted; retention and indexing unverified'} : coverage === 'Latest page, at most 50 events' ? {coverage:'latest page only'} : {}),
    ...(account ? {accounts:{selected:account.selected,matched:account.matched,applicationIdGroups:account.reportedApplicationIds.length,largestApplicationIdGroup:Math.max(0,...account.reportedApplicationIds.map(item=>item.count)),missingApplicationId:account.missingApplicationId,applicationFallbacks:account.applicationFallbacks,applicationConfigUnchecked:account.applicationConfigUnchecked,applicationConfigs:account.applicationConfigs.map((config,index)=>({alias:`${step.id}-C${index+1}`,status:config.status,...(safeError(config.error) ? {error:safeError(config.error)} : {}),...(config.status==='verified' ? {appType:config.appType,authMethod:config.authMethod,authorizationCode:config.authorizationCode,password:config.password,refreshToken:config.refreshToken,clientCredentials:config.clientCredentials} : {})})),applicationNameGroups:account.reportedApplications.length,largestApplicationNameGroup:Math.max(0,...account.reportedApplications.map(item=>item.count)),missingApplication:account.missingApplication,ja3Reported:account.ja3Reported,ja3Groups:account.ja3Groups,ja3LargestGroup:account.ja3LargestGroup,ja4FieldReturned:account.ja4FieldReturned,ja4Reported:account.ja4Reported,ja4Groups:account.ja4Groups,ja4LargestGroup:account.ja4LargestGroup,fingerprintFallbacks:account.fingerprintFallbacks,unresolved:account.missingIdentity,reportedAccountIds:account.accounts.length,identified:account.accounts.filter(item=>item.profile==='verified').length,eventRetries:account.eventRetries,eventRetryResponsesSucceeded:account.eventRetryResponsesSucceeded,eventRateRetries:account.eventRateRetries,
     ...(safeError(account.eventStopReason) ? {eventStop:safeError(account.eventStopReason)} : {}),
     ...(account.eventRetryAfterSeconds!==undefined ? {eventRetryAfterSeconds:account.eventRetryAfterSeconds} : {}),
     ...(safeError(account.accountStopReason) ? {accountStop:safeError(account.accountStopReason)} : {}),
     ...(account.accountRetryAfterSeconds!==undefined ? {accountRetryAfterSeconds:account.accountRetryAfterSeconds} : {}),
     repeated:account.accounts.filter(item=>accountRepetition(item)==='verified').length,
     candidateRepeated:account.accounts.filter(item=>accountRepetition(item)==='candidate').length,
     unverifiedRepeated:account.accounts.filter(item=>accountRepetition(item)==='unverified').length,
     blocked:account.accounts.filter(item=>item.profile==='verified' && (item.blocked || item.bruteForceBlocked)).length,
     emailCandidates:account.emailHintResolved,
     unresolvedSubmittedIdentifiers:{unique:account.unresolvedIdentifiers.length,repeated:account.unresolvedIdentifiers.filter(item=>item.count>1).length,attemptCounts:account.unresolvedIdentifiers.map(item=>item.count)},
     incomplete:account.unchecked+account.uncheckedAccounts+account.failedEvents+account.differentSource,
     incompleteAccounts:account.accounts.filter(item=>item.profile!=='verified' || item.logs!=='retrieved' || item.bruteForceBlocked===null || item.logsEmpty || item.logsPageFull || item.invalidRecentEvents>0 || item.recentDetailsFailed>0 || item.recentDetailsUnchecked>0).length,
     recentDetailsLimited:account.detailBudgetReached,
     recentDetailRateRetries:account.detailRateRetries,
     ...(safeError(account.detailStopReason) ? {recentDetailStop:safeError(account.detailStopReason)} : {}),
     ...(account.detailRetryAfterSeconds!==undefined ? {recentDetailRetryAfterSeconds:account.detailRetryAfterSeconds} : {}),
     requestErrors:{events:account.eventErrors,profiles:errorCounts(account.accounts.map(item=>item.profileError)),logs:errorCounts(account.accounts.map(item=>item.logsError)),blocks:errorCounts(account.accounts.map(item=>item.blocksError)),identityLookups:errorCounts([account.hintLookupError])},
     items:account.accounts.map((item,index)=>({alias:`${step.id}-A${index+1}`,selectedFailures:item.selectedFailures,directFailures:item.directFailures,directFailureTypes:item.directFailureTypes,emailCandidateFailures:item.emailHintFailures,applicationIdGroups:item.reportedApplicationIds.length,applicationRefs:item.reportedApplicationIds.flatMap(application=>{const position=account.applicationConfigs.findIndex(config=>config.id===application.id);return position<0 ? [] : [`${step.id}-C${position+1}`];}),applicationNameGroups:item.reportedApplications.length,recentFailures:item.recentFailures,sameSourceRecentFailures:item.sameSourceRecentFailures,successAfterSelected:item.successAfterSelected,successAfterSelectedSameSource:item.successAfterSelectedSameSource,successAfterSelectedSameApplication:item.successAfterSelectedSameApplication,recentDetailsUnchecked:item.recentDetailsUnchecked,profile:item.profile,blocked:item.blocked,bruteForceBlocked:item.bruteForceBlocked,logs:item.logs,pageFull:item.logsPageFull}))}} : {}),
    ...(step.tool==='investigate_account_history' ? {accountAlias:`${step.sourceRef}-A${(step.accountIndex ?? 0)+1}`,page:step.historyPage} : {})};
  }),
 };
}

const instructions = `You are a read-only Auth0 investigation planner. Use only the supplied aggregate evidence, not outside assumptions. Seek a concrete, evidence-supported remedy: before concluding, choose a relevant remaining candidate whenever it could resolve an uncertainty needed to select that remedy. Do not ask the user to perform a check that appears in the candidate list. After each check, reassess the evidence and continue until a remedy is supported, no remaining candidate can clarify it, or the request budget requires stopping. Either choose exactly one candidate ID from the current list, or conclude with one prioritized conditional recommendation and evidence references. Candidates can check other selected sources, selected events, event types, time windows, or older pages for anonymous evidence-bound accounts. Repeated unresolved submitted identifiers indicate what was targeted, not a verified account or actor. Never request identifiers or invent a tool, parameters, facts, a confirmed cause, or an action already taken. Missing or partial evidence is not a negative result. In a conclusion, action must be a specific step or state that the evidence cannot determine a fix; never use "None" as the action. If any check is partial or incomplete, uncertainty must describe what is unknown and must not say "None". If followupLimitReached is true, state that eligible checks remain unrun. Tenant-wide history does not prove source-specific causality. A blocked account or shared network does not prove an attack. Never recommend a credential reset unless the action makes it conditional on confirming stale, invalid or compromised credentials. Never recommend changing rate limits, CAPTCHA, allowlists or other protection settings unless the action makes the change conditional on confirming abuse or applicable policy. Do not recommend enabling, disabling or changing MFA without evidence of enrollment and policy. Output one JSON object only: {"decision":"check","candidate":"candidate ID"} or {"decision":"conclude","action":"one concise proposed action","reason":"evidence-based reason","uncertainty":"remaining uncertainty","references":["successful or partial check ID"]}. Each text field must be 1-300 characters. Never request or perform writes. If the remaining request budget is one, conclude; if evidence cannot determine a fix, say so.`;

const citationInstructions='For a conclusion, references must be an array of one to four distinct IDs of successful or partial observations. Cite the most relevant checks only. Never return an empty array, more than four references, account aliases, or tool names. Scope any statement about absent failures or suspicious activity to the specific returned pages or checked events; incomplete logs do not prove absence. Describe observed login failures without asserting that credential testing or an attack is ongoing.';

export async function runInvestigationAgent({context,plan,results,model,perform,update,active=()=>true,maxRequests=MAX_AGENT_REQUESTS}: {
 context:InvestigationContext; plan:Step[]; results:Results; model:Model;
 perform:(plan:Step[],results:Results)=>Promise<Results>;
 update:(plan:Step[],results:Results,message:string)=>void; active?:()=>boolean; maxRequests?:number;
}): Promise<AgentOutcome> {
 if (!Number.isInteger(maxRequests) || maxRequests<1 || maxRequests>MAX_AGENT_REQUESTS) throw new Error('Invalid investigation request limit.');
 let currentPlan=[...plan], currentResults={...results}, requests=0, invalidDecisions=0, feedback='';
 const base = (status:AgentOutcome['status'], message?:string):AgentOutcome => {
  const remaining=followupCount()>=MAX_FOLLOWUP_CHECKS && agentCandidates(context,currentPlan,currentResults).length>0;
  const sources=new Set(context.events.filter(event=>event.kind==='failure' && event.source!==undefined).map(event=>event.source));
  const warnings=[...(remaining ? [`The ${MAX_FOLLOWUP_CHECKS}-check follow-up limit was reached; additional eligible checks remain.`] : []),...(sources.size>MAX_SOURCE_GROUPS ? [`${sources.size-MAX_SOURCE_GROUPS} source group(s) exceed the 20-group investigation limit.`] : [])];
  return {plan:currentPlan,results:currentResults,status,requests,message:[message,...warnings].filter(Boolean).join(' ') || undefined};
 };
 const followupCount=()=>currentPlan.filter(item=>/^followup-\d+$/.test(item.id)).length;
 const runCheck=async (candidate:Candidate)=>{
  const followupNumber=followupCount()+1;
  const step:Step={id:`followup-${followupNumber}`,tool:candidate.tool,purpose:candidate.label,depends:candidate.depends ?? [],...(candidate.ref ? {ref:candidate.ref} : {}),...(candidate.period ? {period:candidate.period} : {}),...(candidate.sourceRank ? {sourceRank:candidate.sourceRank} : {}),...(candidate.sourceRef ? {sourceRef:candidate.sourceRef,accountIndex:candidate.accountIndex,historyPage:candidate.historyPage} : {})};
  currentPlan=[...currentPlan,step];
  update(currentPlan,currentResults,`Running follow-up ${followupNumber}: ${candidate.label}.`);
  currentResults=await perform(currentPlan,currentResults);
 };
 for (let round=0; round<maxRequests; round++) {
  if (!active()) return base('unavailable','The selected evidence changed before the investigation finished.');
  // Repeated attempts justify exhausting evidence-bound checks before each
  // model request, including when a previous follow-up discovered repetition.
  while (active() && followupCount()<MAX_FOLLOWUP_CHECKS) {
   const next=requiredCandidate(agentCandidates(context,currentPlan,currentResults),currentPlan,currentResults);
   if (!next) break;
   try {await runCheck(next);} catch {return base('unavailable','A follow-up could not run. Inspect the checks already recorded.');}
  }
  if (!active()) return base('unavailable','The selected evidence changed before the investigation finished.');
  const candidates=followupCount()<MAX_FOLLOWUP_CHECKS ? agentCandidates(context,currentPlan,currentResults) : [];
  update(currentPlan,currentResults,`AI follow-up ${round+1} of ${maxRequests}: reviewing the evidence…`);
  let response:string;
  try {
   requests++;
   const primary=currentPlan.find(step=>step.tool==='investigate_source_accounts');
   const blocked=primary && currentResults[primary.id]?.accountEvidence?.accounts.some(account=>account.profile==='verified' && (account.blocked===true || account.bruteForceBlocked===true));
   const blockHint=blocked ? ` A verified account block is recorded in ${primary!.id}. If recommending its removal, make it conditional on confirming it is no longer needed, cite ${primary!.id}, and acknowledge that it may not explain every failure.` : '';
   const correctedInstructions=`${instructions}\n${citationInstructions}${feedback ? `\nCorrection from the application validator: ${feedback}${blockHint}` : ''}`;
   response=await model(correctedInstructions,{remainingRequests:maxRequests-round,evidence:agentEvidence(context,currentPlan,currentResults),candidates:candidates.map(({id,label})=>({id,label})),...(feedback ? {feedback} : {})},()=>{});
   if (!active()) return base('unavailable','The selected evidence changed before the investigation finished.');
  } catch { return base('unavailable','AI follow-up was unavailable. The recorded checks remain available.'); }
  let raw:unknown;
  try { raw=parsePlannerResponse(response); }
  catch {
   feedback='The previous response was not valid JSON. Return one object matching the required schema.';
   if (++invalidDecisions<=2 && round<maxRequests-1) continue;
   return base('unavailable','AI follow-up repeatedly returned invalid JSON. The recorded checks remain available.');
  }
  if (!record(raw)) {
   feedback='The previous response was not an object. Return one object matching the required schema.';
   if (++invalidDecisions<=2 && round<maxRequests-1) continue;
   return base('unavailable','AI follow-up returned an invalid decision. The recorded checks remain available.');
  }
  // Continue concrete, evidence-bound checks before accepting a conclusion
  // while there is budget to reassess the result.
  const requiredFollowup=requiredCandidate(candidates,currentPlan,currentResults);
  if (raw.decision==='conclude' && requiredFollowup && round<maxRequests-1) {
   raw={decision:'check',candidate:requiredFollowup.id};
   feedback='';
  }
  if (!record(raw)) return base('unavailable','AI follow-up returned an invalid decision.');
  if (raw.decision==='conclude') {
   // Event aliases are evidence-bound; accept them only when exactly one
   // successful event check verified that alias, then cite the check itself.
   const references=Array.isArray(raw.references) ? raw.references.map(ref=>{
    if (typeof ref!=='string' || !/^E(?:[1-9]|1\d|20)$/.test(ref)) return ref;
    const matches=currentPlan.filter(step=>step.tool==='get_log_event' && step.ref===ref && currentResults[step.id]?.state==='success');
    return matches.length===1 ? matches[0].id : ref;
   }) : raw.references;
   const problems:string[]=[];
   if (Object.keys(raw).some(key=>!['decision','action','reason','uncertainty','references'].includes(key))) problems.push('remove extra fields');
   for (const field of ['action','reason','uncertainty']) if (!sentence(raw[field])) problems.push(`${field} must be a nonempty string of at most 300 characters with no control characters`);
   if (!Array.isArray(references) || !references.length || references.length>4) problems.push('references must be an array containing one to four check IDs');
   else {
    const validIds=currentPlan.filter(step=>['success','partial'].includes(currentResults[step.id]?.state)).map(step=>step.id);
    if (!references.every(ref=>typeof ref==='string' && validIds.includes(ref))) {
     const invalid=references.filter(ref=>typeof ref!=='string' || !validIds.includes(ref));
     const kinds=[...new Set(invalid.map(ref=>typeof ref!=='string' ? 'non-string reference' : /^E\d+$/i.test(ref) ? 'event reference' : /-A\d+$/i.test(ref) ? 'account alias' : currentPlan.some(step=>step.tool===ref) ? 'tool name' : 'unknown check ID'))];
     problems.push(`references must name existing successful or partial check IDs; invalid types: ${kinds.join(', ')}; valid check IDs: ${validIds.join(', ') || 'none'} (do not use event references or account aliases)`);
    }
    if (new Set(references).size!==references.length) problems.push('references must be distinct');
   }
   if (problems.length) {
    feedback=`The previous conclusion was invalid: ${problems.join('; ')}.`;
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    return base('unavailable',`AI follow-up returned an invalid recommendation or evidence reference: ${problems.join('; ')}.`);
   }
   if (!sentence(raw.action) || !sentence(raw.reason) || !sentence(raw.uncertainty) || !Array.isArray(references)) return base('unavailable','AI follow-up returned an invalid conclusion.');
   if ([raw.action,raw.reason,raw.uncertainty].some(field=>broadAbsence.test(field) && !boundedAbsence.test(field))) {
    feedback='The previous conclusion made an unbounded absence claim. State only what was or was not observed in the returned pages or checked events; those pages do not prove complete history or the absence of malicious activity.';
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    return base('unavailable','AI follow-up overstated what the available history could establish.');
   }
   if ([raw.action,raw.reason,raw.uncertainty].some(field=>assertedOngoingAttack.test(field))) {
    feedback='The checked failures do not by themselves establish ongoing credential testing or an attack. Describe the observed failures without asserting intent or attack activity, and retain any real uncertainty.';
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    return base('unavailable','AI follow-up asserted an ongoing attack without sufficient evidence.');
   }
   if (emptyRecommendation.test(raw.action.trim()) || (noUncertainty.test(raw.uncertainty.trim()) && currentPlan.some(step=>currentResults[step.id]?.state!=='success'))) {
    feedback='Give one specific action or explicitly state that the evidence cannot determine a fix. Incomplete checks are a real limitation; do not say there is no uncertainty.';
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    return base('unavailable','AI follow-up did not provide an actionable recommendation with appropriate uncertainty.');
   }
   const sourceInspected=currentPlan.some(step=>['analyze_source_groups','investigate_source_group'].includes(step.tool) && typeof currentResults[step.id]?.facts?.sourceIp==='string' && currentResults[step.id]?.facts?.sourceIp!=='Unavailable');
   const accountsInspected=Object.values(currentResults).some(result=>(result.accountEvidence?.checked ?? 0)>0);
   const applicationInspected=Object.values(currentResults).some(result=>result.accountEvidence?.applicationConfigs.some(config=>config.status==='verified'));
   if (genericAction.test(raw.action.trim()) || (sourceInspected && (manualSourceReview.test(raw.action.trim()) || manualProtectionReview.test(raw.action.trim()))) || (accountsInspected && (manualAccountCorrelation.test(raw.action.trim()) || manualLogReview.test(raw.action.trim()))) || (applicationInspected && manualApplicationReview.test(raw.action.trim()))) {
    feedback='The previous action was too generic or repeated a source inspection or account correlation. Choose a useful listed check, propose a specific supported action, or explicitly state that the evidence cannot determine a fix.';
    if (sourceInspected && manualProtectionReview.test(raw.action.trim())) feedback+=' Do not ask for another allowlist or protection-settings review. If no available check supports a specific fix, use "The evidence cannot determine a fix." as the action.';
    if (applicationInspected && manualApplicationReview.test(raw.action.trim())) feedback+=' The selected application settings were already checked. Do not ask for the same review; current settings do not by themselves prove stale credentials or the cause of a failure.';
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    if (candidates.length && round<maxRequests-1) {
     try {await runCheck(candidates[0]);} catch {return base('unavailable','A follow-up could not run. Inspect the checks already recorded.');}
     invalidDecisions=0;
     feedback='The application ran another available read-only check after repeated generic recommendations. Use the new evidence to select a useful remaining check or give one specific supported action; if none is supported, state that the evidence cannot determine a fix.';
     continue;
    }
    return base('unavailable','AI follow-up did not produce a specific supported recommendation.');
   }
   if (blockRemoval.test(raw.action) && !negatedAction.test(raw.action.trim())) {
    const admin=/\badministrative\b/i.test(raw.action), brute=/\bbrute[- ]force\b/i.test(raw.action);
    const primaryStep=currentPlan.find(step=>step.tool==='investigate_source_accounts');
    const eligibleReferences=primaryStep ? references.filter(ref=>ref===primaryStep.id) : references;
    const verified=eligibleReferences.some(ref=>currentResults[ref]?.accountEvidence?.accounts.some(account=>account.profile==='verified' && (admin || brute ? (admin && account.blocked===true) || (brute && account.bruteForceBlocked===true) : account.blocked===true || account.bruteForceBlocked===true)));
    if (!verified) {
     feedback='The proposed block removal is not supported by a cited verified account block of that kind. Choose another check or a recommendation supported by cited evidence.';
     if (++invalidDecisions<=2 && round<maxRequests-1) continue;
     return base('unavailable','AI follow-up proposed block removal without matching verified evidence.');
    }
   }
   if (credentialChange.test(raw.action) && !negatedAction.test(raw.action.trim()) && !conditionalCredentialChange.test(raw.action)) {
    feedback='The evidence does not establish that credentials are stale, invalid or compromised. Do not recommend a credential change unless the action makes it conditional on confirming such a condition; otherwise choose another check or say that the evidence cannot determine a fix.';
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    return base('unavailable','AI follow-up proposed a credential change without a verified condition.');
   }
   if (mfaChange.test(raw.action) && !negatedAction.test(raw.action.trim())) {
    feedback='The available checks do not establish the account MFA enrollment or policy. Do not propose an MFA change as a remedy without evidence; choose another check or state that the evidence cannot determine a fix.';
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    return base('unavailable','AI follow-up proposed an MFA change without supporting evidence.');
   }
   if (protectionChange.test(raw.action) && !negatedAction.test(raw.action.trim()) && !conditionalProtectionChange.test(raw.action)) {
    feedback='The available evidence does not by itself justify changing protection settings. Make any proposed change conditional on confirming abuse or the applicable policy, choose another check, or state that the evidence cannot determine a fix.';
    if (++invalidDecisions<=2 && round<maxRequests-1) continue;
    return base('unavailable','AI follow-up proposed a protection change without a verified condition.');
   }
   return {...base('concluded'),recommendation:{action:raw.action,reason:raw.reason,uncertainty:raw.uncertainty,references:references as string[]}};
  }
  if (round===maxRequests-1) return base('limit','The automatic follow-up request limit was reached.');
  if (raw.decision!=='check' || Object.keys(raw).some(key=>!['decision','candidate'].includes(key)) || typeof raw.candidate!=='string') {
   feedback='The previous check decision was invalid. Select one listed candidate ID and include no other fields.';
   if (++invalidDecisions<=2) continue;
   return base('unavailable','AI follow-up could not select a valid next check.');
  }
  const candidate=candidates.find(item=>item.id===raw.candidate);
  if (!candidate) {
   feedback='The previous candidate was unavailable or already completed. Select an ID from the current candidate list.';
   if (++invalidDecisions<=2) continue;
   return base('unavailable','AI follow-up selected an unavailable or previously completed check.');
  }
  invalidDecisions=0; feedback='';
  try {await runCheck(candidate);}
  catch { return base('unavailable','A follow-up could not run. Inspect the checks already recorded.'); }
 }
 return base('limit','The automatic follow-up request limit was reached.');
}

/** The offline example exercises multiple reasoning rounds without a provider. */
export function fixtureAgent(): Model {
 let calls=0;
 return async (_instructions,payload) => {
  const data=payload as {candidates:{id:string}[];evidence:{observations:{id:string;state:Result['state'];accounts?:{identified:number;repeated:number;blocked:number}}[]}};
  calls++;
  if (calls<=2 && data.candidates.length) return JSON.stringify({decision:'check',candidate:data.candidates[0].id});
  const sources=data.evidence.observations.filter(item=>item.accounts && ['success','partial'].includes(item.state));
  const reference=data.evidence.observations.find(item=>item.state==='success')?.id;
  const counts=sources.reduce((sum,item)=>({identified:sum.identified+(item.accounts?.identified ?? 0),repeated:sum.repeated+(item.accounts?.repeated ?? 0),blocked:sum.blocked+(item.accounts?.blocked ?? 0)}),{identified:0,repeated:0,blocked:0});
  const action=counts.blocked ? 'Review the fictional account blocks before recovery.' : counts.repeated ? 'The fictional evidence cannot establish a fix; update credentials only if confirmed stale.' : 'Do not reset accounts solely for these fictional events.';
  const reason=sources.length ? `${counts.identified} fictional account findings were checked; ${counts.repeated} show repeated attempts and ${counts.blocked} are blocked.` : 'The fictional evidence is incomplete.';
  return JSON.stringify({decision:'conclude',action,reason,uncertainty:'The example does not establish a real cause.',references:sources.length?sources.slice(0,4).map(item=>item.id):reference?[reference]:[]});
 };
}
