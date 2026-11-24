import React from 'react';
import { parseAnalysisResponse } from './analysisResponse';

export function AnalysisDetails({ text, onReference }: { text: string; onReference?: (reference: string) => void }) {
	const analysis = parseAnalysisResponse(text);
	if (!analysis) return <div className="diagnosis-text">{text}</div>;
	return <div className="diagnosis-text">
		{analysis.takeaway}
		{analysis.nextStep && <p><strong>Next step</strong> {analysis.nextStep}</p>}
		{!!analysis.references?.length && <p><strong>Referenced checks</strong> {analysis.references.map(reference => onReference ? <button key={reference} type="button" onClick={() => onReference(reference)}>{reference}</button> : <span key={reference}>{reference} </span>)}</p>}
	</div>;
}
