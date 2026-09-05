# workspace

**Claim.** When a server confines file I/O to one directory and returns file contents inline, an agent in a sandboxed host can still stage an attachment, read what it downloaded, and hand a file from one tool to another by name. The directory is the shared desk between tools: a download lands there, the textpad attaches from there, an upload reads from there.

**Without it.** Servers wrote to whatever path the agent typed. One wrote into a Google Drive mount and the sync client fought the write. Agents in Claude Desktop received a path they could not open and nothing else.

**Evidence.** `repeated`. google-workspace-mcp's executor (workspace, paths, file-output), confluence-cloud ADR-502 and jira-cloud ADR-211. The three copies agree on the forbidden roots, the cloud-mount patterns, per-segment sanitisation, and the symlink check after resolution. The text and image inline rules come from the Google copy.

**Adopt.**

```ts
import { Workspace, createWorkspaceHandler, workspaceInputSchema } from '@aaronsb/mcp-component-workspace';

const workspace = new Workspace({ appName: 'my-mcp' });   // $XDG_DATA_HOME/my-mcp/workspace, or $WORKSPACE_DIR
await workspace.ensure();
const out = await workspace.save('report.csv', buffer, 'text/csv');   // out.content is inline text
{ name: 'manage_workspace', inputSchema: workspaceInputSchema() }
handlers.manage_workspace = createWorkspaceHandler(workspace);
```

Use `workspace.safePath(name)` in any other tool that touches a file the agent named.

**Not for.** Persistent storage. The workspace is a staging area and nothing in it is promised to survive. Credentials go under the config directory through the accounts component.
