import React from 'react';
import { parseAnalysisResponse } from './analysisResponse';

export function AnalysisDetails({ text }: { text: string }) {
	const analysis = parseAnalysisResponse(text);
	if (!analysis) return <div className="diagnosis-text">{text}</div>;
	return <div className="diagnosis-text">
		{analysis.takeaway}
		{analysis.nextStep && <p><strong>Next step</strong> {analysis.nextStep}</p>}
	</div>;
}
