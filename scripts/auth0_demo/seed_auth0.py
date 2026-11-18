#!/usr/bin/env python3
"""Standalone Auth0 development-tenant seeder. Uses only the standard library."""

import argparse
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

HERE = Path(__file__).resolve().parent
CONNECTION = 'Username-Password-Authentication'
MARKER = 'rocketride-auth0-demo-v1'


class SeederError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def load_env(path):
    """Load simple KEY=value entries without overriding the process environment."""
    if not path.exists():
        return
    try:
        lines = path.read_text(encoding='utf-8-sig').splitlines()
    except (OSError, UnicodeError):
        raise SeederError('Cannot read scripts/auth0_demo/.env as UTF-8.') from None
    for number, line in enumerate(lines, 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise SeederError(f'Invalid .env entry on line {number}; expected KEY=value.')
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r'AUTH0_DEMO_[A-Z0-9_]+', key):
            raise SeederError(f'Invalid .env key on line {number}; use an AUTH0_DEMO_ variable.')
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise SeederError(f'Unterminated .env quote on line {number}.')
            value = value[1:-1]
        os.environ.setdefault(key, value)


def config():
    domain = os.environ.get('AUTH0_DEMO_DOMAIN', '').strip().lower()
    labels = domain.split('.')
    if (
        len(domain) > 253
        or len(labels) < 3
        or labels[-2:] != ['auth0', 'com']
        or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', x) for x in labels)
    ):
        raise SeederError('AUTH0_DEMO_DOMAIN must be an Auth0-managed hostname, e.g. tenant.us.auth0.com.')
    if os.environ.get('AUTH0_DEMO_TENANT_CONFIRM', '').strip().lower() != domain:
        raise SeederError('Set AUTH0_DEMO_TENANT_CONFIRM to the exact hostname of your development tenant.')
    if os.environ.get('AUTH0_DEMO_ENVIRONMENT') != 'development':
        raise SeederError('Set AUTH0_DEMO_ENVIRONMENT=development only for a development tenant.')
    client_id = os.environ.get('AUTH0_DEMO_CLIENT_ID', '').strip()
    secret = os.environ.get('AUTH0_DEMO_CLIENT_SECRET', '').strip()
    if not client_id or not secret:
        raise SeederError('AUTH0_DEMO_CLIENT_ID and AUTH0_DEMO_CLIENT_SECRET are required.')
    return domain, client_id, secret


class Client:
    def __init__(self, domain, client_id, secret):
        self.base = 'https://' + domain
        self.opener = build_opener(NoRedirect())
        token = self.request(
            'POST',
            '/oauth/token',
            {
                'client_id': client_id,
                'client_secret': secret,
                'audience': self.base + '/api/v2/',
                'grant_type': 'client_credentials',
            },
            authenticated=False,
        )
        self.token = token['access_token']

    def request(self, method, path, payload=None, authenticated=True):
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
        if authenticated:
            headers['Authorization'] = 'Bearer ' + self.token
        for attempt in range(3):
            req = Request(self.base + path, data=data, headers=headers, method=method)
            try:
                with self.opener.open(req, timeout=20) as response:
                    body = response.read()
                return json.loads(body) if body else None
            except HTTPError as exc:
                # A 429 means Auth0 rejected the request; never replay ambiguous writes.
                if exc.code == 429 and attempt < 2:
                    try:
                        delay = float(exc.headers.get('Retry-After', ''))
                    except ValueError:
                        try:
                            delay = float(exc.headers.get('X-RateLimit-Reset', '0')) - time.time()
                        except ValueError:
                            delay = 1.0
                    if not math.isfinite(delay):
                        delay = 1.0
                    time.sleep(min(10.0, max(1.0, delay)))
                    continue
                raise SeederError(
                    f'Auth0 returned HTTP {exc.code} for {method} {path.split("?")[0]}. '
                    'Check credentials, scopes, connection and tenant settings.'
                ) from None
            except (URLError, TimeoutError, OSError):
                raise SeederError(
                    f'Network error during {method} {path.split("?")[0]}; '
                    'the outcome of a write may be unknown. Re-run to reconcile.'
                ) from None
        raise SeederError('Auth0 rate limit exceeded; wait and retry.')

    def lookup(self, email):
        return self.request('GET', '/api/v2/users-by-email?' + urlencode({'email': email}))


def owned(user, email):
    metadata = user.get('app_metadata') or {}
    return (
        user.get('email', '').lower() == email.lower()
        and metadata.get('rocketride_demo_seeder') == MARKER
        and metadata.get('rocketride_demo_email') == email
        and any(i.get('provider') == 'auth0' and i.get('connection') == CONNECTION for i in user.get('identities', []))
    )


