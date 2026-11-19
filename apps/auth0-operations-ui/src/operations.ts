import type { PIPELINE_RESULT } from 'rocketride';

export function extractAnswers(result: PIPELINE_RESULT): string[] {
 if (!result || typeof result !== 'object' || !result.result_types || typeof result.result_types !== 'object') return [];
 return Object.entries(result.result_types).flatMap(([key, type]) => {
  if (type !== 'answers' && type !== 'text') return [];
  const value = result[key];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap(item => {
   const text = typeof item === 'string' ? item : item && typeof item === 'object' && typeof item.answer === 'string' ? item.answer : '';
   return text.trim() ? [text.trim()] : [];
  });
 });
}

export const prompts = {
 users: 'Use list_users to show one page of users and report the returned fields and any errors.',
 roles: 'Use list_roles to show one page of roles and report the returned fields and any errors.',
 permissions: 'Use get_user_permissions for the specified user ID.',
 applications: 'Use list_applications to show one page of applications and report returned fields and errors.',
 connections: 'Use list_connections to show one page of connections and report returned fields and errors.',
 logs: 'Use search_logs to show one page of recent authentication events and report returned fields and errors.',
 brute: 'Use get_brute_force_settings and report the returned configuration and errors.',
 throttle: 'Use get_ip_throttling_settings and report the returned configuration and errors.',
} as const;

const listKeys: Record<string, string> = {
 search_users: 'users', get_user_logs: 'events', search_logs: 'events', list_users: 'users',
 list_roles: 'roles', get_user_roles: 'roles', get_user_permissions: 'permissions',
 list_applications: 'applications', list_connections: 'connections', get_connection_clients: 'clients',
 list_organizations: 'organizations', get_organization_members: 'members',
};
const noArgs = new Set(['list_users', 'list_roles', 'list_applications', 'list_connections', 'list_organizations', 'get_brute_force_settings', 'get_ip_throttling_settings']);
const idArgs: Record<string, string> = { get_user: 'user_id', get_user_logs: 'user_id', get_user_blocks: 'user_id', get_user_roles: 'user_id', get_user_permissions: 'user_id', get_log_event: 'log_id', get_connection: 'connection_id', get_connection_clients: 'connection_id', get_organization_members: 'organization_id' };
const allowedTools = new Set([...Object.keys(listKeys), ...noArgs, ...Object.keys(idArgs), 'get_user_blocks', 'get_user', 'search_logs']);
export interface Evidence { tool: string; status: 'success' | 'error'; input?: Record<string, unknown>; data?: Record<string, unknown>; error?: string; }
export interface ToolClient { tool(options: { token: string; tool: string; nodeId: string; input: Record<string, unknown> }): Promise<unknown>; }
export interface LookupPlan { email?: string; tool?: string; input?: Record<string, unknown>; error?: string; }

