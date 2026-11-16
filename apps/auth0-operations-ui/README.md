# Auth0 Operations Console

An experimental RocketRide Shell app for read-only Auth0 identity investigations. A development-tenant investigation has been exercised through the local shell and engine; this remains a prototype, and model conclusions require independent verification.

## Architecture and limitations

The App Builder scaffold exposes one React descriptor to the RocketRide shell. The shared shell client starts `src/investigation.pipe` with `client.use` and sends questions using `client.chat`. The pipeline connects Chat → RocketRide Wave agent → answer response, with internal memory, an OpenAI-compatible LLM, and `tool_auth0`. It requests metadata-level pipeline tracing. A reload reuses a running task; the app warns that the existing task can have an older configuration, which must be stopped before changes take effect. React never calls Auth0. The Auth0 node uses an M2M Management API client on the engine. No write operation is exposed in the app and `allowWrite` is false.

The application uses the supported `client.tool` API to invoke a named, allowlisted `tool_auth0_1` read operation directly. Every request makes new calls; it does not use model text or earlier conversation as tool evidence. An exact-email helpdesk search retrieves `search_users`, then `get_user`, `get_user_logs`, and `get_user_blocks` for a single matching user. The console displays each current response, request arguments, status, and returned identifiers; older responses are marked as previous evidence. Empty, failed, or malformed responses do not establish a diagnosis. For a named operation, the requested tool is called directly or the request fails clearly. The `search_logs` tool is tenant-wide and cannot filter by email; use an exact-email helpdesk search for user-specific logs. Requests requiring an ID must include it as, for example, `user_id: auth0|...`.

For an account investigation the app sends the current retrieved evidence, but no prior conversation messages, to the Wave agent for an optional explanation. `require_tool_call` remains enabled for every agent run. If the agent does not call a tool, its response is discarded and an error is shown; the independently retrieved evidence remains visible. AI output is always marked unverified, and certain unsupported claims of a root cause or completion are discarded. This text filter is not a proof checker: an administrator must compare all explanations with the tool responses and obtain the reported failure, timestamp, and relevant event before drawing conclusions. Tool results contain untrusted data and are sent to the configured model provider for this analysis. Named read operations display their direct result without an AI call. A question without an email or named supported operation asks for a fresh identifier instead of treating previous results as current. This is not suitable for unattended security decisions.

Search is exact email only. The node supports `search_users`, `get_user`, `get_user_logs`, `get_log_event`, `get_user_blocks`, `get_connection`, `list_connections`, `get_connection_clients`, `list_users`, `list_applications`, `search_logs`, `get_brute_force_settings`, `get_ip_throttling_settings`, `list_roles`, `get_user_roles`, `get_user_permissions`, `list_organizations`, and `get_organization_members`. The UI supplies shortcuts for a subset; named operations can be requested one at a time in chat with their required identifier. Results are one page, not a complete inventory. See `nodes/src/nodes/tool_auth0/README.md` for exact inputs, output fields, permissions, sanitization, pagination, errors, and limitations. `unblock_user` is not exposed and remains unavailable even if writes are configured.

## Prerequisites and credentials

- An explicitly authorized **non-production Auth0 tenant** and designated test user; never run live tests against production.
- A RocketRide engine containing the checked-out Auth0 node, Wave agent, internal memory, chat, answer response and OpenAI-compatible LLM nodes. The experimental node and model must be available to the target engine. An engine connection alone does not prove this.
- In RocketRide's secure environment configuration set `ROCKETRIDE_AUTH0_DOMAIN`, `ROCKETRIDE_AUTH0_CLIENT_ID`, `ROCKETRIDE_AUTH0_CLIENT_SECRET` and `ROCKETRIDE_OPENROUTER_API_KEY`. The bundled pipeline contains only variable references. Do not place actual secrets in source, manifests, browser storage, logs or pipeline files. The OpenRouter free model is the example configuration; availability and rate limits apply. Choose a compatible configured LLM in the pipeline if needed.
- Grant the read-only Auth0 M2M client only necessary Management API permissions: `read:users`, `read:logs_users`, `read:logs`, `read:connections`, `read:clients`, `read:attack_protection`, `read:roles`, and, if using organization tools, `read:organizations` and `read:organization_members`. More detail and qualifications are in the node README. Keep `allowWrite` false.
- Node.js and pnpm, with server-matched `.rocketride/client/rocketride.tgz` and `.rocketride/shell/shell.tgz` vendored by the connected App Builder. The local engine serves these under `/client/shell` and `/client/typescript`; if `/client/shell` returns 404, build or pack the shell before vendoring. In the monorepo, workspace overrides resolve shell and client imports to the source packages instead, so rebuild stale SDK declarations with `pnpm exec tsc -p packages/client-typescript/tsconfig.types.json`.

