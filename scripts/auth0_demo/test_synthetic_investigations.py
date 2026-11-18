"""Offline checks for the synthetic investigation harness."""

import contextlib
import io
import json
import unittest
from unittest.mock import patch

import synthetic_investigations as demo


class SyntheticInvestigationTests(unittest.TestCase):
    def test_cases_have_ordered_distinct_synthetic_events(self):
        fixture, users = demo.load_data()
        cases = demo.find_cases(fixture, users)
        self.assertGreaterEqual(len(cases), 8)
        self.assertEqual(len({case['id'] for case in cases}), len(cases))
        for case in cases:
            self.assertTrue(case['synthetic'])
            self.assertTrue(all(event['synthetic'] and event['date'].endswith('Z') for event in case['events']))
            self.assertEqual(case['events'], sorted(case['events'], key=lambda event: event['date']))
        recovered = next(case for case in cases if case['scenario'] == 'successful_after_failure')
        self.assertEqual([event['type'] for event in recovered['events']], ['fp', 's'])
        admin = next(case for case in cases if case['scenario'] == 'admin_block')
        self.assertTrue(admin['fixture_profile']['blocked'])

    def test_case_email_and_unknown_lookup(self):
        fixture, users = demo.load_data()
        self.assertEqual(demo.find_cases(fixture, users, case_id='syn-003')[0]['scenario'], 'brute_force_protection')
        self.assertEqual(
            demo.find_cases(fixture, users, email='MISSING.PERSON@example.org')[0]['fixture_profile'], None
        )
        self.assertEqual(demo.find_cases(fixture, users, email='absent@example.org'), [])

    def test_json_output_and_no_network(self):
        with (
            patch('socket.socket', side_effect=AssertionError('network access')),
            contextlib.redirect_stdout(io.StringIO()) as out,
        ):
            self.assertEqual(demo.main(['--case', 'SYN-003', '--json']), 0)
        result = json.loads(out.getvalue())
        self.assertTrue(result['synthetic'])
        self.assertEqual(result['investigations'][0]['id'], 'SYN-003')
        self.assertIn('not Auth0', result['source'])

    def test_missing_case_exits_nonzero(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(demo.main(['--case', 'SYN-999']), 1)
        self.assertIn('No synthetic investigations match', out.getvalue())


if __name__ == '__main__':
    unittest.main()
