# elicitation

**Claim.** When the server accepts an intent instead of a field list, the agent asks for "pipeline" fields on an opportunity and gets the eight that matter out of two hundred, custom fields included, in one call. A lexical field search answers "which field says a deal involved AI" without the agent scanning a catalog. Discovery runs at startup, ranks fields by real population and quality signals, and promotes the useful ones into schemas and hints.

**Without it.** List objects, describe the guessed one, parse two hundred fields, build a query. Three calls and thousands of tokens before any work, and the guess was often wrong.

**Evidence.** `repeated`. salesforce ADR-103 (intent profiles generated from the field-type map), ADR-300 (startup discovery with a regulator stack: population, namespace penalty, label demotion, help-text boost, a knee-based promotion cutoff, and a catalog resource), ADR-302 (a pure ranking function over name, label, and help text with value enrichment). jira-cloud's field discovery and the scored-versus-unscored custom-field catalog in ADR-213 and ADR-214 are the same design on a different API.

**Adopt.** Page only for now; the ranking function and the regulator stack are candidates for a package once a second server needs them. Run discovery asynchronously at startup with bounded concurrency. Score fields with composable regulators that each return a delta and a reason. Cut at the knee with a hard cap. Expose the result as a resource, feed it into tool schemas and hints, and offer an `intent` parameter that selects fields from the profile.

**Not for.** Small, stable schemas where the field list fits in a tool description.