## Preview and verification

Open `auth0-operations.rrapp` in the RocketRide App Builder with the workspace connected to the intended engine. The App Builder installs dependencies with pnpm and starts the Design preview. Check its watch and error panels and enable Inherit Auth if appropriate. `pnpm run build` from the app folder checks TypeScript and produces a local bundle, but it does not prove that the shell serves or runs it.

For this Windows monorepo, after building the engine and its shell/client artifacts, start the engine in one PowerShell window and the local preview in another:

```powershell
Set-Location dist/server
.\engine.exe ai/eaas.py
```

```powershell
node packages/client-typescript/dist/cli/packages/client-typescript/src/cli/rocketride.js app dev apps/auth0-operations-ui --uri http://127.0.0.1:5565 --no-install --no-auth
```

Open the printed preview URL and connect using your local engine credential. The preview port can change if the configured port is occupied. `--no-install` assumes the root workspace install has already succeeded. To build the app, run `pnpm --dir apps/auth0-operations-ui run build` from the repository root.

The SDK's `client.deploy.verifyApp('apps/auth0-operations-ui')` performs the local manifest/packaging check. It does not validate the pipeline, build, engine compatibility, tenant, or tool calls. Run `node --experimental-strip-types --test apps/auth0-operations-ui/test/operations.test.mjs` from the repository root with Node 22 for the focused parsing and pipeline guard tests. Run the Auth0 node tests with `python -m pytest nodes/test/tool_auth0 -q` in the repository's configured Python test environment. These tests are mocked and are not a live integration test.

Before a live test, confirm the tenant and user are authorized, then verify the pipeline and inspect its trace for `search_users`, `get_user`, `get_user_logs`, and `get_user_blocks` and their actual return values. Record only sanitized pass/fail evidence; do not save user identifiers, event contents, tokens, or raw responses. See `nodes/test/tool_auth0/LIVE_TESTING.md` for precautions. Do not change users or security configuration. A local shell test on 2026-11-16 used the user-designated development tenant and test user. The trace showed the agent, Auth0 node, and answer node; separate direct read-only calls matched the displayed profile, recent-event, and block-state claims. Direct SDK tool-call trace begin/end labels identify the named methods; metadata-level traces do not independently prove the contents of their results. One earlier attempt stopped after a partial answer, so the agent must not be relied upon to complete every requested call or to interpret every result correctly.

## Demo script, once verified

1. Open the app in App Builder and confirm the shell reports the engine connected.
2. Run a read-only query and inspect its trace to confirm the intended test tenant and credentials; the engine indicator alone is insufficient.
3. In Sign-in Helpdesk enter the designated test user's exact email and investigate.
4. Inspect the returned authentication events and account/block fields against the trace. Treat empty results, errors, missing scopes and rate limits as such, not as clean bill of health.
5. Review the optional AI explanation separately from current tool responses. Ask a new question with the exact email or an explicit supported tool name; previous results are not silently reused. Check possibilities and missing information against the response data.
6. Open Recovery Review and compare any suggested next step with the evidence and your organization's authorization policy.
7. Show that execution is disabled; do not perform an Auth0 write.

## Deployment prerequisites

The scaffold uses the reserved `local` namespace. Before any deployment, use an appropriate registered developer namespace (or the self-hosted namespace), confirm the engine includes all pipeline providers, complete a successful shell preview, build, source verification and authorized read-only end-to-end test, and review scopes, data handling and model provider. A public store listing additionally requires catalog and platform review. No deployment or publication is performed by the scaffold or this project.
