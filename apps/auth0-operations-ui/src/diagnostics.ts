/** Categorize failures without exposing exception text, credentials, or event identifiers. */
export function safeFailure(error: unknown, stage: string): string {
 const message = error instanceof Error ? error.message : '';
 const name = error instanceof Error ? error.name : '';
 const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
 const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : NaN;
 if (/timed out|TIMEOUT/i.test(message) || name === 'TimeoutError' || code === 'ETIMEDOUT') return `${stage}: timeout; remote work may still be running.`;
 if (status === 429 || code === 'RATE_LIMITED') return `${stage}: rate limited.`;
 if (status === 401 || status === 403 || ['UNAUTHORIZED', 'FORBIDDEN'].includes(code)) return `${stage}: access denied or credentials rejected.`;
 if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|NETWORK_ERROR/.test(code) || name === 'NetworkError' || name === 'TypeError') return `${stage}: connection failure.`;
 return `${stage}: request failed (cause unavailable).`;
}
