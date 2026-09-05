# Prior art

Surveyed 2026-09-04 across npm, PyPI, GitHub, the MCP spec and registries, agent frameworks, and vendor tool generators. Question asked: is there an importable component for each practice, or only prose and in-product implementations?

Verdict: none of the practices exists as a reusable package. Pieces exist for each. The assembly does not.

## Response side

| Practice | Closest code | Adoption | Gap |
|----------|--------------|----------|-----|
| Next-step hints | [Agent-First Tool APIs](https://arxiv.org/html/2605.10555v2) defines a `next_actions` response field. Paper, no code. [mcp-action-guard](https://github.com/anon767/mcp-action-guard) filters tools by state. | 1 star | Nothing importable |
| Progressive reveal | [Anthropic tool guidance](https://www.anthropic.com/engineering/writing-tools-for-agents) recommends a concise/detailed enum and truncation messages that say how to fetch more. MCP `resource_link` is the substrate. | guidance | No library adds the breadcrumb |
| Capabilities resource | Stainless dynamic tools, Speakeasy Gram dynamic toolsets, GitHub MCP dynamic toolsets, [@cloudflare/codemode](https://github.com/cloudflare/agents/tree/main/packages/codemode), [MCP SEP #1888](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1888) | codemode ~486k/week | All are discovery meta-tools. None describes writable fields or name resolution |
| Rendering facades | [TOON](https://github.com/toon-format/toon) compact serializer | ~1.3M/week | Serializer only. No entity conventions |
| Operation dispatch | Prose, including the author's own practices guide | | Server convention, no library |

## Authoring side

| Practice | Closest code | Adoption | Gap |
|----------|--------------|----------|-----|
| Textpad | Anthropic `text_editor` tool spec supplies the op vocabulary. [adeu](https://github.com/dealfluence/adeu) is the only side-table implementation, docx-specific. [scratchpad-mcp-v2](https://github.com/pc035860/scratchpad-mcp) has line ops over SQLite. | adeu 152 stars, ~930/week | No in-memory buffer with a late-bound send target, a side table, and pre-submit validation |
| Queue | [callmux](https://github.com/edimuj/callmux) pipelines with positional mapping and a library entry point. [mcp-tool-chainer](https://github.com/thirdstrandstudio/mcp-tool-chainer) passes one result forward. [mcp-batchit](https://github.com/ryanjoachim/mcp-batchit) is parallel with stopOnError and no data passing. [SEP-1610](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1610) is the best prose statement, dormant. | all under 60 stars, under ~350/week | Nothing combines references, bail or continue, a depth cap, a pre-flight guardrail, and summary or full reporting |

## Factory and auth

| Practice | Closest code | Adoption | Gap |
|----------|--------------|----------|-----|
| Factory with overlay | [FastMCP](https://gofastmcp.com/integrations/openapi) has all three layers: `from_openapi`, `route_maps` and `mcp_names`, `ArgTransform` to hide constants, `transform_fn` for output. Python and OpenAPI only. Google ADK's `GoogleApiToolset` is the only Discovery-to-tools factory, 1:1. | FastMCP ~1.7M/day | No Node implementation. No manifest-is-subset-of-descriptor check anywhere. [API Evangelist](https://apievangelist.com/2026/08/11/openapi-overlays-for-mcp-and-ai-agent-enrichment/) and Redocly describe the overlay and ship nothing |
| Local OAuth | [oauth-callback](https://github.com/kriasoft/oauth-callback) does loopback capture with per-account file storage. [openid-client](https://github.com/panva/openid-client) and [@napi-rs/keyring](https://www.npmjs.com/package/@napi-rs/keyring) are the primitives for the exchange and the keychain. [mcp-remote](https://www.npmjs.com/package/mcp-remote) is a client shim, no registry. `@google-cloud/local-auth` was archived Feb 2026. | primitives well adopted; oauth-callback 11 stars | The multi-account registry, XDG layout, and agent-callable lifecycle exist only inside individual servers |

## What this changes

- Each component page cites the nearest prior art above so a reader can judge the gap.
- The OAuth component builds on openid-client for the exchange and offers the keychain through @napi-rs/keyring. Only the loopback listener, the registry, and the lifecycle tool are ours.
- The factory component targets descriptors, with OpenAPI, Google Discovery, and GraphQL introspection as adapters. The subset check is the part nobody has.
- The queue component names SEP-1610 as the spec direction and callmux as the nearest code.
