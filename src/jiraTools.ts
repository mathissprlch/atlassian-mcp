import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";
import { acliResultToTool, isMutatingAcli, runAcli } from "./acli.js";
import { errorResult, READ_ONLY_MSG } from "./util.js";

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
      if (config.readOnly && isMutatingAcli(args)) return errorResult(READ_ONLY_MSG);
      return acliResultToTool(await runAcli(args));
    },
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
      if (config.readOnly) return errorResult(READ_ONLY_MSG);
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
      if (config.readOnly) return errorResult(READ_ONLY_MSG);
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
      if (config.readOnly) return errorResult(READ_ONLY_MSG);
      const args = ["jira", "workitem", "transition", "--key", key, "--status", status, "--yes", "--json", ...(extraArgs ?? [])];
      return acliResultToTool(await runAcli(args));
    },
  );
}
