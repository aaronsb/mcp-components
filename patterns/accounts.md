# accounts

**Claim.** When the account lifecycle is a tool, an agent can get a user from nothing to an authorised session without the user leaving the conversation: `authenticate` opens the browser, `status` says what the token can do in plain words, `scopes` narrows or widens it, `remove` cleans up. Credentials live where the platform expects them and never appear in a tool result.

**Without it.** Users ran a vendor CLI, pasted tokens into config files, and could not tell which of three accounts a server was using. A read-only request silently received write scopes because the provider had no read-only form for one service, and nobody found out until the agent edited something.

**Evidence.** `observed`, in one server with the fullest form. google-workspace-mcp ADR-200 (the unified lifecycle tool) and ADR-202 (per-account access level, granted scopes recorded, the stop-before-the-browser confirmation). The registry-plus-credential-file layout matches what `gh` and `gcloud` do in Go. This package makes the provider a value: endpoints, scope sets, and an identify function, so Atlassian and Microsoft plug in beside Google.

**Prior art.** [oauth-callback](https://github.com/kriasoft/oauth-callback) covers loopback capture with per-account files. [openid-client](https://github.com/panva/openid-client) is the certified exchange; this package speaks the code flow with PKCE directly in about sixty lines and leaves the door open to swap the exchange in. Keychain storage through [@napi-rs/keyring](https://www.npmjs.com/package/@napi-rs/keyring) is the next step when tokens should leave the disk. See [docs/prior-art.md](../docs/prior-art.md).

**Adopt.**

```ts
import { AccountManager, CredentialStore, createAccountsHandler, accountsInputSchema, identifyByUserinfo } from '@aaronsb/mcp-component-accounts';

const provider = {
  name: 'google',
  authUrl: 'https://accounts.google.com/o/oauth2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  authParams: { access_type: 'offline', prompt: 'consent' },
  baseScopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email'],
  scopeSets: { gmail: ['https://www.googleapis.com/auth/gmail.modify'] },
  readonlyScopeSets: { gmail: ['https://www.googleapis.com/auth/gmail.readonly'] },
  identify: identifyByUserinfo('https://www.googleapis.com/oauth2/v3/userinfo'),
};
const manager = new AccountManager({ provider, store: new CredentialStore({ appName: 'my-mcp' }), clientId, clientSecret });
handlers.manage_accounts = createAccountsHandler({ manager, hints });
const token = await manager.tokens.getAccessToken(email);   // in every API call
```

**Not for.** Remote MCP servers, where the MCP authorization spec and the SDK's provider interface apply. Service accounts and API tokens, which need the store and registry and none of the flow.
