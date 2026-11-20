# LoginLens

The opening dashboard shows a labeled offline example, including synthetic user inventory counts derived in part from the example login activity. Select a map cluster or a priority anomaly to review its time window and supporting events. Propose a fixture investigation, inspect the graph, then approve the reads to see evidence and suggested follow-up. The graph includes a local source-group check that counts selected failed events, their anonymous source groups and missing source data; a shared source can be a shared network and does not establish an attacker. The fixture graph and reads run locally. With an engine connection, authorize **Generate AI analysis** below the graph to send fictional example evidence to the model and see a short suggested next step and reason.

**Load tenant events** starts or reattaches to `src/auth0_telemetry.pipe`, a RocketRide task containing only a tools source and the read-only Auth0 node. It verifies the running task before requesting the selected window; loading and refreshing telemetry require no model credentials or AI provider. The query uses up to five pages of 100 records. A partial response remains usable and displays its reason. A short page means the query was exhausted, subject to the tenant's retention, indexing and concurrent changes. Changing to a longer window requires a reload. Sign-ups and protection events are separate from the sign-in failure denominator. Missing locations stay unmapped. Group keys are local to a retrieval. Rules and their default thresholds live in `src/lensRules.ts`. Live historical spike and rate comparisons are suppressed until coverage can be independently verified.

Loading tenant events does not retrieve the user inventory. Live total, active and inactive user KPIs remain unavailable; sign-in events do not establish registered-user totals.

For sustained monitoring, evaluate Auth0 Log Streams and an appropriately authorized, tenant-isolated destination. No stream or persistence is configured by this application. Auth0 may omit user identifiers from failed logs, limiting account and spraying detection. The planner exposes event lookup, bounded tenant-wide history, recent events by type, and the two protection-configuration tools. Additional identity or connection reads would require evidence-bound identifiers and a verified authorization boundary.

On a tenant anomaly, **Propose AI investigation** sends event categories, timestamps and aggregate rule evidence to the configured Gemini provider through a fresh, tool-free RocketRide task. Review each purpose, evidence reference and dependency before approving. The app bounds model proposals to six distinct checks and four dependency levels, plus a local source-group check when selected failures are present. It executes approved reads through the verified Auth0-only telemetry task and shows deterministic summaries. The AI analysis below the graph is a separate, explicitly authorized action that sends sanitized successful observations to a fresh, tool-free, single-attempt model task and links its findings to the recorded reads; it is never invoked by approving reads. Failed steps remain inspectable. Remediation suggestions are for human review. Live use requires a development engine with this version of the Auth0 node, tenant scopes and a configured model provider.

LoginLens has five sections: **Overview** for the activity map, **Analytics** for sign-in trends, **Anomaly Detection** for rule-based signals, **Investigations** for evidence and graphs, and **Settings** for connection and configuration information. The selected time window and loaded event snapshot are shared across the first three sections.

### Manual verification in App Builder

1. Open `apps/auth0-operations-ui/auth0-operations.rrapp` in the RocketRide VS Code extension's App Builder and open **Design → Preview**.
2. On **Overview**, inspect the labeled synthetic activity map. Open **Analytics** to inspect trends, then **Anomaly Detection** and select an anomaly.
3. In **Investigations**, propose the fixture investigation, approve it, and inspect the resulting graph and evidence. This offline example uses no engine or model calls.
4. To investigate an account, open **Investigations → Investigation options → Investigate an account** (or choose **Investigate an account** on Anomaly Detection). Select **Run offline example** to inspect a fictional account graph. For a live query use an authorized development tenant and designated test user. See [live verification](docs/loginlens-live-verification.md).

## Architecture and limitations

