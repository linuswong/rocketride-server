"""Offline-only replacement for requests: unexpected URLs fail closed."""

import json
from . import auth as auth

__version__ = '2.34.2'


class RequestException(Exception):
    pass


class Response:
    def __init__(self, data, status=200, headers=None):
        self.data = json.dumps(data).encode()
        self.status_code = status
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def iter_content(self, chunk_size):
        yield self.data


class Session:
    def __init__(self):
        self.auth = None
        self.headers = {}

    def close(self):
        pass

    def get(self, url, *, params=None, timeout=None, allow_redirects=None, stream=None):
        if timeout != (5, 20) or allow_redirects is not False or stream is not True:
            raise RequestException('Unexpected options')
        cloud_id = '11223344-a1b2-3b33-c444-def123456789'
        root = 'https://api.atlassian.com/ex/jira/' + cloud_id + '/rest/servicedeskapi/request'
        if url == 'https://api.atlassian.com/oauth/token/accessible-resources':
            return Response(
                [{'id': cloud_id, 'url': 'https://fixture.atlassian.net', 'scopes': ['read:servicedesk-request']}]
            )
        if url == root + '/SUP-1':
            return Response(
                {
                    'issueKey': 'SUP-1',
                    'summary': 'Cannot sign in',
                    'currentStatus': {'status': 'Open'},
                    'requestFieldValues': [{'fieldId': 'description', 'value': 'private-description'}],
                }
            )
        if url == root + '/SUP-3':
            return Response({'issueKey': 'SUP-4', 'summary': 'private-mismatch'})
        if url == root and params == {'start': 20, 'limit': 20}:
            return Response(
                {
                    'values': [{'issueKey': 'SUP-5', 'summary': 'private-pagination'}],
                    'start': 0,
                    'limit': 20,
                    'size': 1,
                    'isLastPage': True,
                }
            )
        if url == root + '/SUP-2':
            return Response({'private': 'do not expose'}, status=429, headers={'Retry-After': '15'})
        if url == root and params == {'start': 0, 'limit': 20}:
            return Response(
                {
                    'values': [{'issueKey': 'SUP-1', 'currentStatus': {'status': 'Open'}}],
                    'start': 0,
                    'limit': 20,
                    'size': 1,
                    'isLastPage': True,
                }
            )
        raise RequestException('Unexpected offline fixture request')
