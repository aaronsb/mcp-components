---
status: Accepted
date: 2026-09-04
deciders:
  - aaronsb
---

# ADR-001: One monorepo, one version, the component as the unit

## Context

The same agent-facing layers were hand-copied across a dozen MCP servers: next-step hints, a scratchpad buffer, a batch executor, workspace file staging, operation-dispatch tools, a capabilities resource, progressive reveal, rendering facades. Each copy drifted. Jira and Confluence each carried a separate ADF pipeline, and every gap hit in one server was already solved in another.

The layers are not MCP-specific. They are practices an agent reasons well with, observed across servers.

The framing behind the repo: an MCP server is the front-end application in a client/server relationship, and the protocol's primitives are its atomic elements, tools as controls, resources as views, elicitation as dialogs. Most published servers are API wrappers assembled straight from those primitives. The servers this repo draws from are built as applications, and what they share is a middle layer of composable components between the primitives and the finished server, the way an editor has find, formatters, and help between its widgets and the product. This repo is that middle layer.

## Decision

One repository, `mcp-components`, holding one package per component under `packages/`, with a thin `core` for the shared result shape. Every package carries the same version. A release bumps them together, tags once, and CI publishes every package by OIDC trusted publishing.

The unit is the component: a page in `patterns/` stating the claim and its evidence, the code, and tests that encode the claim. A component can be retired when the evidence turns.

Packages depend on `core` and on nothing else on the shelf. Clients, auth, and tool schemas stay in the servers.

## Consequences

- A server adopts one package in an afternoon and is not pulled into the rest.
- Lockstep versioning means a change to one package bumps all. The cost is noise in version numbers. The benefit is one tag, one publish, and no matrix of compatible versions.
- Each package must be registered as a trusted publisher on npmjs.com before its first release. The workflow filename `npm-publish.yml` is part of that registration.
- Extraction order follows maturity: the queue executor first, then the scratchpad, the tool factory, and the local OAuth flow.
