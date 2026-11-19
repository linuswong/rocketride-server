# Pipeline design

The existing Auth0 pipeline hosts the read-only node. The app starts it with the shell client, calls named allowlisted operations and performs dependency decisions locally. A unique exact email match or an explicit user ID leads to profile verification, then independent logs and brute-force block reads. Analysis uses a fresh verified tool-free model pipeline; it may receive filtered live evidence. It is not a separate Auth0 investigation. Search and log results are one page and search can be eventually consistent. A returned failure or block alone does not prove root cause.

Ticket triage, authorized knowledge retrieval and human-approved response drafting are planned independently executable workflows, not implemented pipelines. Adding them requires real source attribution, injection defenses and human approval before any outbound action.
