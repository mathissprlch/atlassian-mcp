import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { atlassianGuard, respondAtlassian, type AtlassianHttpResponse } from "./atlassian.js";
import { config } from "./config.js";
import { acliResultToTool, isMutatingAcli, runAcli } from "./acli.js";
import { jiraRequest } from "./jira.js";
import { errorResult, WRITES_DISABLED_MSG } from "./util.js";

const respondJira = (res: AtlassianHttpResponse) => respondAtlassian(res, "Jira");

export function registerJiraTools(server: McpServer): void {
  server.registerTool(
    "acli_run",
    {
      title: "Run any acli command",
      description:
        "Run any Atlassian CLI (`acli`) command and return its output. Provide arguments as an array " +
        'WITHOUT the leading "acli" (e.g. ["jira","workitem","view","--key","ABC-1","--json"]). ' +
        "Covers every acli group (jira, admin, ...). Add --json for machine-readable output and --yes to " +
        'skip confirmation prompts. Use ["jira","--help"] or ["jira","workitem","--help"] to discover ' +
        "commands and flags. Requires acli to be installed and authenticated locally.",
      inputSchema: {
        args: z
          .array(z.string())
          .min(1)
          .describe('acli arguments, excluding the leading "acli".'),
      },
    },
    async ({ args }) => {
      if (!config.allowWrites && isMutatingAcli(args)) return errorResult(WRITES_DISABLED_MSG);
      return acliResultToTool(await runAcli(args));
    },
  );

  server.registerTool(
    "jira_request",
    {
      title: "Call any Jira Cloud REST API endpoint",
      description:
        "Escape hatch: make a raw request to the Jira Cloud REST API. `path` is relative to the site " +
        "root (e.g. '/rest/api/3/issue/ABC-1', '/rest/api/3/search'). This tool is unrestricted within " +
        "the API token's permissions, so a wrong path/method/body can damage or delete data. Non-GET " +
        "methods require ATLASSIAN_MCP_ALLOW_WRITES=true. Prefer typed jira_* tools or acli_run when " +
        "they cover what you need. Auth uses ATLASSIAN_SITE (or CONFLUENCE_SITE), ATLASSIAN_EMAIL and " +
        "ATLASSIAN_API_TOKEN.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
        path: z.string().describe("Path relative to the site root, e.g. '/rest/api/3/issue/ABC-1'."),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query string parameters."),
        body: z.unknown().optional().describe("JSON request body for POST/PUT/PATCH."),
      },
    },
    ({ method, path, query, body }) =>
      atlassianGuard(async () => {
        if (!config.allowWrites && method !== "GET") return errorResult(WRITES_DISABLED_MSG);
        return respondJira(await jiraRequest({ method, path, query, body }));
      }),
  );

  server.registerTool(
    "jira_workitem_view",
    {
      title: "View a Jira work item",
      description: "View a single Jira work item (issue) by key, e.g. ABC-123. Returns JSON.",
      inputSchema: {
        key: z.string().describe("Work item key, e.g. ABC-123."),
        extraArgs: z.array(z.string()).optional().describe("Extra raw acli flags to append."),
      },
    },
    async ({ key, extraArgs }) =>
      acliResultToTool(await runAcli(["jira", "workitem", "view", "--key", key, "--json", ...(extraArgs ?? [])])),
  );

  server.registerTool(
    "jira_workitem_search",
    {
      title: "Search Jira work items (JQL)",
      description: "Search Jira work items with a JQL query. Returns JSON.",
      inputSchema: {
        jql: z.string().describe("JQL query, e.g. \"project = ABC AND status = 'In Progress'\"."),
        limit: z.number().int().positive().max(1000).optional().describe("Maximum number of results."),
        extraArgs: z.array(z.string()).optional().describe("Extra raw acli flags to append."),
      },
    },
    async ({ jql, limit, extraArgs }) => {
      const args = ["jira", "workitem", "search", "--jql", jql];
      if (limit !== undefined) args.push("--limit", String(limit));
      args.push("--json", ...(extraArgs ?? []));
      return acliResultToTool(await runAcli(args));
    },
  );

  server.registerTool(
    "jira_workitem_create",
    {
      title: "Create a Jira work item",
      description:
        "Create a Jira work item (issue). Requires project, type and summary. Use extraArgs for fields " +
        "not covered here (e.g. --priority, --label, --parent).",
      inputSchema: {
        project: z.string().describe("Project key, e.g. ABC."),
        type: z.string().describe('Work item type, e.g. "Task", "Bug", "Story".'),
        summary: z.string().describe("Summary / title."),
        description: z.string().optional().describe("Description body."),
        assignee: z.string().optional().describe("Assignee account id or email."),
        extraArgs: z.array(z.string()).optional().describe("Extra raw acli flags to append."),
      },
    },
    async ({ project, type, summary, description, assignee, extraArgs }) => {
      if (!config.allowWrites) return errorResult(WRITES_DISABLED_MSG);
      const args = ["jira", "workitem", "create", "--project", project, "--type", type, "--summary", summary];
      if (description !== undefined) args.push("--description", description);
      if (assignee !== undefined) args.push("--assignee", assignee);
      args.push("--yes", "--json", ...(extraArgs ?? []));
      return acliResultToTool(await runAcli(args));
    },
  );

  server.registerTool(
    "jira_workitem_edit",
    {
      title: "Edit a Jira work item",
      description:
        "Edit fields on one or more Jira work items by key. Provide at least one change (summary, " +
        "assignee, or extraArgs).",
      inputSchema: {
        key: z.string().describe("Work item key, or comma-separated keys, e.g. ABC-123."),
        summary: z.string().optional().describe("New summary."),
        assignee: z.string().optional().describe("New assignee account id or email."),
        extraArgs: z.array(z.string()).optional().describe("Extra raw acli flags to append."),
      },
    },
    async ({ key, summary, assignee, extraArgs }) => {
      if (!config.allowWrites) return errorResult(WRITES_DISABLED_MSG);
      if (summary === undefined && assignee === undefined && (!extraArgs || extraArgs.length === 0)) {
        return errorResult("Nothing to change: provide summary, assignee, or extraArgs.");
      }
      const args = ["jira", "workitem", "edit", "--key", key];
      if (summary !== undefined) args.push("--summary", summary);
      if (assignee !== undefined) args.push("--assignee", assignee);
      args.push("--yes", "--json", ...(extraArgs ?? []));
      return acliResultToTool(await runAcli(args));
    },
  );

  server.registerTool(
    "jira_workitem_transitions",
    {
      title: "List available transitions for a Jira work item",
      description:
        "List the workflow transitions currently available on a Jira work item — the statuses you can " +
        "move it to from its present status, with each transition's id and target status name. acli has " +
        "no command for this, so this calls the Jira Cloud REST API (GET /rest/api/3/issue/{key}/transitions) " +
        "using ATLASSIAN_SITE (or CONFLUENCE_SITE), ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN. Read-only.",
      inputSchema: {
        key: z.string().describe("Work item key, e.g. ABC-123."),
        expand: z
          .string()
          .optional()
          .describe("Expand parameter; pass 'transitions.fields' to include each transition's input fields."),
        transitionId: z
          .string()
          .optional()
          .describe("If set, narrow the result to only this transition id."),
      },
    },
    ({ key, expand, transitionId }) =>
      atlassianGuard(async () => {
        const query: Record<string, string> = {};
        if (expand) query.expand = expand;
        if (transitionId) query.transitionId = transitionId;
        return respondJira(
          await jiraRequest({ path: `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, query }),
        );
      }),
  );

  server.registerTool(
    "jira_workitem_transition",
    {
      title: "Transition a Jira work item",
      description: 'Move one or more Jira work items to a new status, e.g. "In Progress", "Done".',
      inputSchema: {
        key: z.string().describe("Work item key, or comma-separated keys."),
        status: z.string().describe('Target status name, e.g. "Done".'),
        extraArgs: z.array(z.string()).optional().describe("Extra raw acli flags to append."),
      },
    },
    async ({ key, status, extraArgs }) => {
      if (!config.allowWrites) return errorResult(WRITES_DISABLED_MSG);
      const args = ["jira", "workitem", "transition", "--key", key, "--status", status, "--yes", "--json", ...(extraArgs ?? [])];
      return acliResultToTool(await runAcli(args));
    },
  );
}
