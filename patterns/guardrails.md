# guardrails

**Claim.** An agent asked to clean up will delete everything it can see, one call at a time, as fast as the tool answers. A sliding-window limit on destructive operations stops that after a handful and hands back a review link carrying every key it touched, and the agent takes the link. A policy chain in front of every write lets a deployment say "no deletes" or "drafts only" once, in one place, instead of in each tool.

**Without it.** Bulk deletes ran to completion before anyone could intervene. A safety rule lived in the one handler someone remembered to put it in, and the hand-registered tool beside it wrote freely.

**Evidence.** `repeated`. jira-cloud ADR-202 (the sliding window and the deflection to Jira's bulk UI), google-workspace-mcp ADR-104 and its safety policies (draft-only email, no-delete, read-only, per-account access), salesforce ADR-104. The Google server found its own gap: the scratchpad's send bypassed the policy layer until it was wired in by hand, which is why `beforeSend` exists on the textpad component.

**Adopt.**

```ts
import { SlidingWindowGuard, queueGuard, reviewDeflection, evaluatePolicies } from '@aaronsb/mcp-component-guardrails';

const guard = new SlidingWindowGuard({ limit: 3, deflect: reviewDeflection(keys => jqlUrl(keys), 'issues') });
// in a handler
const refusal = guard.check('delete', issueKey); if (refusal) return { text: refusal, blocked: true };
await client.delete(issueKey); guard.record('delete', issueKey);
// in the queue
runQueue(request, { handlers, guard: queueGuard(guard, classifyDestructive) });
// policies
const verdict = await evaluatePolicies(policies, { operation, params, account });
```

**Not for.** Authorisation. A guardrail shapes what a trusted agent does in a hurry. Who may do what belongs in the credential and its scopes.