/** Only recognize bounded read operations; never pass an arbitrary tool name from text to the engine. */
export function planLookup(text: string): LookupPlan {
 const names = [...text.matchAll(/\b(?:search|list|get|create|update|delete|unblock)_[a-z_]+\b/gi)].map(match => match[0].toLowerCase());
 if (new Set(names).size > 1) return { error: 'Request one named tool at a time so each result can be verified.' };
 const named = names[0];
 if (named && !allowedTools.has(named)) return { error: `Operation ${named} is unavailable in this read-only console.` };
 const email = text.match(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
 if (named === 'search_users' && !email) return { error: 'search_users requires an exact email address.' };
 if (named === 'search_users') return { tool: named, input: { email } };
 if (named === 'search_logs') {
  if (email || /\b(?:this|that|specific|selected) user\b/i.test(text)) return { error: 'search_logs cannot filter by user; use an exact-email user lookup for user-specific logs.' };
  const type = text.match(/\b(?:limit_wc|limit_sul|limit_mu|fp|fu|f)\b/i)?.[0]?.toLowerCase();
  return { tool: named, input: type ? { event_type: type } : {} };
 }
 if (named && noArgs.has(named)) return { tool: named, input: {} };
 if (named && idArgs[named]) {
  const key = idArgs[named];
  const match = text.match(new RegExp('\\b' + key + '\\s*[:=]\\s*["\\\']?([^\\s"\\\',}]+)', 'i'));
  const id = match?.[1] ?? (key === 'user_id' ? text.match(/\b(?:auth0|google-oauth2|github|facebook|waad)\|[A-Za-z0-9_.@|-]+/i)?.[0] : undefined);
  return id ? { tool: named, input: { [key]: id } } : { error: `${named} requires ${key}; include ${key}: followed by the identifier.` };
 }
 if (email) return { email };
 if (/\b(failed|failure)\b/i.test(text) && /\b(log|logs|event|events|attempts?)\b/i.test(text)) return { tool: 'search_logs', input: { event_type: 'f' } };
 return {};
}

function validateResult(tool: string, value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed tool response.');
 const r = value as Record<string, unknown>;
 if (r.success === false) throw new Error(typeof r.error_code === 'string' ? r.error_code : 'Tool reported an error.');
 if (r.success !== true) throw new Error('Malformed tool response: missing success status.');
 const key = listKeys[tool];
 if (key && (!Array.isArray(r[key]) || !Number.isInteger(r.count) || r.count !== (r[key] as unknown[]).length || !(r[key] as unknown[]).every(v => v && typeof v === 'object' && !Array.isArray(v)))) throw new Error('Malformed tool response: invalid result page.');
 if (tool === 'search_users' && !(r.users as Record<string, unknown>[]).every(item => typeof item.user_id === 'string' && item.user_id.length > 0 && typeof item.email === 'string')) throw new Error('Malformed user search response.');
 if ((tool === 'get_user_logs' || tool === 'search_logs') && !(r.events as Record<string, unknown>[]).every(event => ['log_id', 'date', 'type', 'description'].every(key => key in event && (event[key] === null || typeof event[key] === 'string')))) throw new Error('Malformed event response.');
 if (tool === 'get_user' && (typeof r.user_id !== 'string' || typeof r.blocked !== 'boolean' || !Array.isArray(r.connections))) throw new Error('Malformed user profile.');
 if (tool === 'get_user_blocks' && (typeof r.has_blocks !== 'boolean' || !Array.isArray(r.blocks) || !Number.isInteger(r.block_count) || r.block_count !== r.blocks.length || r.has_blocks !== (r.blocks.length > 0))) throw new Error('Malformed block response.');
 if ((tool === 'get_brute_force_settings' || tool === 'get_ip_throttling_settings') && typeof r.enabled !== 'boolean') throw new Error('Malformed security settings.');
 return r;
}

export async function invokeRead(client: ToolClient, token: string, tool: string, input: Record<string, unknown>, timeoutMs = 30000): Promise<Evidence> {
 if (!allowedTools.has(tool)) return { tool, status: 'error', error: 'Operation is not available in the read-only console.' };
 let timer: ReturnType<typeof setTimeout> | undefined;
 try {
  const response = await Promise.race([client.tool({ token, tool, nodeId: 'tool_auth0_1', input }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs); })]);
  if (response && typeof response === 'object' && (response as Record<string, unknown>).success === false) {
   const r = response as Record<string, unknown>;
   const retry = typeof r.retry_after_seconds === 'number' ? ` Retry after ${r.retry_after_seconds} seconds.` : '';
   const code = typeof r.error_code === 'string' && /^[A-Z_]{1,40}$/.test(r.error_code) ? r.error_code : 'Tool request failed.';
   return { tool, input, status: 'error', error: `${code}${retry}` };
  }
  const data = validateResult(tool, response);
  return { tool, input, status: 'success', data };
 } catch (error) {
  const message = error instanceof Error ? error.message : '';
  const safe = message === 'TIMEOUT' ? 'The request timed out. The remote request may still be running.' : message.startsWith('Malformed ') ? message : 'Tool request failed. Check the engine connection and integration configuration.';
  return { tool, input, status: 'error', error: safe };
 } finally { if (timer) clearTimeout(timer); }
}

/** Each call starts with an empty evidence list; prior chat messages never supply results. */
export async function retrieveEvidence(client: ToolClient, token: string, plan: LookupPlan): Promise<Evidence[]> {
 if (plan.error) return [{ tool: plan.tool ?? 'request', status: 'error', error: plan.error }];
 if (plan.tool) return [await invokeRead(client, token, plan.tool, plan.input ?? {})];
 if (!plan.email) return [];
 const search = await invokeRead(client, token, 'search_users', { email: plan.email });
 const evidence = [search];
 if (search.status !== 'success') return evidence;
 const users = search.data?.users as Record<string, unknown>[];
 if (users.length !== 1 || typeof users[0].user_id !== 'string' || !users[0].user_id || String(users[0].email).toLowerCase() !== plan.email.toLowerCase()) return evidence;
 const input = { user_id: users[0].user_id };
 const profile = await invokeRead(client, token, 'get_user', input);
 evidence.push(profile);
 if (profile.status !== 'success' || profile.data?.user_id !== input.user_id) return evidence;
 for (const tool of ['get_user_logs', 'get_user_blocks']) evidence.push(await invokeRead(client, token, tool, input));
 return evidence;
}

/** The agent's narrative is never evidence. Guard refusals are errors, not answers. */
export function interpretAgentOutput(result: PIPELINE_RESULT): { text?: string; error?: string } {
 const answers = extractAnswers(result);
 if (!answers.length) return { error: 'The agent returned no readable answer.' };
 const text = answers.join('\n\n');
 if (/require_tool_call|without invoking any tool|narrated or fabricated tool chain/i.test(text)) return { error: 'The agent did not perform the required tool call. Its answer was discarded; retry the lookup.' };
 if (/\b(?:root cause (?:is|was)|(?:issue|problem) (?:is|has been) (?:resolved|fixed)|investigation (?:is )?complete|definitely caused|rules? out)\b/i.test(text)) return { error: 'The agent asserted a diagnosis or completion that was not established. Its explanation was discarded; review the tool responses.' };
 return { text };
}
