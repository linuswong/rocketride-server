const limits = { takeaway: 180, nextStep: 140 };
export type AnalysisResponse = { takeaway: string; nextStep: string | null; references?: string[] };

export const analysisResponseInstructions = 'Return one JSON object using this shape: {"takeaway":"Main finding.","nextStep":null,"references":["E1"]}. No Markdown. '
	+ '"takeaway" is one plain-language sentence of at most ' + limits.takeaway + ' characters. '
	+ 'Lead with the result that most affects what support should do. Include an important recovery signal if observed. '
	+ '"nextStep" is one actionable sentence of at most ' + limits.nextStep + ' characters, or null if no follow-up is supported. '
	+ 'Cite one to four references from successful supplied checks only; never invent a reference. '
	+ 'Treat failed or absent checks as unknown, returned pages as incomplete, and successful Auth0 events as insufficient to prove application access. '
	+ 'Omit account identifiers, tool names, event IDs, raw timestamps, routine details, and speculative causes.';

export function parseAnalysisResponse(text: string): AnalysisResponse | undefined {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
	let value: unknown;
	try { value = JSON.parse(fenced?.[1] ?? trimmed); } catch { return undefined; }
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const response = value as Record<string, unknown>;
	if (Object.keys(response).some(key => key !== 'takeaway' && key !== 'nextStep' && key !== 'references')) return undefined;
	const takeaway = typeof response.takeaway === 'string' ? response.takeaway.trim() : undefined;
	const nextStep = typeof response.nextStep === 'string' ? response.nextStep.trim() : response.nextStep;
	if (!takeaway || takeaway.length > limits.takeaway) return undefined;
	if (nextStep != null && (typeof nextStep !== 'string' || nextStep.length > limits.nextStep)) return undefined;
	const references = response.references;
	if (references !== undefined && (!Array.isArray(references) || references.length > 4 || !references.every(ref => typeof ref === 'string' && /^E[1-9]\d{0,2}$/.test(ref)) || new Set(references).size !== references.length)) return undefined;
	return { takeaway, nextStep: nextStep || null, ...(references !== undefined ? {references} : {}) };
}

/** A reference proves only that a successful check was supplied, not that the prose follows from it. */
export function parseAccountAnalysisResponse(text: string, allowed: ReadonlySet<string>): AnalysisResponse | undefined {
	const analysis = parseAnalysisResponse(text);
	if (!analysis?.references?.length || analysis.references.some(ref => !allowed.has(ref))) return undefined;
	return analysis;
}
