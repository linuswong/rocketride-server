# Marketplace readiness checklist

Milestone 6: blocked. Independently verifiable delegated identity and current membership, server authorization, durable hosting and operations, real installation, App Builder verification, and authorized live testing are not established. The `local` namespace is not a public listing identity. See [identity investigation](architecture/identity-contract-investigation.md) and [deployment](deployment.md).

Status: preparation only; independent installation and publication have not been verified.

- [x] Local source precheck: `node packages/client-typescript/dist/cli/packages/client-typescript/src/cli/rocketride.js app verify apps/auth0-operations-ui` passed on 2026-11-18 (source pack); this is a local pack precheck, not a build, engine compatibility check, install or security review.
- [x] Manifest, descriptor ID and bundled `.pipe` imports inspected; local production build emits `dist/remoteEntry.js`.
- [ ] Register an appropriate developer namespace and reconcile app identity, display name, icon, version and onboarding. `local.auth0-operations` is reserved for local use.
- [ ] Verify catalog eligibility: `tool_auth0` is experimental and must be confirmed as a shipped catalog node before a store app can rely on it. Confirm all other node schemas and target-engine compatibility; do not ship local nodes for the store.
- [ ] Independently install from a clean workspace/target engine; verify source pack, dependencies, shell Module Federation compatibility, install permissions, version updates and rollback. Local workspace overrides can hide missing vendored packages.
- [ ] Establish engine secret provisioning, least-privilege Auth0 scopes and per-installation isolation; never bundle secrets. Verify configuration placeholders and target tenant mapping.
- [ ] Identify the operator identity authority, trusted membership source, backend host, database, provisioning, isolation, encryption, retention/deletion and incident owner. None is currently provisioned.
- [ ] Run genuine App Builder preview and authorized non-production end-to-end smoke test, with AI off. Confirm model-provider policy and charges separately before enabling AI.
- [ ] Complete security, privacy, accessibility, packaging and platform review and write installation, configuration, support and removal documentation. Do not claim marketplace readiness or publication until independent installation succeeds.

The app can demonstrate fictional memory-only workflows in the shell. Shared, durable, authorized tickets require a separately trusted service unless a suitable verified platform service is found. No hosting or provisioning arrangement has been selected.

