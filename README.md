# atlassian-mcp

An [MCP](https://modelcontextprotocol.io) server for Atlassian Cloud.

- **Jira** — wraps the official Atlassian CLI (`acli`). The server shells out to your locally installed, already-authenticated `acli`.
- **Confluence** — the official `acli` has no Confluence commands, so Confluence is served through the **Confluence Cloud REST API** using the *same* email + API token.

Auth is **API-token only**. The server itself performs no login flow:
- Jira relies on `acli`'s own stored session (`acli jira auth login`).
- Confluence uses `ATLASSIAN_EMAIL` + `ATLASSIAN_API_TOKEN` (the same token works for both products).

## Requirements

- Node.js >= 20
- [Atlassian CLI `acli`](https://developer.atlassian.com/cloud/acli/) installed and authenticated:
  ```sh
  acli jira auth login --site "your-site.atlassian.net" --email "[email protected]" --token
  ```
- An Atlassian API token (create one at <https://id.atlassian.com/manage-profile/security/api-tokens>) for Confluence.

## Install & build

```sh
npm install
npm run build
```

## Configuration

Confluence needs three environment variables (Jira does not — it uses `acli`'s stored login):

| Variable | Required | Description |
| --- | --- | --- |
| `CONFLUENCE_SITE` | for Confluence | e.g. `your-site.atlassian.net` |
| `ATLASSIAN_EMAIL` | for Confluence | Atlassian account email |
| `ATLASSIAN_API_TOKEN` | for Confluence | Atlassian API token |
| `ACLI_PATH` | no | Path to the `acli` binary (default `acli`) |
| `ACLI_TIMEOUT_MS` | no | acli subprocess timeout (default `120000`) |
| `ATLASSIAN_MCP_READ_ONLY` | no | `true` disables all write/destructive tools |

The Jira tools work even if the Confluence variables are unset; the Confluence tools return a clear error until they are set.

## Use with an MCP client

Point your client (Claude Desktop, Claude Code, etc.) at the built server:

```json
{
  "mcpServers": {
    "atlassian": {
      "command": "node",
      "args": ["/absolute/path/to/atlassian-mcp/dist/index.js"],
      "env": {
        "CONFLUENCE_SITE": "your-site.atlassian.net",
        "ATLASSIAN_EMAIL": "[email protected]",
        "ATLASSIAN_API_TOKEN": "your_api_token"
      }
    }
  }
}
```

`acli` must be on the `PATH` of the process that launches the server (or set `ACLI_PATH`), and its stored credentials must be readable by that user.

For local testing you can load a `.env` file with Node's built-in flag:

```sh
node --env-file=.env dist/index.js
```

## Tools

### Jira (via acli)

| Tool | Description |
| --- | --- |
| `acli_run` | Run **any** `acli` command — the complete acli surface (jira, admin, ...). |
| `jira_workitem_view` | View a work item by key. |
| `jira_workitem_search` | Search work items with JQL. |
| `jira_workitem_create` | Create a work item. |
| `jira_workitem_edit` | Edit a work item. |
| `jira_workitem_transition` | Transition a work item to a new status. |

The typed Jira tools are conveniences for common operations. For anything else — boards, sprints, filters, dashboards, fields, projects, admin — use `acli_run` (e.g. `["jira","sprint","--help"]`). The typed tools also accept `extraArgs` to pass additional raw flags.

### Confluence (via REST API)

| Tool | Description |
| --- | --- |
| `confluence_request` | Call **any** Confluence REST endpoint (path relative to `/wiki`). |
| `confluence_space_list` | List spaces (optionally by key). |
| `confluence_page_get` | Get a page (with body). |
| `confluence_search` | Search content with CQL. |
| `confluence_page_create` | Create a page (by `spaceId` or `spaceKey`). |
| `confluence_page_update` | Update a page (auto-increments version). |
| `confluence_page_delete` | Delete a page. |

Use `confluence_request` for anything not covered by a typed tool (attachments, comments, labels, blog posts, etc.).

## Read-only mode

Set `ATLASSIAN_MCP_READ_ONLY=true` to disable writes: typed write tools are blocked, `confluence_request` rejects non-`GET` methods, and `acli_run` rejects commands whose verb looks mutating (best-effort).

## Development

```sh
npm run dev        # run from source with tsx
npm run typecheck  # type-check only
npm run build      # emit dist/
```
