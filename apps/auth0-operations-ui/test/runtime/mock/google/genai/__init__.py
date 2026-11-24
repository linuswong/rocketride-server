"""Offline-only Gemini transport for the bounded RocketRide runtime test."""

import json
import os
from pathlib import Path
import time
import uuid


def _record(kind, **fields):
    directory = Path(os.environ['ROCKETRIDE_MOCK_AUDIT_DIR'])
    event = {'kind': kind, **fields}
    (directory / (uuid.uuid4().hex + '.json')).write_text(json.dumps(event), encoding='utf-8')


class _Models:
    def generate_content(self, model, contents, **kwargs):
        text = str(contents)
        mode = (
            'validation'
            if text == 'Hi'
            else 'error'
            if 'MOCK_ERROR' in text
            else 'invalid'
            if 'MOCK_INVALID' in text
            else 'slow'
            if 'MOCK_SLOW' in text
            else 'valid'
        )
        _record('attempt', mode=mode)
        if mode == 'error':
            raise ConnectionError('mock transport failure')
        if mode == 'slow':
            time.sleep(1)
        if mode == 'invalid':
            answer = '{"steps":['
        elif 'MOCK_AGENT_AUTH0_1' in text:
            answer = json.dumps({'decision': 'check', 'candidate': 'event-9'})
        elif 'MOCK_AGENT_AUTH0_2' in text:
            answer = json.dumps({'decision': 'check', 'candidate': 'event-10'})
        elif 'MOCK_AGENT_AUTH0_CONCLUDE' in text:
            answer = json.dumps(
                {
                    'decision': 'conclude',
                    'action': 'After verifying the account owner, have an authorized administrator remove the confirmed administrative block.',
                    'reason': 'A checked account is administratively blocked and has repeated failures.',
                    'uncertainty': 'The block may not explain every failure.',
                    'references': ['source-accounts', 'E1'],
                }
            )
        elif 'MOCK_AGENT_HALLUCINATED_BLOCK' in text:
            answer = json.dumps(
                {
                    'decision': 'conclude',
                    'action': 'Remove the administrative account block.',
                    'reason': 'An account is blocked.',
                    'uncertainty': 'The cause is uncertain.',
                    'references': ['source-accounts'],
                }
            )
        elif 'MOCK_AGENT_NO_FIX' in text:
            answer = json.dumps(
                {
                    'decision': 'conclude',
                    'action': 'The evidence cannot determine a fix.',
                    'reason': 'The checked account has no verified block.',
                    'uncertainty': 'A cause has not been established.',
                    'references': ['source-accounts'],
                }
            )
        elif 'MOCK_AGENT_RATE_CHECK' in text:
            answer = json.dumps({'decision': 'check', 'candidate': 'source-2'})
        elif 'MOCK_AGENT_RATE_CONCLUDE' in text:
            answer = json.dumps(
                {
                    'decision': 'conclude',
                    'action': 'Wait for the Auth0 rate limit to clear, then rerun the investigation.',
                    'reason': 'The source comparison was rate limited.',
                    'uncertainty': 'The cause remains unknown.',
                    'references': ['source-analysis'],
                }
            )
        elif 'MOCK_AGENT_CHECK1' in text:
            answer = json.dumps({'decision': 'check', 'candidate': 'event-5'})
        elif 'MOCK_AGENT_CHECK2' in text:
            answer = json.dumps({'decision': 'check', 'candidate': 'event-6'})
        elif 'MOCK_AGENT_CONCLUDE' in text:
            answer = json.dumps(
                {
                    'decision': 'conclude',
                    'action': 'Do not reset credentials without further evidence.',
                    'reason': 'Two selected events were checked.',
                    'uncertainty': 'The cause is not established.',
                    'references': ['followup-1', 'followup-2'],
                }
            )
        else:
            answer = json.dumps(
                {
                    'steps': [
                        {
                            'id': 'event',
                            'tool': 'get_log_event',
                            'ref': 'E1',
                            'purpose': 'Verify event type and time',
                            'expected': 'Event type and time',
                            'depends': [],
                        }
                    ]
                }
            )
        return type('MockResponse', (), {'text': answer, 'usage_metadata': None})()


class Client:
    def __init__(self, api_key=None, **kwargs):
        if api_key != 'LOGINLENS_MOCK_ONLY':
            raise ValueError('This mock accepts only its fixed test credential')
        options = kwargs.get('http_options') or {}
        _record('client', sdk_attempts=(options.get('retry_options') or {}).get('attempts'))
        self.models = _Models()
