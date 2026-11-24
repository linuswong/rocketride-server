# tool_jira_service_management

An experimental RocketRide tool node for reading limited Jira Service Management Cloud customer request metadata.

## About Jira Service Management

Jira Service Management is Atlassian's service desk product for receiving and managing customer requests.

## What it does

The node exposes bounded, read-only request lookup and listing tools. It returns request keys, status, creation time, service desk ID and request type ID, and can optionally return the summary of one selected request; it does not expose descriptions, comments, or customer identities. It supports Atlassian Cloud tenant hosts only, not self-managed Jira.

## As a tool

`get_request` reads one request by issue key or numeric ID. `include_summary: true` opts in to its plain-text summary, bounded to 255 printable characters; the field is `null` when Jira omits it. It supports Jira's top-level summary and request-field summary and rejects conflicting values. The summary is untrusted customer data, may contain personal information, and must not be used to establish the affected account or authorize a case. It is not included by default. `list_requests` reads one bounded page visible to the configured Jira account and never returns summaries; a short page or an empty result does not prove that other requests do not exist. Returned metadata is length-bounded and must be printable; malformed fields fail rather than being silently truncated. Both return `success` and either selected metadata or a sanitized error. For HTTP 429 and 503, a numeric `Retry-After` up to 86,400 seconds is returned as `retry_after_seconds` with `retryable: true`; missing, invalid or larger values are omitted. The node never retries automatically. The tools do not write comments or change requests.

The request list validates and returns Jira's `start`, effective `limit`, `size`, and last-page flag, and rejects duplicate issue keys within the page. A provider response that omits or contradicts these fields fails instead of asserting an unverified page position. The result is still subject to Jira permissions and concurrent changes.

## Configuration

Choose the authentication mode. For a classic API token, supply the Atlassian Cloud hostname, an ASCII account email, and a RocketRide environment reference such as `${ROCKETRIDE_JIRA_API_TOKEN}`. For a scoped API token, supply the account email, the site's lowercase Cloud ID and the API-token reference. For OAuth, supply the hostname, Cloud ID and a reference such as `${ROCKETRIDE_JIRA_ACCESS_TOKEN}` to an already obtained access token. Clear the other mode's token field. References must remain visible in pipeline configuration for environment substitution; wrapping a reference in an encrypted `secureParameters` token can leave it unresolved. Startup rejects unresolved references. The configured account's Jira permissions determine which requests can be read. Provision and isolate credentials per authorized installation.

## Authentication

Both API-token modes use HTTP Basic credentials and are intended for personal scripts or development. Classic tokens use the configured `*.atlassian.net` site; scoped tokens use Atlassian's fixed API gateway and Cloud ID. The scoped-token mode does not verify a hostname-to-Cloud-ID mapping; a trusted installer must bind the chosen Cloud ID to the authorized site. OAuth mode uses an externally obtained OAuth 2.0 access token against the API gateway. Before each Jira read it checks `accessible-resources` for exactly one resource matching the configured Cloud ID and `*.atlassian.net` hostname and granting the classic `read:servicedesk-request` scope, or both `read:request:jira-service-management` and `read:user:jira`. Atlassian states that different containers can share a Cloud ID; entries without the required Jira scopes do not establish Jira access. The check confirms the token's site and scope grant, not the operator's current Jira permissions or authorization in RocketRide. Missing, ambiguous or invalid resource data fails closed. All modes use HTTPS and do not follow redirects.

The node does not implement the OAuth authorization flow, token refresh, secure provisioning or delegated RocketRide operator identity. A trusted integration must obtain and rotate tokens, bind the selected Jira site to the authorized RocketRide tenant, and authorize each case operation. Atlassian's app requirements prohibit asking customers to provide API tokens or create individual OAuth apps for a distributed integration. This node alone is not a production onboarding flow.

## Notes

Each HTTP response is limited to 1 MiB. Invalid JSON, duplicate object fields, non-JSON numeric constants and excessive nesting fail with a sanitized error. A 45-second elapsed read budget is checked after receiving the response and each chunk. An individual blocked network operation can run until its connect or read timeout, so this is not a remote cancellation guarantee.

This is an experimental read-only connector and has not been verified against a live Jira tenant. LoginLens must not attach it to real cases until a trusted server-side authorization and tenant binding exists. Request fields and error messages are untrusted. No support-system write or automatic notification is implemented.

An offline RocketRide engine fixture staged this node with its own requirements file, confirmed local service discovery, and exercised request lookup, listing, rate-limit handling, rejection of mismatched requests and contradictory pages, and resolution of fictional environment references through the SDK using the local dependency cache. This does not verify a clean installation with an empty cache or a live Jira tenant.

The [example pipeline](example.pipe) hosts the node behind a Tools source for direct SDK calls. It uses environment references and requires an externally managed OAuth token. Starting a task or attaching this pipeline does not supply per-case authorization, implement OAuth onboarding, or establish a Jira-to-Auth0 account link.

## Upstream docs

- [Jira Service Management Cloud request API](https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/)
- [Atlassian API token authentication](https://developer.atlassian.com/cloud/jira/service-desk/basic-auth-for-rest-apis/)
- [Atlassian scoped API tokens](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)
- [Atlassian OAuth 2.0 apps and site access](https://developer.atlassian.com/cloud/jira/service-desk/oauth-2-authorization-code-grants-3lo-for-apps/)
- [Jira Cloud rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)

---

<!-- ROCKETRIDE:GENERATED:PARAMS START -->
<!-- ROCKETRIDE:GENERATED:PARAMS END -->
