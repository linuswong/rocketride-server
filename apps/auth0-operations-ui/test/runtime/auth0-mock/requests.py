"""Offline Auth0 fixture. This module never performs network I/O."""

import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote, urlsplit

_scope_failed = False
_event_counts = {}
_monitor_time = None


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
    global _scope_failed, _monitor_time
    parsed = urlsplit(url)
    if method != 'GET' or parsed.netloc != 'loginlens-fixture.auth0.com' or parsed.scheme != 'https':
        raise RequestException('Unexpected fixture request')
    route = unquote(parsed.path)
    if os.environ.get('ROCKETRIDE_MOCK_SUBMITTED_EMAIL') == '1':
        if route == '/api/v2/users-by-email':
            if kwargs.get('params') != {'email': 'person@example.com'}:
                raise RequestException('Unexpected fixture query')
            return Response([{'user_id': 'auth0|fixture-0', 'email': 'person@example.com'}])
        if route == '/api/v2/users':
            params = kwargs.get('params', {})
            if 'q' not in params and params.get('per_page') in (1, 2):
                return Response([{'user_id': 'auth0|fixture-0'}, {'user_id': 'auth0|fixture-1'}])
            if params.get('q') != 'email:"person@example.com"':
                raise RequestException('Unexpected fixture query')
            return Response([{'user_id': 'auth0|fixture-0', 'email': 'person@example.com'}])
        if route == '/api/v2/logs/shell-failure':
            if _monitor_time is None:
                raise RequestException('Monitoring fixture has not been loaded')
            return Response(
                {'log_id': 'shell-failure', 'date': _monitor_time, 'type': 'fu', 'user_name': 'person@example.com'}
            )
        if route == '/api/v2/clients' and kwargs.get('params', {}).get('per_page') in (1, 2):
            return Response([{'client_id': 'fixture-0'}, {'client_id': 'fixture-1'}])
        if route == '/api/v2/logs':
            params = kwargs.get('params', {})
            history = re.fullmatch(
                r'date:\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) TO (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]',
                str(params.get('q', '')),
            )
            if history and params.get('per_page') == 100 and params.get('page') == 0:
                end = datetime.fromisoformat(history.group(2).replace('Z', '+00:00'))
                _monitor_time = (
                    (end - timedelta(seconds=1))
                    .astimezone(timezone.utc)
                    .isoformat(timespec='milliseconds')
                    .replace('+00:00', 'Z')
                )
                return Response(
                    [
                        {
                            'log_id': 'shell-failure',
                            'date': _monitor_time,
                            'type': 'fu',
                            'user_name': 'person@example.com',
                        }
                    ]
                )
            if params.get('q') == 'type:fp' and params.get('per_page') in (1, 2):
                return Response(
                    [
                        {'log_id': 'tenant-1', 'date': '2026-01-01T12:00:00Z', 'type': 'fp'},
                        {'log_id': 'tenant-2', 'date': '2026-01-01T12:01:00Z', 'type': 'fp'},
                    ]
                )
            if (
                params.get('q')
                != 'user_name:"person@example.com" AND date:[2026-01-01T11:00:00.000Z TO 2026-01-01T13:00:00.000Z]'
            ):
                raise RequestException('Unexpected fixture query')
            if params.get('page') == 1:
                return Response(
                    [
                        {
                            'log_id': 'submitted-older',
                            'date': '2026-01-01T11:59:00.000Z',
                            'type': 'fp',
                            'user_name': 'person@example.com',
                        }
                    ]
                )
            return Response(
                [
                    {
                        'log_id': 'submitted-1',
                        'date': '2026-01-01T12:00:00.000Z',
                        'type': 'fu',
                        'user_name': 'person@example.com',
                        'ip': '192.0.2.1',
                    },
                    {
                        'log_id': 'other-1',
                        'date': '2026-01-01T12:01:00.000Z',
                        'type': 'fu',
                        'user_name': 'other@example.com',
                    },
                ]
            )
        if route == '/api/v2/user-blocks':
            if kwargs.get('params') != {'identifier': 'person@example.com', 'consider_brute_force_enablement': 'true'}:
                raise RequestException('Unexpected fixture parameters')
            return Response({'blocked_for': [{'identifier': 'person@example.com', 'ip': '192.0.2.1'}]})
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
        profile = {'user_id': user, 'blocked': blocked, 'identities': []}
        if os.environ.get('ROCKETRIDE_MOCK_SUBMITTED_EMAIL') == '1' and user == 'auth0|fixture-0':
            profile['email'] = 'person@example.com'
        return Response(profile)
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
