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