def user_path(user):
    return '/api/v2/users/' + quote(user['user_id'], safe='')


def run(client, users, mode, password=None):
    counts = {}
    for item in users:
        email = item['email']
        try:
            matches = client.lookup(email)
            if not isinstance(matches, list):
                raise SeederError('Invalid user lookup response.')
            seeded = [user for user in matches if owned(user, email)]
            if mode == 'list':
                if seeded:
                    for user in seeded:
                        meta = user.get('app_metadata') or {}
                        print(
                            f'  {user["user_id"]}: verified={user.get("email_verified")}, '
                            f'blocked={user.get("blocked", False)}, last_login={user.get("last_login")}, '
                            f'scenario={meta.get("demo_scenario")}, role label={meta.get("demo_role")}'
                        )
                result = 'found' if seeded else 'not found'
            elif mode == 'cleanup':
                for user in seeded:
                    # Re-read immediately before deletion; fail closed if ownership changed.
                    current = client.request('GET', user_path(user))
                    if not owned(current, email):
                        raise SeederError('Ownership changed; deletion skipped.')
                    client.request('DELETE', user_path(user))
                result = 'deleted' if seeded else 'not found'
            elif len(seeded) > 1:
                raise SeederError('Multiple seeded accounts match; inspect manually.')
            elif matches and not seeded:
                result = 'conflict: existing non-seeded user; skipped'
            else:
                user = seeded[0] if seeded else None
                if user is None:
                    user = client.request(
                        'POST',
                        '/api/v2/users',
                        {
                            'connection': CONNECTION,
                            'email': email,
                            'name': item['name'],
                            'password': password,
                            'email_verified': item['email_verified'],
                            'verify_email': False,
                            'app_metadata': {
                                'rocketride_demo_seeder': MARKER,
                                'rocketride_demo_email': email,
                                'demo_scenario': item['scenario'],
                                'demo_role': item['role'],
                            },
                        },
                    )
                    result = 'created'
                else:
                    result = 'already seeded'
                # Only reconcile an explicitly seeded user; never unblock or alter others.
                if item['blocked'] and not user.get('blocked', False):
                    client.request('PATCH', user_path(user), {'blocked': True})
                    result += ', administratively blocked'
            counts[result] = counts.get(result, 0) + 1
            print(f'{email}: {result}')
        except (SeederError, KeyError, TypeError) as exc:
            counts['errors'] = counts.get('errors', 0) + 1
            print(f'{email}: ERROR {exc}', file=sys.stderr)
    print('Summary: ' + ', '.join(f'{key}={value}' for key, value in counts.items()))
    return 1 if counts.get('errors') or any(key.startswith('conflict:') for key in counts) else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--dry-run', action='store_true', help='Show local plan (default; no network)')
    group.add_argument('--apply', action='store_true', help='Create missing users')
    group.add_argument('--list', action='store_true', help='Inspect seeded users')
    group.add_argument('--cleanup', action='store_true', help='Delete verified seeded users')
    args = parser.parse_args(argv)
    users = json.loads((HERE / 'users.json').read_text(encoding='utf-8'))
    if not (args.apply or args.list or args.cleanup):
        for user in users:
            print(
                f'PLAN {user["email"]}: {user["scenario"]}, verified={user["email_verified"]}, blocked={user["blocked"]}, role label={user["role"]}'
            )
        print(f'Summary: {len(users)} planned; no network requests')
        return 0
    try:
        load_env(HERE / '.env')
        domain, client_id, secret = config()
        password = None
        if args.apply:
            password = os.environ.get('AUTH0_DEMO_PASSWORD', '')
            if not password:
                raise SeederError(
                    'AUTH0_DEMO_PASSWORD is required for --apply and must satisfy the connection password policy.'
                )
            if os.environ.get('AUTH0_DEMO_WELCOME_EMAIL_DISABLED') != 'true':
                raise SeederError(
                    'Disable the Auth0 welcome email template and set AUTH0_DEMO_WELCOME_EMAIL_DISABLED=true.'
                )
        if args.apply or args.cleanup:
            action = 'CREATE' if args.apply else 'DELETE'
            expected = f'{action} {domain}'
            if input(f'Type {expected} to confirm: ').strip() != expected:
                raise SeederError('Confirmation did not match; no requests made.')
        client = Client(domain, client_id, secret)
        return run(client, users, 'apply' if args.apply else 'cleanup' if args.cleanup else 'list', password)
    except (SeederError, EOFError, KeyboardInterrupt) as exc:
        print(f'Error: {exc or "cancelled"}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
