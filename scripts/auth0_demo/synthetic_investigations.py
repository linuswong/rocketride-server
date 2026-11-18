#!/usr/bin/env python3
"""Inspect fictional authentication investigations without contacting Auth0."""

import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent


def load_data():
    with (HERE / 'investigations.synthetic.json').open(encoding='utf-8') as file:
        fixture = json.load(file)
    with (HERE / 'users.json').open(encoding='utf-8') as file:
        users = json.load(file)
    return fixture, {user['email'].lower(): user for user in users}


def find_cases(fixture, users, *, case_id=None, email=None):
    """Return synthetic records and local fixture profiles, never tenant state."""
    cases = fixture['investigations']
    if case_id:
        cases = [case for case in cases if case['id'].lower() == case_id.lower()]
    if email:
        cases = [case for case in cases if case['email'].lower() == email.lower()]
    return [{**case, 'synthetic': True, 'fixture_profile': users.get(case['email'].lower())} for case in cases]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument('--case', help='Select a case ID, e.g. SYN-003')
    choice.add_argument('--email', help='Select investigations by exact email')
    choice.add_argument('--list', action='store_true', help='List available investigations (default)')
    parser.add_argument('--json', action='store_true', help='Print labeled synthetic JSON')
    args = parser.parse_args(argv)
    try:
        fixture, users = load_data()
        cases = find_cases(fixture, users, case_id=args.case, email=args.email)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'Could not load synthetic fixtures: {exc}', file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({'synthetic': True, 'source': 'local fixtures; not Auth0', 'investigations': cases}, indent=2))
    else:
        print('SYNTHETIC DATA - local fixtures only; not Auth0 logs or actual tenant state. All times UTC.')
        if not cases:
            print('No synthetic investigations match.')
        for case in cases:
            print(f'\n{case["id"]} | {case["email"]} | {case["scenario"]}')
            if args.case or args.email:
                profile = case['fixture_profile']
                if profile:
                    print(
                        f'  Fixture profile: {profile["name"]}; email verified={profile["email_verified"]}; '
                        f'administratively blocked={profile["blocked"]}; role label={profile["role"]}'
                    )
                else:
                    print('  Fixture profile: no matching user in the local dataset')
                print(f'  Finding: {case["expected_finding"]}')
                for event in sorted(case['events'], key=lambda entry: entry['date']):
                    print(f'  {event["date"]}  {event["type"]}: {event["description"]} [synthetic]')
    return 0 if cases else 1


if __name__ == '__main__':
    sys.exit(main())
