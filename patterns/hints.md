# hints

**Claim.** When every result ends with two or three runnable follow-on calls, with the ids from that result already filled in, an agent takes the next step without a reconnaissance call and without guessing parameter names. The hints are the server's opinion about what usually comes next, and they double as the only documentation the agent reads at the moment it matters.

**Without it.** Agents re-listed tools, called `get` to learn an id they had just been shown, and invented parameter shapes. Multi-step work stalled at each boundary.

**Evidence.** `repeated`. Present in twelve of the author's servers. Named in netsuite ADR-200 (reconnaissance tax), confluence ADR-500 (semantic hinting), google-workspace-mcp's formatting layer, and jira-cloud's per-entity hint functions. Two placeholder spellings grew up independently, `$name` in Atlassian and `<name>` in Google; this package resolves both.

**Adopt.**

```ts
import { createHints } from '@aaronsb/mcp-component-hints';

const hints = createHints({
  'issue.get': [
    { description: 'Comment', tool: 'manage_issue', example: { operation: 'comment', issueKey: '$issueKey' } },
  ],
});

return { text: renderIssue(issue) + hints('issue.get', { issueKey: issue.key }) };
```

The queue component strips per-step hint blocks and keeps only the last success's, so hints compose with batching.

**Not for.** Exhaustive documentation. Three hints is the ceiling; past that the block is noise the agent skims.
