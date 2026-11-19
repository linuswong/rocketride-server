# Implementation plan

## Milestone 6 next steps

1. Obtain a documented RocketRide delegated identity or trusted extension contract, including current membership, permissions and revocation semantics; validate it with an authorized test provider and tenant.
2. Agree on hosting, data controller, retention and database choice. Build migrations and an authenticated API with scoped transactions, idempotency and version checks; test adversarial requests against the actual service and database.
3. Add a connected repository and explicit error states with no demo fallback; retain the existing fictional workflow. Verify App Builder, installation, and live read-only investigation separately before marketplace review.

1. Preserve the existing app, pipelines, reviews and supported direct SDK calls. Establish an offline baseline and document what is actually observable.
2. Strengthen input and response validation, distinguish evidence from interpretation, add bounded failure handling and test representative failure paths with mocks.
3. Improve the existing investigation workspace and add a fully offline synthetic path that exercises the same orchestration and graph without a client, model or credentials. Keep it visibly separate from live data.
4. Evaluate build, tests, UI and live integration against the MVP acceptance criteria. Do not start ticket workflows or publication until those criteria are evaluated. A live tenant, engine compatibility, secure tenant-isolated history and external marketplace review cannot be assumed.

Risks: customer data may contain prompt injection; filtered evidence is still sensitive and is sent to a model in live analysis. Browser storage cannot enforce user/tenant isolation. One-page and eventually consistent Auth0 results cannot prove absence. SDK request timing is not backend trace timing. A timed-out request may still be executing remotely; avoid claiming cancellation. The Auth0 node is experimental and engine availability is unverified.

## Support demo increment

The explicitly requested expansion implements in-memory fictional ticket intake, lifecycle, deterministic routing, knowledge lookup, draft editing and a link to the existing offline graph. No new engine pipeline was needed for those local rules. The support demo is not a production support service: authenticated shared persistence, live ticket/investigation ownership, real document access, provider configuration and outbound communications require separate design and verification. Milestone 1–2 live verification remains outstanding; this local expansion does not close it.

## Investigation workspace

Implemented the ticket context, interactive graph and evidence inspector, independent summary, session-only reopening of fictional investigations, dedicated ticket creation view and responsive layouts. Offline verification and known gaps are recorded in `progress.md`. Next work is authorized server-side tenant isolation and durable ticket/investigation binding, followed by a separately approved live integration test.

## Milestone 5 next steps

1. Choose and verify an operator session and current membership mechanism that a trusted service can validate, including revocation. Specify service hosting and operational ownership.
2. Implement validated server contracts, transactional organization-scoped records, parent constraints, idempotency and migration/retention controls; run adversarial tests against the actual service and database. The current test model is not that service.
3. Verify App Builder and an independently installed clean environment. Separately obtain all authorizations in `testing.md` before any live smoke test. Confirm `tool_auth0` catalog eligibility and engine credential isolation before considering store submission.
4. Complete broader reliability, cancellation/reconciliation, field-redaction, security and accessibility reviews. No marketplace readiness or production authorization is claimed.
