# capabilities

**Claim.** A resource that describes what the server can do, read once, replaces the reconnaissance an agent otherwise performs on every task: which record types exist, which fields are writable, how a human name resolves to an id. Tool descriptions name the resource, so the agent reads it first instead of probing.

**Without it.** "Find overdue invoices" cost three metadata calls before the query. Every conversation re-derived the schema. Custom-field writes failed because the agent could not know that a field wanted an id where it had a name.

**Evidence.** `repeated`. netsuite ADR-200 (`netsuite://capabilities` and a per-record fields template, warmed at startup, degrading to a curated list when the role lacks metadata access), jira-cloud (`jira://capabilities` for field routing and `jira://custom-fields/{project}/{type}` for what is settable), salesforce ADR-300 (a field catalog resource ranked by usage). The Atlassian conformance to this shape is in ADR-214.

**Adopt.** Page only. Register one resource with a stable URI that renders a markdown document: what the server does, the id forms it accepts, the resolution rules, and where to read more. Add resource templates for per-entity detail. Warm it in the background at startup and cache with a TTL. Put the URI in every tool description that would otherwise need the knowledge.

**Not for.** Tool discovery across many servers, which the MCP `searchTools` proposals address. This is one server describing its own domain.
