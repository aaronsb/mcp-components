# dispatch

**Claim.** One tool per entity with an `operation` enum, rather than one tool per verb, keeps the tool list short enough to reason over and puts every action on an entity under one name the agent already holds. Parameters shared across operations are declared once, and the description says which operation needs which.

**Without it.** Tool lists ran past fifty and selection accuracy fell. Agents confused `create_issue_comment` with `create_comment_on_issue` across servers.

**Evidence.** `repeated`. confluence ADR-101 (the operation-dispatch surface), jira-cloud ADR-200 (LLM-facing tool design principles), google-workspace-mcp ADR-300 (the factory generates exactly this shape), obsidian's `operation.action` naming. The factory component produces it from a manifest; the Atlassian servers write it by hand.

**Adopt.** Page only, or through the factory. Group by entity. Keep the enum under about a dozen operations before splitting a tool. Validate the operation first and answer an unknown one with the valid list. Keep parameter names stable across operations so the agent's learned shape carries over.

**Not for.** Operations whose parameter sets share nothing; a tool with twenty optional parameters that each apply to one operation is worse than two tools.
