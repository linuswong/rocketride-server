# LoginLens live verification — 2026-11-19

## Authorized scope

The user designated the testlab development tenant, authorized read-only Auth0 logs and protection settings, and approved up to five Gemini requests using sanitized categories, timestamps and aggregate observations. No write actions, synthetic traffic or new accounts were authorized. The connected local engine's environment file names the development Auth0 domain, and the configured application is labeled Auth0 TestLab. The engine environment API exposes variable names only, so the effective runtime domain and granted scopes were not independently read back.

## Results

| Stage | Result |
| --- | --- |
| RocketRide | The workspace connection reached the local engine. The inspected task configuration had `tool_auth0_1`, `allowWrite: false` and a Gemini provider configured. Environment names for the Auth0 domain, client ID, client secret and Gemini key were available; names alone do not prove credential validity or scope grants. |
| Initial dashboard retrieval | Failed with the UI's generic tool-request error. The cause was not established. After reloading the preview, a fresh request succeeded. |
| Auth0 retrieval | `search_authentication_history` succeeded through RocketRide. The fixed seven-day window ended at 2026-11-19 20:15:34.418 UTC. One page returned 93 records, `coverage: retrieved`, and no partial-retrieval reason. This means query exhaustion, not verified completeness of retention or indexing. |
| Metrics | An independent aggregate of the returned records matched the dashboard: 16 successful sign-ins, 3 failed sign-ins, 1 sign-up, 0 protection events, 73 excluded records, and a 15.8% failure-event rate. The 20 recognized records had coordinates that matched the displayed coarse map cluster. No raw event, account, IP or precise location is recorded here. |
| Detection and classification | The dashboard reported zero triggered anomaly rules. Live historical spike and rate rules remain suppressed because complete coverage is not independently established. This does not establish that the tenant has no unusual activity. |
| Gemini planning and findings | Not run because the selected snapshot had no suitable anomaly. Zero of five authorized Gemini requests were used. |
| Graph approval and execution | No graph was generated or executed. The history calls above were independently authorized read-only retrievals, not an approved investigation graph. No protection-setting scope or tool outcome was verified. |
| Evidence and conclusions | Dashboard counts were reconciled against a second read of the same time window. No AI conclusions were produced or verified. |

No credentials, raw IP addresses, email addresses, account identifiers, raw log records or prompts are included in this report.


## Manual investigation verification attempt

After separate authorization for manual investigation and up to five sanitized Gemini requests, the same fixed seven-day interval was queried again through a fresh, read-only RocketRide Auth0 task. Two retrievals each returned 20 recognized events including three failures, with query-exhausted coverage. These are repeat reads of existing events; no test events were created.

The first planner attempt dispatched one RocketRide chat request through a task configured with the Gemini provider and failed with a `SyntaxError` during the chat/proposal stage. No response body was recorded, so this does not establish whether the provider returned malformed JSON, an intermediate component failed while parsing, or Gemini actually responded. A second attempt failed during model task setup, before dispatching a chat request; its cause was not established. No validated graph, approved graph execution, or AI finding resulted. One chat request was dispatched; the actual number of underlying provider requests was not independently observed. No raw event data, identifiers or provider response is recorded.

The earlier generic Auth0 error remains unexplained. The local browser preview was serving an older app during this attempt. Fresh local browser tests use fixtures and do not prove the live manual workflow.


A subsequent test used the rebuilt application itself. A seven-day read ending 2026-11-19 20:32:37.375 UTC displayed 20 recognized events, including 16 successes, three failures and one sign-up, with query-exhausted coverage and 76 excluded records. The operator selected the three failures and the question “Why did these authentication attempts fail?” The manual investigation showed the time window and explicitly stated that no anomaly was asserted.

The app's proposal action completed with `Planner response was not valid JSON.` The validator did not accept a graph, so no graph was approved or executed and no findings were generated. The raw provider output was not captured; its content and the reason for the invalid JSON remain unknown. Together with the earlier scripted attempt, two RocketRide chat requests were dispatched; the number of underlying provider calls is not independently observable. The intervening task-setup failure dispatched no chat request. No further model calls were attempted.
