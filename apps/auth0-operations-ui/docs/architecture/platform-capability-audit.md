# Platform capability audit

Audited 2026-11-18 against this checkout and local offline tooling; no connected-engine assertion is implied. Status describes evidence, not a promise for every deployment.

| Capability | Status | Evidence and trust |
| --- | --- | --- |
| Authenticated app user | Partially verified | `packages/shell/src/hooks/useAuthUser.ts` exposes the `ConnectResult` from a successful shell connection. It is browser-visible session state, not a credential a separate service may trust merely because the client sends it. |
| Organization identity | Partially verified | `src/App.tsx` reads `user.organization?.id` and remounts on changes. It is a UI hint, not proof for a backend. |
| Organization membership | Unknown | No independently verifiable backend membership assertion or revocation contract was established for this app. Auth0 customer identities are separate from operators. |
| App-scoped storage | Partially verified | `packages/shell/src/workspace/workspaceStore.ts` uses `fsReadJson`/`fsWriteJson`; `docs/agents/context/ROCKETRIDE_APPS.md` describes workspace storage. Organization-wide record authorization, concurrency and retention for support data were not established. |
| Server-side authorization | Partially verified | Engine authenticates the shell connection (`packages/shell/src/connection/ConnectionContext.tsx`); a SupportPilot-specific record enforcement point is not present. A separate authenticated service is the proposed point, not yet implemented. |
| Pipeline execution | Verified locally at source level | `src/App.tsx` uses `client.use`, `getTaskPipeline`, `chat`, and `terminate`; `src/operations.ts` uses `client.tool` with `tool_auth0_1`. SDK contract: `docs/agents/context/ROCKETRIDE_typescript_API.md`. No redesigned live run was performed. |
| Execution tracing | Partially verified | `pipelineTraceLevel: 'metadata'` requests engine traces; graph timing and step state are browser-observed, not internal tool telemetry (`src/investigation.ts`, `src/InvestigationWorkspace.tsx`). The SDK has trace APIs; this graph does not ingest tool trace events. |
| Credential isolation | Unknown | `src/investigation.pipe` refers to engine environment variables and sets `allowWrite: false`; this avoids embedding values but does not establish per-organization secret isolation on an installed engine. Verify deployment-specific secret controls and scopes. |
| Marketplace packaging | Partially verified | `.rrapp` contains the app ID, `package.json` contains `appManifest`, and `rsbuild.config.mts` exposes `./AppDescriptor`. Local `rocketride app verify` passed, with a local-namespace warning. No installation, deployment, or store review verified. See `docs/marketplace-readiness.md`. |

## Execution chain and assumptions

The shell gives `App.tsx` a connected client. `client.use` starts or reuses `src/investigation.pipe` (a reused task may have older configuration); the graph invokes `client.tool` through `src/operations.ts`; `src/investigation.ts` validates, sequences and normalizes results; the workspace builds the graph and inspector from those observations. Errors from startup and SDK/tool responses are reduced to safe messages. Tool response success is not an independent engine trace confirmation. The graph's pending/running/completed labels are app-local SDK call boundaries; diagnostic warnings are UI-derived. Returned tool errors are tool-level responses. A local timeout is an unknown remote outcome, not cancellation; there is no automatic retry. `terminate` for isolated model tasks is best effort, not confirmed cancellation.

The production build imports both `.pipe` files as JSON. `dist/remoteEntry.js` is local build output, not proof of a served installation. The descriptor and manifest share `local.auth0-operations`; `local` must be replaced by a registered namespace for wider distribution. Shell and SDK are host singletons and the pnpm workspace can mask the standalone vendored dependencies. Auth0 and model secret references must exist on the target engine; startup may initialize the model even for direct reads. App Builder has not been run for this milestone.
