# queue

**Claim.** Given one tool that accepts an ordered list of steps, an agent will plan a short pipeline and submit it in one call instead of narrating one call per step. With `$N.field` references it threads a created id into later steps without reading it back. With `onError` it states up front whether a failure should stop the run, and the report tells it exactly which steps ran, failed, or were skipped.

**Without it.** Five related writes cost five round trips and five chances to lose the plan between them. When one step failed mid-sequence, the agent often carried on with a stale id or re-ran steps that had succeeded. A refused destructive step that returned instead of throwing was counted as a success, and a queue reported "2/2 succeeded" having written nothing.

**Evidence.** `repeated`. Arrived at separately in google-workspace-mcp (ADR-203 Operation Queue, ADR-308 queue and batch modes, ADR-104 destructive guardrails) and in jira-cloud and confluence-cloud (ADR-203 Operation Queue, ADR-202 guardrails). In use since early 2026. Reconciled here: structured refs from Google, the guardrail hook and text-extraction fallback from Jira. The Confluence copy passed unresolvable references through as literal strings; that was a silent failure and is dropped.

**Prior art.** [SEP-1610](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1610) states the design at the protocol level with abort-only failure and no implementation. [callmux](https://github.com/edimuj/callmux) is the nearest code, with positional pipeline mapping and no error strategy. See [docs/prior-art.md](../docs/prior-art.md).

**Adopt.**

```ts
import { runQueue, queueInputSchema, nestedQueueHandler } from '@aaronsb/mcp-component-queue';

const options = { handlers, guard, maxOperations: 16 };
handlers.queue_operations = nestedQueueHandler(options);   // a queue may hold a queue

// tool definition
{ name: 'queue_operations', inputSchema: queueInputSchema(Object.keys(handlers)) }

// tool call
const report = await runQueue(args, options);
return toMcp(report);
```

Handlers return `StepResult` from `@aaronsb/mcp-component-core`. Return `refs` for anything a later step should be able to address. Return `blocked: true` when a policy declines a step.

**Not for.** Operations the vendor can batch in one HTTP call. That is a different shape, one tool and one operation across many items, with no ordering or references between them. Give it its own mode rather than borrowing this one.
