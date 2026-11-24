"""Read-only Jira Service Management request tools."""

import json

from ai.common.utils import normalize_tool_input
from rocketlib import IInstanceBase, tool_function

from .jira_client import JiraError

_TEXT = {'type': ['string', 'null']}
_REQUEST = {
    'type': 'object',
    'properties': {
        'issue_key': {'type': 'string'},
        'status': _TEXT,
        'created': _TEXT,
        'service_desk_id': _TEXT,
        'request_type_id': _TEXT,
        'summary': _TEXT,
    },
    'required': ['issue_key', 'status', 'created', 'service_desk_id', 'request_type_id'],
    'additionalProperties': False,
}
_ENVELOPE = {
    'success': {'type': 'boolean'},
    'error_code': {'type': 'string'},
    'error': {'type': 'string'},
    'retryable': {'type': 'boolean'},
    'retry_after_seconds': {'type': 'integer', 'minimum': 0, 'maximum': 86400},
}


def _error_response(exc):
    result = {'success': False, 'error_code': exc.code, 'error': str(exc)}
    if exc.retry_after_seconds is not None:
        result.update({'retryable': True, 'retry_after_seconds': exc.retry_after_seconds})
    return result


def _inputs(args, name):
    if not isinstance(args, (dict, str)):
        method = getattr(args, 'model_dump', None) or getattr(args, 'dict', None)
        if not callable(method):
            raise JiraError('INVALID_INPUT', 'Tool input must be an object.')
        args = method()
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            raise JiraError('INVALID_INPUT', 'Tool input must be an object.') from None
    if not isinstance(args, dict) or ('input' in args and not isinstance(args['input'], dict)):
        raise JiraError('INVALID_INPUT', 'Tool input must be an object.')
    return normalize_tool_input(args, tool_name=name)


class IInstance(IInstanceBase):
    def _client(self):
        client = getattr(self.IGlobal, 'client', None)
        if client is None:
            raise JiraError('CLIENT_CLOSED', 'Jira client is unavailable.')
        return client

    @tool_function(
        input_schema={
            'type': 'object',
            'required': ['issue_key'],
            'properties': {
                'issue_key': {'type': 'string', 'maxLength': 70},
                'include_summary': {'type': 'boolean', 'default': False},
            },
            'additionalProperties': False,
        },
        output_schema={'type': 'object', 'properties': {**_ENVELOPE, 'request': _REQUEST}, 'required': ['success']},
        description='Read a Jira Service Management Cloud customer request by issue key or numeric ID. Optionally include its untrusted summary.',
    )
    def get_request(self, args):
        try:
            value = _inputs(args, 'get_request')
            if 'issue_key' not in value or set(value) - {'issue_key', 'include_summary'}:
                raise JiraError('INVALID_INPUT', 'Only issue_key and include_summary are accepted.')
            include_summary = value.get('include_summary', False)
            if type(include_summary) is not bool:
                raise JiraError('INVALID_INPUT', 'include_summary must be a boolean.')
            return {'success': True, 'request': self._client().get_request(value['issue_key'], include_summary)}
        except JiraError as exc:
            return _error_response(exc)
        except (TypeError, ValueError, KeyError):
            return {'success': False, 'error_code': 'INVALID_INPUT', 'error': 'Invalid request input.'}

    @tool_function(
        input_schema={
            'type': 'object',
            'properties': {
                'start': {'type': 'integer', 'minimum': 0, 'maximum': 1000},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
            },
            'additionalProperties': False,
        },
        output_schema={
            'type': 'object',
            'properties': {
                **_ENVELOPE,
                'requests': {'type': 'array', 'items': _REQUEST},
                'start': {'type': 'integer'},
                'limit': {'type': 'integer'},
                'size': {'type': 'integer'},
                'last_page': {'type': 'boolean'},
            },
            'required': ['success'],
        },
        description='List one page of Jira Service Management Cloud requests visible to the configured account.',
    )
    def list_requests(self, args):
        try:
            value = _inputs(args, 'list_requests')
            if set(value) - {'start', 'limit'}:
                raise JiraError('INVALID_INPUT', 'Unsupported request input.')
            return {'success': True, **self._client().list_requests(value.get('start', 0), value.get('limit', 20))}
        except JiraError as exc:
            return _error_response(exc)
        except (TypeError, ValueError):
            return {'success': False, 'error_code': 'INVALID_INPUT', 'error': 'Invalid request input.'}
