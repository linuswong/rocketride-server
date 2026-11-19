# Developer guide

Open `auth0-operations.rrapp` in App Builder as described in the app README. `useShellConnection` supplies the SDK client. `ensureTask` starts or verifies the existing pipeline; `executeInvestigation` coordinates explicit `client.tool` reads and emits immutable step snapshots for `InvestigationWorkspace`. The graph shows request start/finish as observed by this application. It does not subscribe to or claim internal request traces. See RocketRide's observability documentation for actual monitor events.

`operations.ts` allowlists tool names and validates responses; `safeEvidence` restricts the graph's displayed and model-bound fields. `findings` only reports bounded observations and links to a step. To add an integration, verify its installed node contract, add a narrowly scoped adapter and response validation, test failures and redaction, and expose its actual limitations. For a new independently executable workflow, follow the local RocketRide pipeline and app guides; verify it on the target engine rather than assuming providers exist.

For a failure inspect the step, connection, node availability, secret references and scopes. Do not paste customer evidence or credentials into logs. The model may fail while usable read evidence remains. See `testing.md` for deterministic checks.
