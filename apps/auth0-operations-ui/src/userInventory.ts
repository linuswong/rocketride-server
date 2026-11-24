import { invokeRead, type ToolClient } from './operations.ts';

const PAGE_SIZE = 50;
// Auth0 offset pagination is bounded; never label a capped scan a complete inventory.
const MAX_PAGES = 20;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export type UserInventory = {
 status: 'complete' | 'partial' | 'error';
 total: number;
 active: number;
 inactive: number;
 unknown: number;
 reason?: string;
 checkedAt: number;
};

/** Fetch an in-memory, bounded inventory. No identities are retained in the result. */
export async function loadUserInventory(client: ToolClient, token: string, now = Date.now()): Promise<UserInventory> {
 const result: UserInventory = { status: 'partial', total: 0, active: 0, inactive: 0, unknown: 0, checkedAt: now };
 const seen = new Set<string>();
 for (let page = 0; page < MAX_PAGES; page++) {
  const response = await invokeRead(client, token, 'list_users', { page, limit: PAGE_SIZE });
  if (response.status !== 'success' || !Array.isArray(response.data?.users)) {
   result.status = page === 0 ? 'error' : 'partial';
   result.reason = response.error ?? 'User inventory could not be loaded.';
   return result;
  }
  const users = response.data.users as Record<string, unknown>[];
  if (users.length > PAGE_SIZE) { result.status = page === 0 ? 'error' : 'partial'; result.reason = 'Invalid inventory page.'; return result; }
  for (const user of users) {
   if (typeof user.user_id !== 'string' || !user.user_id || seen.has(user.user_id)) {
    result.reason = 'Inventory changed or returned an invalid user; reload to try again.';
    return result;
   }
   seen.add(user.user_id);
   result.total++;
   const raw = user.last_login;
   const time = typeof raw === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? Date.parse(raw) : NaN;
   if (!Number.isFinite(time) || time > now) result.unknown++;
   else if (time >= now - THIRTY_DAYS) result.active++;
   else result.inactive++;
  }
  if (users.length < PAGE_SIZE) { result.status = 'complete'; return result; }
 }
 result.reason = 'Inventory exceeded the 1,000-user scan limit.';
 return result;
}
