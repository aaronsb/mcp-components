---
status: Accepted
date: 2026-09-05
deciders:
  - aaronsb
related:
  - ADR-001
---

# ADR-002: Conformance against a pinned SDK and a vendored spec schema

## Context

The components never touch the wire. They produce tool input schemas and result text. What decides whether a server built from them still works after an update is the SDK version the server runs and the protocol schema the client validates against. A submodule of the spec repository was considered as the way to hold a known version.

## Decision

Pin `@modelcontextprotocol/sdk` as an exact dev dependency at the root. Vendor the spec's `schema.json` under `packages/conformance/spec/<protocol-version>.schema.json` for the protocol version the pinned SDK reports as latest.

A private `conformance` package stands up a reference server with every component wired, connects the SDK's client over an in-memory transport, and checks three things: every tool the components emit validates against the spec's `Tool` definition, every result validates against `CallToolResult`, and a pipeline across components runs end to end through the queue. The list of tool schemas is a file snapshot, so a change to any component's schema shows up as a diff.

## Consequences

- Bumping the SDK is one line and one test run. A new protocol version means vendoring its schema beside the old one and letting the test pick the version the SDK reports.
- No submodule. Cloning stays a plain `git clone`, and CI needs no submodule checkout.
- The reference server in `packages/conformance/src/server.ts` is the shortest complete example of the components composed, and a starting point for a new server.
- A server that swaps its own copy for a component can run the same fixtures against both before and after.
