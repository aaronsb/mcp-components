# practices

An importable library of practices that seem to work when LLM agents call tools.

Each package on this shelf is one practice: a claim about what an agent does differently when the practice is present, the code that implements it, and tests that hold the claim. The practices were extracted from MCP servers in production use and carry an evidence line saying where and for how long. Nothing here is a framework. A server takes the packages it wants and ignores the rest.

## Packages

| Package | Practice |
|---------|----------|
| `@aaronsb/practice-core` | Shared result shape, next-steps block helpers, first-line summaries |
| `@aaronsb/practice-queue` | One call, many ordered steps, with references between steps and bail or continue on failure |

Every package carries the same version. A release tags the repo once and publishes every package.

## Reading a practice

Each practice has a page in [`patterns/`](./patterns) with four parts: the claim, what goes wrong without it, the evidence, and how to adopt it. The code lives in `packages/<name>` and its tests are the claim written as assertions.

## Development

```
npm install
npm test
npm run build
npm run release:patch   # bump all packages, tag, push; CI publishes
```

Publishing is by GitHub OIDC trusted publishing. Each package must be registered on npmjs.com against this repository and the workflow file `npm-publish.yml` before its first release.
