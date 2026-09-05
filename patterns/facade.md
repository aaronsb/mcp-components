# facade

**Claim.** Every entity the server returns goes through one rendering facade that emits markdown shaped for an agent: a header line with the identity and key fields, ids on every row so the next call can address them, counts in place of lists past a limit, and a breadcrumb naming the opt-in that reveals more. Content reads stay faithful to the source. Results and confirmations stay concise.

**Without it.** Raw JSON consumed half the context window with nulls and nesting. Fifty-record searches produced thousands of tokens of structure. Agents parsed instead of read. Or the opposite failure: a note read back "helpfully" reformatted, so a later edit no longer matched the file.

**Evidence.** `repeated`. obsidian ADR-003 (the presentation facade, 50 to 70 percent smaller than JSON) and ADR-203 (faithful-by-default reads under a character budget, concise-by-default results, `raw: true` as the opt-in), salesforce ADR-100 (markdown rendering with `detail` and `expand`), jira-cloud ADR-214 (rich sections opt-in through `expand`, a one-line breadcrumb otherwise), confluence ADR-500.

**Adopt.** Page only, with the primitives in `@aaronsb/mcp-component-core`. One renderer per entity in a `rendering/` module. A header line first. Pipe-delimited rows for lists with the id in the first column. Sections that cost tokens are off by default and named in an `expand` enum. When a section is hidden, one line says what is there and how to get it. For content the agent may later edit, return bytes as stored and page by a character budget on whole-line boundaries. The queue and hints components assume this shape.

**Not for.** Numeric data the agent will compute over; return a compact table or a resource the agent can load whole.
