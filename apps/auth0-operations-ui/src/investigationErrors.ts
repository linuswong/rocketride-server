// Only fixed categories may leave the browser; provider error text remains local.
const errorCodes = ['MISSING_SCOPE','FEATURE_UNAVAILABLE','AUTHENTICATION_FAILED','RATE_LIMITED','AUTH0_UNAVAILABLE','API_ERROR','TIMEOUT'] as const;

export function safeError(message:unknown): string | undefined {
 if (typeof message !== 'string') return;
 if (message === 'The request timed out. The remote request may still be running.') return 'TIMEOUT';
 return errorCodes.find(code=>message === code || message.startsWith(`${code} Retry after `));
}

export function errorCounts(messages:unknown[]): Record<string,number> {
 const counts:Record<string,number>={};
 for (const message of messages) { const code=safeError(message); if (code) counts[code]=(counts[code] ?? 0)+1; }
 return counts;
}
