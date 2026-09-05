# mcp-components

Composable components for MCP servers built as applications, extracted from servers in daily use.

An MCP server is the front end. The protocol's primitives are its atomic elements: a tool is a control, a resource is a view, elicitation is a dialog. A server assembled straight from those is the equivalent of a form built from raw widgets, and most servers stop there, as thin wrappers over an API. Between the primitives and a finished server sits a middle layer, the components a text editor or a mail client would take for granted: a batch runner, a draft buffer, next-action affordances, an account manager, a curated view of a large API. This repo is that layer. Each package is one such component, with the claim it makes about agent behaviour, the code, and the tests that hold the claim.

## Packages

| Package | Component |
|---------|----------|
| `@aaronsb/mcp-component-core` | Shared result shape, next-steps block helpers, first-line summaries |
| `@aaronsb/mcp-component-queue` | One call, many ordered steps, with references between steps and bail or continue on failure |
| `@aaronsb/mcp-component-textpad` | A line-addressed buffer the agent composes in, validated per edit, sent to a target chosen late |
| `@aaronsb/mcp-component-hints` | Next-step hints under every result, with the current ids filled in |
| `@aaronsb/mcp-component-workspace` | One jailed directory for file staging, with inline text and image reads |
| `@aaronsb/mcp-component-guardrails` | A sliding-window limit on destructive writes and a composable policy chain |
| `@aaronsb/mcp-component-accounts` | Local OAuth with PKCE and a loopback redirect, an XDG credential store, a multi-account registry, and the lifecycle as a tool |
| `@aaronsb/mcp-component-factory` | Operation-dispatch tools generated from a curated manifest over an API descriptor, with per-service patches and a subset check |

Every package carries the same version. A release tags the repo once and publishes every package.

## Patterns without packages

Some shapes belong in a server's own code. Their pages carry the same claim, evidence, and adoption sections and link the ADRs where the shape is done in full.

| Pattern | What it settles |
|---------|-----------------|
| [capabilities](./patterns/capabilities.md) | One resource that describes the domain so the agent reads instead of probing |
| [facade](./patterns/facade.md) | Faithful content reads, concise results, ids on every row, breadcrumbs to more |
| [dispatch](./patterns/dispatch.md) | One tool per entity with an operation enum |
| [visibility](./patterns/visibility.md) | Disabled actions leave the tool list; dangerous ones need two switches |
| [cache](./patterns/cache.md) | Unchanged records come back as one line, keyed by the source's own stamp |
| [elicitation](./patterns/elicitation.md) | Intent-driven field selection, ranked discovery, and field search |

## Reading a component

Each component has a page in [`patterns/`](./patterns) with four parts: the claim, what goes wrong without it, the evidence, and how to adopt it. The code lives in `packages/<name>` and its tests are the claim written as assertions.

## Development

```
npm install
npm test
npm run build
npm run release:patch   # bump all packages, tag, push; CI publishes
```

The `conformance` package is the closed loop: a reference server with every component wired, driven through the pinned `@modelcontextprotocol/sdk` client over an in-memory transport, with every tool schema and result validated against the vendored spec schema for the SDK's protocol version. Its tool list is a file snapshot, so a schema change in any component shows as a diff. See ADR-002.

Publishing is by GitHub OIDC trusted publishing. Each package must be registered on npmjs.com against this repository and the workflow file `npm-publish.yml` before its first release.
