// Offline evaluator for representative mocked responses. This does not measure Gemini quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findings } from '../src/lensPlan.ts';

const plan = [
	{id:'event',tool:'get_log_event',purpose:'Verify the event',depends:[],ref:'E1'},
	{id:'account',tool:'get_brute_force_settings',purpose:'Inspect account protection',depends:[]},
	{id:'network',tool:'get_ip_throttling_settings',purpose:'Inspect throttling',depends:[]},
];
const response = (reference, cause, uncertainty, next) => ({
	reference, possibleCause:cause, uncertainty, nextStep:next,
	possibleRemediation:'Review possible remediation after verifying the evidence.',
});
const scenarios = [
	{
		name:'failed login with unknown cause',
		results:{event:{state:'success',detail:'Wrong password',facts:{category:'Wrong password'}}},
		good:response('event','A stale password may explain the failure.','One event cannot establish intent.','Compare the event time with the report.'),
		bad:response('event','A confirmed attack compromised the account.','The attacker is known.','Block the attacker.'),
		required:/may|could/i, forbidden:/confirmed attack|compromised|attacker/i,
	},
	{
		name:'conflicting protection settings',
		results:{account:{state:'success',detail:'Protection enabled',facts:{enabled:true}},network:{state:'success',detail:'Protection disabled',facts:{enabled:false}}},
		good:response('account','The settings differ; either may affect retries.','Current settings do not establish what happened.','Review both settings against policy.'),
		bad:response('account','All protections are disabled.','The outcome is certain.','Enable everything.'),
		required:/differ|both/i, forbidden:/all protections are disabled|outcome is certain/i,
	},
	{
		name:'partial evidence after failed tool call',
		results:{event:{state:'success',detail:'Wrong password',facts:{category:'Wrong password'}},account:{state:'failed',detail:'Unavailable'}},
		good:response('event','Incorrect credentials are possible.','Account protection evidence is unavailable.','Review the missing protection check.'),
		bad:response('event','Protection was disabled and caused the failure.','No evidence is missing.','Reconfigure protection.'),
		required:/unavailable|missing/i, forbidden:/protection was disabled|no evidence is missing/i,
	},
	{
		name:'event facts and unknown account',
		results:{event:{state:'success',detail:'Unknown user',facts:{category:'Unknown user',reference:'E1'}}},
		good:response('event','An invalid username is possible.','The event does not establish an account identity.','Verify the event type and reported time.'),
		bad:response('event','The known employee alice@example.com was compromised.','The account identity is confirmed.','Reset the account.'),
		required:/unknown|identity|username/i, forbidden:/alice@example\.com|compromised|identity is confirmed/i,
	},
];

function evaluateQuality(finding, scenario) {
	const text=[finding.possibleCause,finding.uncertainty,finding.nextStep,finding.possibleRemediation].join(' ');
	return {
		recognizesRequiredEvidence:scenario.required.test(text),
		avoidsUnsupportedClaims:!scenario.forbidden.test(text),
		hasVerificationStep:/review|compare|verify/i.test(finding.nextStep),
	};
}

for (const scenario of scenarios) {
	test(`offline findings quality rubric: ${scenario.name}`, async () => {
		const model = finding => async()=>JSON.stringify({findings:[finding]});
		const [good]=await findings(plan,scenario.results,model(scenario.good));
		assert.deepEqual(evaluateQuality(good,scenario),{
			recognizesRequiredEvidence:true, avoidsUnsupportedClaims:true, hasVerificationStep:true,
		});
		// The bad response has a valid schema and successful citation. Quality must be assessed separately.
		const [bad]=await findings(plan,scenario.results,model(scenario.bad));
		assert.equal(evaluateQuality(bad,scenario).avoidsUnsupportedClaims,false);
		await assert.rejects(findings(plan,scenario.results,async()=>'{invalid'));
	});
}


test('displayed event references resolve only to a unique successful graph step', async () => {
 const result = {event:{state:'success',detail:'Wrong password',facts:{category:'Wrong password'}}};
 const finding = response('E1','A stale credential may explain the failure.','The cause is not established.','Compare the event with the report to verify it.');
 const model = async () => JSON.stringify({findings:[finding]});
 assert.equal((await findings(plan,result,model))[0].id,'event');
 await assert.rejects(findings([...plan,{id:'other',tool:'get_log_event',purpose:'Other event',depends:[],ref:'E1'}],result,model));
 await assert.rejects(findings(plan,{event:{state:'failed',detail:'Unavailable'},account:{state:'success',detail:'Enabled'}},model));
});
