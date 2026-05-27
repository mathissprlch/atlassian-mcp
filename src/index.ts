#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { registerJiraTools } from "./jiraTools.js";
import { registerConfluenceTools } from "./confluenceTools.js";

async function main(): Promise<void> {
  const server = new McpServer({ name: "atlassian-mcp", version: "0.1.0" });

  registerJiraTools(server);
  registerConfluenceTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const restState = config.atlassian
    ? "configured"
    : "NOT configured (set ATLASSIAN_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN)";
  const writesState = config.allowWrites
    ? "ENABLED"
    : "disabled (set ATLASSIAN_MCP_ALLOW_WRITES=true to enable)";
  console.error(
    `atlassian-mcp running (stdio). Jira via acli '${config.acliPath}' (jira_workitem_transitions uses REST). ` +
      `Atlassian REST ${restState}. Writes: ${writesState}.`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting atlassian-mcp:", err);
  process.exit(1);
});
