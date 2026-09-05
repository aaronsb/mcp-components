# factory

**Claim.** An API of two hundred methods becomes eight tools an agent can hold in mind when a manifest curates which operations exist, names them in the agent's vocabulary, and hides the constants it should never choose. The descriptor is the vendor's contract and the manifest is the server's opinion, and a build-time check that every manifest resource exists in the descriptor turns a typo into a failed build instead of a failed call. Patches overlay the exceptions per service: a hook that reshapes a request, a formatter that knows what a message looks like, hints that know what comes next.

**Without it.** One-to-one generators produced a tool per endpoint, and agents chose among hundreds of near-identical names. Hand-written handlers drifted from the API and from each other. Fixed request constants leaked into schemas as parameters the agent got wrong.

**Evidence.** `observed`, in one server at full depth. google-workspace-mcp ADR-300 (the three layers), ADR-103 (the descriptor mined from Google Discovery and the conformance check), ADR-303 (the factory frames, handlers produce). The operation-dispatch tool shape it generates is the one every Atlassian and Salesforce server writes by hand.

**Prior art.** [FastMCP](https://gofastmcp.com/integrations/openapi) has all three layers for Python and OpenAPI. Nothing in Node does, and no published generator checks the manifest against the descriptor. See [docs/prior-art.md](../docs/prior-art.md).

**Adopt.**

```ts
import { generateTools, validateManifest } from '@aaronsb/mcp-component-factory';

// descriptor: { has(service, method), call(service, method, params, ctx) } over OpenAPI, Discovery, or GraphQL
const tools = generateTools(manifest, { descriptor, patches, hints: (svc, op, ctx) => hints(`${svc}.${op}`, ctx), policy });
for (const t of tools) register(t.schema, async params => toMcp(await t.handler(params)));

// in CI
const errors = validateManifest(manifest, descriptor, patches); if (errors.length) fail(errors);
```

A manifest operation is `type`, `description`, `resource`, `params` with `maps_to`, `default`, `max`, `enum`, `client_only`, and `defaults` merged into the request. A patch is `beforeExecute`, `afterExecute`, `formatList`, `formatDetail`, `formatAction`, `hints`, and `customHandlers`.

**Not for.** APIs with a handful of methods, where the manifest is longer than the handlers it replaces. Tools whose value is composition across several calls; write those as custom handlers and let the factory frame them.
