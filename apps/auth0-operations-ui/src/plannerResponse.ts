/** Only sanitized metadata is retained; task tokens, response bodies and evidence are never recorded. */
export type PlannerDiagnostic = {
 correlationId: string; provider: string; profile: string;
 dispatch: 'not_dispatched' | 'dispatched'; dispatchedChats?: number;
 response: 'not_received' | 'received' | 'error'; envelope?: string;
 contentType?: string; length?: number; finishReason: 'unavailable';
 parse: 'not_attempted' | 'valid' | 'invalid'; schema: 'not_checked' | 'valid' | 'invalid'; category?: string;
 validation?: GraphValidationIssue; graphStructure?: GraphStructure;
};
export type GraphValidationIssue = { category: string; path: string; expected: string; actual: string; explanation: string };
export type GraphStructure = { rootType: string; stepCount?: number; steps?: { index: number; type: string; tool: string; hasRef: boolean; hasPeriod: boolean; dependencyCount: number | null; hasUnexpectedFields: boolean }[] };
export type DiagnosticUpdate = (patch: Partial<PlannerDiagnostic>) => void;
export type PlannerCategory = 'provider_configuration' | 'task_failure' | 'provider_unavailable' | 'missing_response' | 'unexpected_envelope' | 'malformed_json' | 'possibly_truncated' | 'model_refusal' | 'invalid_graph' | 'unsupported_tool';
const messages: Record<PlannerCategory,string> = {
 provider_configuration:'AI provider configuration could not be verified.', task_failure:'The RocketRide AI task could not be started or verified.',
 provider_unavailable:'AI provider or pipeline unavailable.', missing_response:'Planner response missing.', unexpected_envelope:'Unexpected RocketRide response envelope.',
 malformed_json:'Planner returned malformed JSON.', possibly_truncated:'Planner response appears incomplete; truncation is not confirmed.',
 model_refusal:'Planner declined the request.', invalid_graph:'Planner returned an invalid investigation graph.', unsupported_tool:'Planner proposed an unsupported tool.',
};
export class PlannerError extends Error {
 category: PlannerCategory;
 constructor(category: PlannerCategory) { super(messages[category]); this.name='PlannerError'; this.category=category; }
}
export class GraphValidationError extends PlannerError {
 issue: GraphValidationIssue;
 constructor(issue: GraphValidationIssue) {
  super('invalid_graph');
  this.name = 'GraphValidationError';
  this.issue = issue;
  this.message = `Invalid investigation graph at ${issue.path}: ${issue.explanation}`;
 }
}
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Older engines do not advertise the opt-in one-attempt setting. */
export function supportsBoundedGemini(service: unknown): boolean {
 if (!object(service) || !object(service.Pipe) || !object(service.Pipe.schema) || !object(service.Pipe.schema.properties)) return false;
 const limit = service.Pipe.schema.properties.maxProviderAttempts;
 return object(limit) && limit.type === 'integer' && limit.minimum === 1 && limit.maximum === 1;
}

/** Extract one answer from the SDK's result_types envelope, never concatenate separate answers. */
export function plannerAnswer(result: unknown, update?: DiagnosticUpdate): string {
 update?.({response:'received',envelope:'unrecognized'});
 if (object(result) && (result.success === false || result.status === 'error')) throw new PlannerError('provider_unavailable');
 if (!object(result) || !object(result.result_types)) throw new PlannerError('unexpected_envelope');
 const entries=Object.entries(result.result_types).filter(([,type])=>type==='answers' || type==='text');
 if (!entries.length) throw new PlannerError('missing_response');
 if (entries.length!==1) throw new PlannerError('unexpected_envelope');
 const value=result[entries[0][0]];
 const items=Array.isArray(value)?value:[value];
 if (items.length===0) throw new PlannerError('missing_response');
 if (items.length!==1) throw new PlannerError('unexpected_envelope');
 const item=items[0];
 let answer: unknown = item;
 if (object(item) && Object.hasOwn(item,'answer')) answer=item.answer;
 let text: string;
 if (typeof answer==='string') text=answer;
 else if (object(answer) && Array.isArray(answer.steps)) text=JSON.stringify(answer);
 else if (answer===undefined || answer===null) throw new PlannerError('missing_response');
 else throw new PlannerError('unexpected_envelope');
 update?.({response:'received',envelope:'result_types/'+String(entries[0][1]),contentType:typeof answer==='string'?'text':'object',length:text.length});
 if (!text.trim()) throw new PlannerError('missing_response');
 if (/^\*\*LLM error\*\*/i.test(text.trim())) throw new PlannerError('provider_unavailable');
 if (text.length > 65536) throw new PlannerError('unexpected_envelope');
 return text;
}

/** Accept exactly one JSON object or a whole JSON Markdown fence; never mine prose for code. */
export function parsePlannerResponse(raw: string, update?: DiagnosticUpdate): unknown {
 if (typeof raw !== 'string' || raw.length > 65536) throw new PlannerError('unexpected_envelope');
 let text=raw.trim();
 if (!text) throw new PlannerError('missing_response');
 if (/^(?:i (?:cannot|can't|am unable)|unable to|i must decline|i cannot assist)\b/i.test(text)) throw new PlannerError('model_refusal');
 if (text.startsWith('```')) {
  const match=/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i.exec(text);
  if (!match) throw new PlannerError(text.endsWith('```')?'malformed_json':'possibly_truncated');
  text=match[1].trim();
 }
 let parsed: unknown;
 try { parsed=JSON.parse(text); }
 catch {
  update?.({parse:'invalid'});
  throw new PlannerError(text.startsWith('{') && !text.endsWith('}') ? 'possibly_truncated' : 'malformed_json');
 }
 update?.({parse:'valid'});
 return parsed;
}
