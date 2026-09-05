# cache

**Claim.** A record the agent has already seen comes back as one line saying it is unchanged, or as a focused diff of what changed, when the server keeps a session cache keyed by the source's own modification stamp. The agent's context stops filling with copies of the same record, and the API budget stops paying for them.

**Without it.** Search, detail, analyse, and enrich on the same opportunity sent the same fifty fields four times. Daily API limits were spent on unchanged data.

**Evidence.** `observed`, salesforce ADR-102 (three tiers: metadata by TTL, records by `SystemModstamp` epoch with a cheap stamp-only query to check, query results by short TTL because new matches cannot be detected by record stamps; `refresh` and `since` as agent-side signals). The textpad and Google scratchpad use a tool-call epoch for expiry, which is the same clock applied to buffers.

**Adopt.** Page only. Cache records by `{type}:{id}` with the source's modification stamp. Before returning a cached record, fetch only the stamps for the ids in hand. Return `unchanged since` for a match, a delta line for a change, a tombstone for a deletion. Give queries a short TTL and be honest that a cached query cannot see new rows. Expose `refresh: true`.

**Not for.** Sources without a modification stamp, where the cache cannot know it is stale.
