import type { NewTicket, Triage } from './domain.ts';

/** Rules are demonstrations, not an assessment of urgency or customer intent. */
export function triageTicket(ticket: NewTicket): Triage {
 const text = `${ticket.subject} ${ticket.description}`.toLowerCase();
 if (/\b(login|log in|sign[ -]?in|authentication|password|mfa)\b/.test(text)) return {category:'authentication',priority:'normal',route:'auth0',reasoning:'The text mentions a sign-in term.',uncertainty:'Keyword matching can be wrong; verify the account and reported issue.',escalate:false};
 if (/\b(billing|invoice|payment|subscription)\b/.test(text)) return {category:'billing',priority:'normal',route:'human',reasoning:'The text mentions billing.',uncertainty:'A person must assess urgency and ownership.',escalate:true};
 if (/\b(error|broken|bug|crash)\b/.test(text)) return {category:'technical',priority:'normal',route:'knowledge',reasoning:'The text mentions a technical problem.',uncertainty:'A person must verify the problem.',escalate:false};
 if (/\b(how|question|help)\b/.test(text)) return {category:'general',priority:'normal',route:'knowledge',reasoning:'The text resembles a general question.',uncertainty:'Keyword matching may miss context.',escalate:false};
 return {category:'other',priority:'normal',route:'human',reasoning:'No supported keyword was found.',uncertainty:'Manual classification is required.',escalate:true};
}
export interface Article { id:string; title:string; content:string; source:string; relevance:string }
export interface KnowledgeProvider { search(query:string): Article[] }
const articles: Article[] = [
 {id:'demo-signin',title:'Fictional sign-in checklist',content:'Ask for the error message and time; verify account state before suggesting any change.',source:'demo://signin-checklist',relevance:'Matched sign-in terms'},
 {id:'demo-technical',title:'Fictional troubleshooting checklist',content:'Ask for reproduction steps and the exact error. Escalate if the issue persists.',source:'demo://technical-checklist',relevance:'Matched technical terms'},
];
export const demoKnowledge: KnowledgeProvider = {search(query) { const s=query.toLowerCase(); return articles.filter(a => a.id === 'demo-signin' ? /login|log in|sign.?in|password|mfa|auth/.test(s) : /error|bug|crash|broken|help/.test(s)).map(a=>({...a})); }};
export interface Draft { text:string; references:string[]; questions:string[]; escalation:string }
export function draftResponse(subject:string, articles:Article[], findings:string[]): Draft {
 const references = articles.map(a=>a.source);
 return {text:`Hello,\n\nThank you for contacting support about ${subject}. We are reviewing the information available. Please share the exact error message and when it occurred so we can investigate further.\n\nThank you.`,references,questions:['What error appeared and when?'],escalation:findings.length ? 'Review the linked fictional findings before escalating.' : 'Escalate if the issue persists or identity cannot be verified.'};
}
