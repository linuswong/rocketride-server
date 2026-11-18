# Auth0 development-tenant demo seeder

This standalone Python 3.10+ utility creates 20 fictional accounts in the existing `Username-Password-Authentication` database connection. It does not use or change the RocketRide node or engine. The default dry run is local and makes no requests. `investigations.synthetic.json` contains nine **synthetic** investigations, not Auth0 logs or evidence of actual activity. Creating accounts or setting metadata does not generate failed-login events, MFA challenges, successful logins, or brute-force protection blocks. New accounts have never logged in; the scenario labels describe intended manual tests. Administrative blocking is a real profile state and is separate from brute-force blocking. `demo_role` is a label in app metadata, not an Auth0 RBAC role or permission.

## Configure the development tenant

1. Select a dedicated development tenant and verify its Auth0-managed hostname. The environment declarations below are an operator safety check, not a cryptographic proof that the tenant is development. Never point this tool at a production tenant.
2. Create a **separate** machine-to-machine application for this utility and authorize it for the Auth0 Management API. Grant `read:users` for listing and conflict checks, `create:users` for creation, `update:users` for administrative blocks, and `delete:users` for cleanup. Grant only the scopes needed for the planned operation. Enable that application on the existing `Username-Password-Authentication` database connection; check the connection's password policy. The RocketRide integration should retain its separate read-only credentials.
3. In Auth0's email templates disable the **welcome email** template before apply, and check any tenant Actions or custom hooks that may send mail. Auth0 may send a welcome email even when `verify_email` is false. This script sets `verify_email: false` for every user and requires your explicit acknowledgement that the welcome template is disabled; it cannot verify template or custom Action settings. It has no option to send email. See [Auth0's explanation of creation emails](https://support.auth0.com/center/s/article/Invite-users-created-by-the-Management-API).
4. Use a unique, strong development-only password satisfying the connection's policy. All created accounts share this password, so do not reuse a real password. Existing seeded accounts retain their old password on subsequent runs; the script never prints or stores it. Verified emails are marked verified by the API, without sending verification mail.

## Windows PowerShell

Run from the repository root. Copy the example to `scripts/auth0_demo/.env` and fill in your development tenant and credentials:

```powershell
Copy-Item scripts/auth0_demo/.env.example scripts/auth0_demo/.env
notepad scripts/auth0_demo/.env
```

The script loads this file for `--list`, `--apply`, and `--cleanup`, regardless of the current directory. Git ignores `.env`; do not commit it or share it. Use one `AUTH0_DEMO_NAME=value` per line, with optional matching single or double quotes. Values are literal: there is no variable interpolation, escape processing, or inline-comment syntax. Existing process environment variables take precedence, even if empty. Dry-run does not load the file.

Alternatively, enter the variables in PowerShell or use your organization's secure secret management. These environment variables remain in the current process and are inherited by child processes:

```powershell
$env:AUTH0_DEMO_DOMAIN = 'your-development-tenant.us.auth0.com'
$env:AUTH0_DEMO_TENANT_CONFIRM = $env:AUTH0_DEMO_DOMAIN
$env:AUTH0_DEMO_ENVIRONMENT = 'development'
$env:AUTH0_DEMO_CLIENT_ID = 'your-seeder-client-id'
$env:AUTH0_DEMO_CLIENT_SECRET = Read-Host 'Seeder client secret'
$env:AUTH0_DEMO_PASSWORD = Read-Host 'Development-only user password'
$env:AUTH0_DEMO_WELCOME_EMAIL_DISABLED = 'true'

python scripts/auth0_demo/seed_auth0.py --dry-run
python scripts/auth0_demo/seed_auth0.py --list
# Only after reviewing the target and email settings:
python scripts/auth0_demo/seed_auth0.py --apply
python scripts/auth0_demo/seed_auth0.py --cleanup
Remove-Item Env:AUTH0_DEMO_CLIENT_SECRET, Env:AUTH0_DEMO_PASSWORD
```

`Read-Host` displays typed characters; use a secure secret-management mechanism when appropriate. Apply and cleanup require typing `CREATE <hostname>` or `DELETE <hostname>` respectively. They have no unattended confirmation switch. List/apply/cleanup need network access and configured credentials; dry-run needs neither. Cleanup looks up the 20 exact fixture emails, requires the seeder's app-metadata marker, email and database identity, and re-reads each user before deleting. It never deletes a matching account without all ownership checks. Do not copy the marker onto other accounts or alter seeded email/identity/metadata: changed accounts may be skipped and require manual inspection. Protect Management API credentials and app metadata because an administrator could forge the marker. Cleanup does not remove accounts whose email is no longer in `users.json`.

Existing non-seeded email matches are skipped and reported as conflicts. Existing seeded users are reused, not overwritten; designated blocked users are blocked if needed. A failure after creation can leave a user partially configured; rerun apply to reconcile the administrative block. Network failures during writes may have an unknown outcome, so writes are not blindly replayed. HTTP 429 rejections are retried with bounded delay; other failures are reported per user. Review the summary and nonzero exit status for conflicts or errors. Lookup is case-sensitive; fixture addresses and database-created addresses are lowercase. Never assume an absent result proves that differently cased identities in other connections do not exist.

No login attempts are made. Test logins, MFA, and attack-protection behavior manually only when deliberately configured for the development tenant; those activities can create real logs and trigger tenant Actions or notifications. Brute-force policy and MFA enrollment determine actual behavior.

## Explore synthetic login history

The standalone investigation harness reads only the two local JSON fixtures; it does not connect to Auth0, read `.env`, or change the console. Its fixture profiles and timestamps are fictional snapshots, not a live view of the seeded accounts. Synthetic event codes beginning `synthetic_` are illustrative, not Auth0 event types. Scenarios can describe activity for users designated as never logged in because the history is fictional.

```powershell
python scripts/auth0_demo/synthetic_investigations.py --list
python scripts/auth0_demo/synthetic_investigations.py --case SYN-003
python scripts/auth0_demo/synthetic_investigations.py --email quinn.rivera@example.com
python scripts/auth0_demo/synthetic_investigations.py --case SYN-009 --json
```

The JSON output retains an explicit `synthetic` label and is suitable as an input to offline tests. A missing match exits with status 1. These fixtures do not appear in the live RocketRide console or Auth0 logs.

Run offline tests with `python -m unittest discover -s scripts/auth0_demo -p 'test_*.py'`. The tests use mocks and never contact Auth0.