The App Builder scaffold exposes one React descriptor to the RocketRide shell. Telemetry and approved graph reads use `src/auth0_telemetry.pipe`; the separate account workflow uses `src/investigation.pipe`. The latter connects Chat → RocketRide Wave agent → answer response, with internal memory, model nodes, and `tool_auth0`, and can initialize a provider when started. The telemetry task is separate and contains no model or agent. Both use metadata-level pipeline tracing. A reused investigation task may have an older configuration; the app checks its safeguards and warns the user. React never calls Auth0 directly. The Auth0 node uses an M2M Management API client on the engine. No write operation is exposed in the app and `allowWrite` is false.

The application uses the supported `client.tool` API to invoke a named, allowlisted `tool_auth0_1` read operation directly. Every request makes new calls; it does not use model text or earlier conversation as tool evidence. An exact-email helpdesk search retrieves `search_users`, then `get_user`, followed by concurrent `get_user_logs` and `get_user_blocks` for a single matching user. The console displays each current response, request arguments, status, and returned identifiers; older responses are marked as previous evidence. Empty, failed, or malformed responses do not establish a diagnosis. For a named operation, the requested tool is called directly or the request fails clearly. The `search_logs` tool is tenant-wide and cannot filter by email; use an exact-email helpdesk search for user-specific logs. Requests requiring an ID must include it as, for example, `user_id: auth0|...`.

The anomaly planner and optional account diagnosis use a fresh, isolated Gemini pipeline. Model explanations are unverified and must be compared with the returned evidence. No write operation is exposed.

## Sign-in investigation graph

Open **Investigations → Investigate an account**, enter an exact email, and select **Start investigation**. The graph initializes before the pipeline starts and reports the real start and completion of each direct SDK call; it does not show internal Auth0 request or retry progress. Select a node or use the accessible step list to inspect findings, sanitized inputs, validated output and available trace. Expandable JSON contains the filtered output, not the original response. The overall evidence summary remains below the graph. Pan, zoom, and fit controls are available in the graph. Restart makes a fresh investigation; Results and in-progress work remain available when switching app sections, but are held only in memory and are not persisted or audited; reloading or closing the app loses them.

The workflow searches for a unique exact match, verifies the returned profile ID, then requests user logs and brute-force block records concurrently. Zero matches, multiple matches, failed searches and mismatched profiles stop dependent checks. Search indexing is eventually consistent, and the log result is a single page. Empty logs mean insufficient evidence; a successful block lookup with records is a security finding, not a failed tool call. Failed checks and retry intervals remain visible alongside successful results. No writes are available. Additional tenant-wide settings, roles and permissions are not fetched automatically because they do not by themselves explain a specific sign-in.

The diagnosis is an optional model interpretation of the current, field-allowlisted tool evidence. It is off by default; enable the live investigation checkbox to send filtered customer evidence to the configured model provider. It uses a newly started, verified tool-free pipeline (`synthetic_investigation.pipe`) and is terminated afterward; despite that filename, the live graph sends real filtered evidence to the configured model provider. It does not issue additional Auth0 calls. The text may cite tool names but citations and claims are not automatically verified. Compare it to the inspector; it is not evidence or an authorization to act. If the model is unavailable, the graph retains the checks and reports the diagnosis failure. Tool execution states reflect frontend SDK request boundaries, not engine trace events; the graph does not expose backend retries or streaming model tokens.

Run the deterministic workflow tests with `node --experimental-strip-types --test apps/auth0-operations-ui/test/investigation.test.mjs` from the repository root. These mocked tests do not verify a live engine, visual layout, or actual parallel execution behavior of the remote engine.

## Prerequisites and credentials

- An explicitly authorized **non-production Auth0 tenant** and designated test user; never run live tests against production.
- A RocketRide engine containing the checked-out Auth0 node, Wave agent, internal memory, chat, answer response and Gemini LLM node. The experimental node and model must be available to the target engine. An engine connection alone does not prove this.
- In RocketRide's secure environment configuration set `ROCKETRIDE_AUTH0_DOMAIN`, `ROCKETRIDE_AUTH0_CLIENT_ID`, `ROCKETRIDE_AUTH0_CLIENT_SECRET` and `ROCKETRIDE_GEMINI_KEY`. The bundled pipelines contain only variable references. Do not place actual secrets in source, manifests, browser storage, logs or pipeline files. The configured Gemini model must be enabled for the API key.
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

