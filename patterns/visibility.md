# visibility

**Claim.** A tool the user has switched off does not appear in `tools/list`. An agent plans from what it can see, so hiding a disabled action is what stops it from planning around a call that would only be refused. The most dangerous actions are off at every layer by default and need two deliberate switches before an agent can reach them.

**Without it.** Agents saw `delete`, called it, received a permission error, and tried a different route. Users had no view of what an agent could do to their vault until it did it.

**Evidence.** `observed`, obsidian ADR-101 (a flat `operation.action` visibility map, missing keys default to on, rendered as a tree in settings) and ADR-204 (command execution behind three gates: enumeration opt-in, permission mode, and an allowlist of exact command ids, with the handler re-checking so a hidden tool cannot be called into). The guardrails component's policy chain is the runtime half of the same idea.

**Adopt.** Page only. Keep a visibility map keyed by `operation.action`. Filter `tools/list` and the operation enum in each tool schema through it. Re-check in the handler. Keep a small set of opt-in actions that enumerate only when explicitly enabled, and give those a second gate that names exactly what they may touch.

**Not for.** Multi-tenant authorisation. This is a user's local control over a local server.
