const limits = { takeaway: 180, nextStep: 140 };
type AnalysisResponse = { takeaway: string; nextStep: string | null };

export const analysisResponseInstructions = 'Return one JSON object using this shape: {"takeaway":"Main finding.","nextStep":null}. No Markdown. '
	+ '"takeaway" is one plain-language sentence of at most ' + limits.takeaway + ' characters. '
	+ 'Lead with the result that most affects what support should do. Include an important recovery signal if observed. '
	+ '"nextStep" is one actionable sentence of at most ' + limits.nextStep + ' characters, or null if no follow-up is supported. '
	+ 'Omit account identifiers, tool names, event IDs, raw timestamps, routine details, and speculative causes.';

export function parseAnalysisResponse(text: string): AnalysisResponse | undefined {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
	let value: unknown;
	try { value = JSON.parse(fenced?.[1] ?? trimmed); } catch { return undefined; }
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const response = value as Record<string, unknown>;
	if (Object.keys(response).some(key => key !== 'takeaway' && key !== 'nextStep')) return undefined;
	const takeaway = typeof response.takeaway === 'string' ? response.takeaway.trim() : undefined;
	const nextStep = typeof response.nextStep === 'string' ? response.nextStep.trim() : response.nextStep;
	if (!takeaway || takeaway.length > limits.takeaway) return undefined;
	if (nextStep != null && (typeof nextStep !== 'string' || nextStep.length > limits.nextStep)) return undefined;
	return { takeaway, nextStep: nextStep || null };
}