If the CLI reports `ECONNREFUSED` on port 5565, start the engine and wait for its startup message before starting the preview. Run both commands from the directories shown above. If loopback access is blocked by the execution environment, allow local networking. Another App Builder preview can occupy port 3821; use the URL printed by the CLI after any port bump. Wait for the build's `ready` message as well as the URL, then check the shell in a browser. The generated proxy wrapper belongs to its running preview session; leave other files in `.rocketride` intact.

The SDK's `client.deploy.verifyApp('apps/auth0-operations-ui')` performs the local manifest/packaging check. It does not validate the pipeline, build, engine compatibility, tenant, or tool calls. Run `node --experimental-strip-types --test apps/auth0-operations-ui/test/operations.test.mjs` from the repository root with Node 22 for the focused parsing and pipeline guard tests. Run the Auth0 node tests with `python -m pytest nodes/test/tool_auth0 -q` in the repository's configured Python test environment. These tests are mocked and are not a live integration test.

Before a live test, confirm the tenant and user are authorized, then verify the pipeline and inspect its trace for `search_users`, `get_user`, `get_user_logs`, and `get_user_blocks` and their actual return values. Record only sanitized pass/fail evidence; do not save user identifiers, event contents, tokens, or raw responses. See `nodes/test/tool_auth0/LIVE_TESTING.md` for precautions. Do not change users or security configuration. A local shell test on 2026-11-16 used the user-designated development tenant and test user. The trace showed the agent, Auth0 node, and answer node; separate direct read-only calls matched the displayed profile, recent-event, and block-state claims. Direct SDK tool-call trace begin/end labels identify the named methods; metadata-level traces do not independently prove the contents of their results. One earlier attempt stopped after a partial answer, so the agent must not be relied upon to complete every requested call or to interpret every result correctly.

## Demo script, once verified

1. Open the app in App Builder and confirm the engine connection.
2. Load tenant events on **Overview** and inspect coverage.
3. Review **Analytics** and **Anomaly Detection**, select an anomaly and review its proposed graph.
4. Approve read-only checks and compare each finding with its evidence. See [live verification](docs/loginlens-live-verification.md).

## Deployment prerequisites

The scaffold uses the reserved `local` namespace. Before any deployment, use an appropriate registered developer namespace (or the self-hosted namespace), confirm the engine includes all pipeline providers, complete a successful shell preview, build, source verification and authorized read-only end-to-end test, and review scopes, data handling and model provider. A public store listing additionally requires catalog and platform review. No deployment or publication is performed by the scaffold or this project.

## Milestone 5 status

The local audit and offline verification are documented in [platform capability audit](docs/architecture/platform-capability-audit.md), [authorization design](docs/architecture/authentication-authorization.md), [persistence design](docs/architecture/persistence-design.md), [testing](docs/testing.md), and [marketplace readiness](docs/marketplace-readiness.md). The proposed Node-only authorization model is tested but no production authorization service or durable ticket storage exists. Real customer records must not be put in the fictional inbox. The redesigned app has not been verified in App Builder or against an authorized live engine and tenant during this milestone. See `docs/testing.md` for gated smoke-test and manual shell steps.

### Geographic map

LoginLens bundles MapLibre GL JS (BSD-3-Clause) and the `world-atlas` Natural Earth 1:110m country polygons. Natural Earth data is public domain; attribution is displayed on the map. The style and boundaries are local, so no map service, API key, or external tile requests are needed. Deployments must allow WebGL and MapLibre's blob-based worker under their browser Content Security Policy (`worker-src blob:`). The bundled overview polygons are generalized and omit some small islands; border and offshore geolocation can be unassigned or approximate. State/province boundaries are not included. Authentication locations are approximate network origins, and density is activity, not a finding of malicious behavior. Country account counts include only identifiable account groups and may undercount accounts where identifiers are missing.
