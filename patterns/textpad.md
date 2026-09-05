# textpad

**Claim.** Given a line-addressed buffer with `view`, `insert_lines`, `replace_lines`, and `remove_lines`, an agent composes long content in small calls and reviews it before anything leaves the server. Every mutation answers with the edit site in context and a one-line validation status, so a broken fence or an unbalanced brace is caught at the edit that made it. Sending is a separate step against a target the agent names then, or one bound when the buffer was created, and a failed send leaves the buffer in place for a retry.

**Without it.** Agents wrote whole documents into one tool argument, could not fix a paragraph without resending everything, and lost the draft when the write failed. Structural errors surfaced only from the vendor API, without a line number. Nodes the text form could not express, such as macros or raw document JSON, were destroyed on the round trip.

**Evidence.** `repeated`. Two lineages arrived at the same buffer independently: google-workspace-mcp (ADR-301 service-agnostic authoring with late-bound targets, ADR-302 format-aware validation) and confluence-cloud (ADR-304 line-addressed authoring with a raw-node side table). This package is their union: line operations, formats and validators, JSON path edits, attachments by reference, a generic side table, a target stored at creation or named at send, and an injectable expiry clock, since one server counts tool calls and the other wall time.

**Prior art.** Anthropic's text editor tool spec supplies the operation vocabulary against files, with no send step. [adeu](https://github.com/dealfluence/adeu) is the one published side-table implementation and is docx-specific. See [docs/prior-art.md](../docs/prior-art.md).

**Adopt.**

```ts
import { TextpadManager, createTextpadHandler, textpadInputSchema } from '@aaronsb/mcp-component-textpad';

const manager = new TextpadManager({ expiry: { now: getEpoch, maxAge: 100 }, validators: { adf: validateDirectives } });
const handler = createTextpadHandler({
  manager,
  send: { email: sendEmail, page: publishPage },
  import: { doc: importDoc },
  resolveAttachment: resolveWorkspaceFile,
  beforeSend: checkWritePolicy,
});

// tool definition
{ name: 'textpad', inputSchema: textpadInputSchema({ sendTargets: ['email', 'page'], importSources: ['doc'] }) }
```

A send adapter reads `manager.getContent(id)`, `getAttachments(id)`, and `getSideTable(id)`, and returns a `StepResult`. Return `isError` to keep the buffer alive.

**Not for.** Structured records with a schema, where a form-shaped tool with typed parameters is the better control. Live mirrors of a remote document that must sync on every edit: hang that on `afterMutation` and keep the sync logic in the server.
