"""Offline Auth0 fixture. This module never performs network I/O."""

import os
from urllib.parse import unquote, urlsplit

_scope_failed = False
_event_counts = {}


class RequestException(Exception):
    pass


class exceptions:
    RequestException = RequestException


class Response:
    status_code = 200
    headers = {}
    content = b'fixture'

    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


def post(url, **kwargs):
    if (
        url != 'https://loginlens-fixture.auth0.com/oauth/token'
        or kwargs.get('json', {}).get('client_id') != 'fixture-client'
    ):
        raise RequestException('Unexpected fixture request')
    return Response({'access_token': 'fixture-token', 'expires_in': 3600})


def request(method, url, **kwargs):
    global _scope_failed
    parsed = urlsplit(url)
    if method != 'GET' or parsed.netloc != 'loginlens-fixture.auth0.com' or parsed.scheme != 'https':
        raise RequestException('Unexpected fixture request')
    route = unquote(parsed.path)
    if route == '/api/v2/logs' and os.environ.get('ROCKETRIDE_MOCK_PARTIAL_HISTORY') == '1':
        if kwargs.get('params', {}).get('page') == 0:
            return Response(
                [
                    {
                        'log_id': f'history-event-{index}',
                        'date': '2026-11-19T19:59:00.000Z',
                        'type': 'fp',
                        'ip': '192.0.2.10',
                        'user_id': f'auth0|fixture-{index % 4}',
                    }
                    for index in range(100)
                ]
            )
        result = Response({'error': 'too_many_requests'})
        result.status_code = 429
        result.headers = {'Retry-After': '47'}
        return result
    if route == '/api/v2/logs/fixture-event-18' and os.environ.get('ROCKETRIDE_MOCK_RATE_AFTER_TWO') == '1':
        _event_counts[route] = _event_counts.get(route, 0) + 1
        if _event_counts[route] > 2:
            result = Response({'error': 'too_many_requests'})
            result.status_code = 429
            result.headers = {'Retry-After': '31'}
            return result
    if (
        route == '/api/v2/logs/fixture-event-0'
        and os.environ.get('ROCKETRIDE_MOCK_SCOPE_ONCE') == '1'
        and not _scope_failed
    ):
        _scope_failed = True
        result = Response({'error': 'insufficient_scope'})
        result.status_code = 403
        return result
    if route.startswith('/api/v2/logs/fixture-event-'):
        index = int(route.rsplit('-', 1)[-1])
        source = '192.0.2.10' if index < 8 else f'192.0.2.{11 + (index - 8) // 2}'
        return Response(
            {
                'log_id': f'fixture-event-{index}',
                'date': f'2026-11-19T19:59:{50 - index:02}.000Z',
                'type': 'fp',
                'ip': source,
                'user_id': f'auth0|fixture-{index // 2}',
                'security_context': {'ja3': '0' * 32, 'ja4': 't13d1516h2_8daaf6152771_b186095e22b6'},
            }
        )
    if route.startswith('/api/v2/users/') and route.endswith('/logs'):
        user = route.removeprefix('/api/v2/users/').removesuffix('/logs')
        index = int(user.rsplit('-', 1)[-1])
        return Response(
            [
                {'log_id': f'fixture-event-{i}', 'date': f'2026-11-19T19:59:{50 - i:02}.000Z', 'type': 'fp'}
                for i in (index * 2, index * 2 + 1)
            ]
        )
    if route.startswith('/api/v2/users/'):
        user = route.removeprefix('/api/v2/users/')
        blocked = os.environ.get('ROCKETRIDE_MOCK_BLOCKED_ACCOUNT') == '1' and user == 'auth0|fixture-0'
        return Response({'user_id': user, 'blocked': blocked, 'identities': []})
    if route.startswith('/api/v2/user-blocks/'):
        return Response({'blocked_for': []})
    if route == '/api/v2/network-acls':
        return Response(
            {
                'total': 1,
                'network_acls': [
                    {'active': True, 'rule': {'scope': 'authentication', 'match': {'ipv4_cidrs': ['192.0.2.0/24']}}}
                ],
            }
        )
    if route in (
        '/api/v2/attack-protection/brute-force-protection',
        '/api/v2/attack-protection/suspicious-ip-throttling',
    ):
        return Response({'enabled': True, 'shields': [], 'allowlist': ['192.0.2.0/24']})
    raise RequestException('Unexpected fixture route')
