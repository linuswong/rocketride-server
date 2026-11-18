"""Offline tests; no network access."""

import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

import seed_auth0 as seed


def account(email, marker=seed.MARKER):
    return {
        'user_id': 'auth0|123',
        'email': email,
        'blocked': False,
        'app_metadata': {'rocketride_demo_seeder': marker, 'rocketride_demo_email': email},
        'identities': [{'provider': 'auth0', 'connection': seed.CONNECTION}],
    }


class SeederTests(unittest.TestCase):
    def setUp(self):
        self.item = {
            'email': 'one@example.com',
            'name': 'One Example',
            'scenario': 'never_logged_in',
            'email_verified': False,
            'blocked': False,
            'role': 'viewer',
        }
        self.client = Mock()

    def test_dataset_and_synthetic_fixture(self):
        users = json.loads((seed.HERE / 'users.json').read_text())
        fixtures = json.loads((seed.HERE / 'investigations.synthetic.json').read_text())
        self.assertEqual(len(users), 20)
        self.assertEqual(len({u['email'] for u in users}), 20)
        self.assertTrue(all(u['email'].split('@')[1] in ('example.com', 'example.org', 'example.net') for u in users))
        self.assertTrue(fixtures['synthetic'])
        self.assertGreaterEqual(len(fixtures['investigations']), 8)

    def test_dry_run_never_connects(self):
        with (
            patch.object(seed, 'Client', side_effect=AssertionError('network')),
            patch('sys.stdout', new_callable=io.StringIO),
        ):
            self.assertEqual(seed.main([]), 0)

    def test_env_file_values_and_process_precedence(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.dict(os.environ, {'AUTH0_DEMO_DOMAIN': 'override'}, clear=True),
        ):
            path = Path(directory) / '.env'
            path.write_text(
                '# comment\nAUTH0_DEMO_DOMAIN=other\nAUTH0_DEMO_PASSWORD="a=b # literal"\n', encoding='utf-8'
            )
            seed.load_env(path)
            self.assertEqual(os.environ['AUTH0_DEMO_DOMAIN'], 'override')
            self.assertEqual(os.environ['AUTH0_DEMO_PASSWORD'], 'a=b # literal')
            path.write_text('AUTH0_DEMO_PASSWORD="unterminated\n', encoding='utf-8')
            with self.assertRaises(seed.SeederError):
                seed.load_env(path)

    def test_create_and_repeat(self):
        self.client.lookup.return_value = []
        self.client.request.return_value = account(self.item['email'])
        self.assertEqual(seed.run(self.client, [self.item], 'apply', 'secret'), 0)
        payload = self.client.request.call_args.args[2]
        self.assertFalse(payload['verify_email'])
        self.assertEqual(payload['app_metadata']['rocketride_demo_seeder'], seed.MARKER)
        self.client.reset_mock()
        self.client.lookup.return_value = [account(self.item['email'])]
        self.assertEqual(seed.run(self.client, [self.item], 'apply', 'secret'), 0)
        self.client.request.assert_not_called()

    def test_conflict_is_not_modified(self):
        self.client.lookup.return_value = [account(self.item['email'], 'other')]
        self.assertEqual(seed.run(self.client, [self.item], 'apply', 'secret'), 1)
        self.client.request.assert_not_called()

    def test_block_is_reconciled_on_seeded_user(self):
        self.item['blocked'] = True
        self.client.lookup.return_value = [account(self.item['email'])]
        self.assertEqual(seed.run(self.client, [self.item], 'apply', 'secret'), 0)
        self.client.request.assert_called_once_with('PATCH', '/api/v2/users/auth0%7C123', {'blocked': True})

    def test_cleanup_rechecks_ownership(self):
        self.client.lookup.return_value = [account(self.item['email'])]
        self.client.request.return_value = account(self.item['email'], 'changed')
        self.assertEqual(seed.run(self.client, [self.item], 'cleanup'), 1)
        self.assertEqual(self.client.request.call_count, 1)
        self.client.request.return_value = account(self.item['email'])
        self.client.request.reset_mock()
        self.assertEqual(seed.run(self.client, [self.item], 'cleanup'), 0)
        self.assertEqual(self.client.request.call_args.args[0], 'DELETE')

    def test_confirmation_precedes_network(self):
        env = {
            'AUTH0_DEMO_DOMAIN': 'dev.us.auth0.com',
            'AUTH0_DEMO_TENANT_CONFIRM': 'dev.us.auth0.com',
            'AUTH0_DEMO_ENVIRONMENT': 'development',
            'AUTH0_DEMO_CLIENT_ID': 'id',
            'AUTH0_DEMO_CLIENT_SECRET': 'secret',
            'AUTH0_DEMO_PASSWORD': 'password',
            'AUTH0_DEMO_WELCOME_EMAIL_DISABLED': 'true',
        }
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(seed, 'load_env'),
            patch('builtins.input', return_value='no'),
            patch.object(seed, 'Client', side_effect=AssertionError('network')),
        ):
            self.assertEqual(seed.main(['--apply']), 1)
            self.assertEqual(seed.main(['--cleanup']), 1)

    def test_requires_development_tenant_and_email_acknowledgement(self):
        env = {
            'AUTH0_DEMO_DOMAIN': 'dev.us.auth0.com',
            'AUTH0_DEMO_TENANT_CONFIRM': 'different.us.auth0.com',
            'AUTH0_DEMO_ENVIRONMENT': 'development',
            'AUTH0_DEMO_CLIENT_ID': 'id',
            'AUTH0_DEMO_CLIENT_SECRET': 'secret',
            'AUTH0_DEMO_PASSWORD': 'password',
        }
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(seed, 'load_env'),
            patch.object(seed, 'Client', side_effect=AssertionError('network')),
        ):
            self.assertEqual(seed.main(['--list']), 1)
            os.environ['AUTH0_DEMO_TENANT_CONFIRM'] = env['AUTH0_DEMO_DOMAIN']
            self.assertEqual(seed.main(['--apply']), 1)

    def test_list_and_cleanup_ignore_nonseeded_accounts(self):
        self.client.lookup.return_value = [account(self.item['email'], 'other')]
        self.assertEqual(seed.run(self.client, [self.item], 'list'), 0)
        self.assertEqual(seed.run(self.client, [self.item], 'cleanup'), 0)
        self.client.request.assert_not_called()

    def test_rate_limit_and_network_failure(self):
        client = seed.Client.__new__(seed.Client)
        client.base, client.token = 'https://dev.us.auth0.com', 'token'
        client.opener = Mock()
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'[]'
        client.opener.open.side_effect = [HTTPError('', 429, '', {'Retry-After': '2'}, None), response]
        with patch.object(seed.time, 'sleep') as sleep:
            self.assertEqual(client.request('GET', '/api/v2/users'), [])
            sleep.assert_called_once_with(2)
        client.opener.open.side_effect = URLError('unavailable')
        with self.assertRaises(seed.SeederError):
            client.request('POST', '/api/v2/users', {})
        self.assertEqual(client.opener.open.call_count, 3)


if __name__ == '__main__':
    unittest.main()
