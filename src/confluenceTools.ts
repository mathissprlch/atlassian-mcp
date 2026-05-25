import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { confluenceRequest, resolveSpaceId, type ConfluenceResponse } from "./confluence.js";
import { errorResult, jsonResult, READ_ONLY_MSG, textResult } from "./util.js";

async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

function respond(res: ConfluenceResponse): CallToolResult {
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
    return errorResult(`Confluence API error: HTTP ${res.status}\n${detail}`);
  }
  if (res.data === "" || res.data === null || res.data === undefined) {
    return textResult(`Success (HTTP ${res.status}).`);
  }
  return jsonResult(res.data);
}

export function registerConfluenceTools(server: McpServer): void {
  server.registerTool(
    "confluence_request",
    {
      title: "Call any Confluence REST API endpoint",
      description:
        "Make a raw request to the Confluence Cloud REST API. `path` is relative to the site's /wiki base " +
        "(e.g. '/api/v2/pages', '/api/v2/spaces', '/rest/api/search'). Use v2 (/api/v2/...) for CRUD and " +
        "v1 (/rest/api/...) for CQL search. Auth uses the configured email + API token.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
        path: z.string().describe("Path relative to /wiki, e.g. '/api/v2/pages'."),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query string parameters."),
        body: z.unknown().optional().describe("JSON request body for POST/PUT/PATCH."),
      },
    },
    ({ method, path, query, body }) =>
      guard(async () => {
        if (config.readOnly && method !== "GET") return errorResult(READ_ONLY_MSG);
        return respond(await confluenceRequest({ method, path, query, body }));
      }),
  );

  server.registerTool(
    "confluence_space_list",
    {
      title: "List Confluence spaces",
      description: "List Confluence spaces, optionally filtered by space keys.",
      inputSchema: {
        keys: z.array(z.string()).optional().describe("Filter by space keys."),
        limit: z.number().int().positive().max(250).optional().describe("Maximum spaces to return."),
      },
    },
    ({ keys, limit }) =>
      guard(async () =>
        respond(await confluenceRequest({ path: "/api/v2/spaces", query: { keys: keys?.join(","), limit } })),
      ),
  );

  server.registerTool(
    "confluence_page_get",
    {
      title: "Get a Confluence page",
      description: "Get a Confluence page by id, including its body.",
      inputSchema: {
        id: z.string().describe("Page id (numeric string)."),
        bodyFormat: z
          .enum(["storage", "atlas_doc_format", "view"])
          .default("storage")
          .describe("Body representation to return."),
      },
    },
    ({ id, bodyFormat }) =>
      guard(async () =>
        respond(
          await confluenceRequest({
            path: `/api/v2/pages/${encodeURIComponent(id)}`,
            query: { "body-format": bodyFormat },
          }),
        ),
      ),
  );

  server.registerTool(
    "confluence_search",
    {
      title: "Search Confluence (CQL)",
      description: "Search Confluence content using CQL (Confluence Query Language) via the v1 search endpoint.",
      inputSchema: {
        cql: z.string().describe("CQL query, e.g. \"space = DOCS AND title ~ 'release'\"."),
        limit: z.number().int().positive().max(100).optional().describe("Maximum number of results."),
      },
    },
    ({ cql, limit }) =>
      guard(async () => respond(await confluenceRequest({ path: "/rest/api/search", query: { cql, limit } }))),
  );

  server.registerTool(
    "confluence_page_create",
    {
      title: "Create a Confluence page",
      description:
        "Create a Confluence page. Provide either spaceId (numeric) or spaceKey. Body defaults to the " +
        "'storage' representation (Confluence storage format / XHTML).",
      inputSchema: {
        spaceId: z.string().optional().describe("Numeric space id."),
        spaceKey: z.string().optional().describe("Space key (resolved to an id automatically)."),
        title: z.string().describe("Page title."),
        body: z.string().describe("Page body content."),
        representation: z
          .enum(["storage", "atlas_doc_format", "wiki"])
          .default("storage")
          .describe("Body format of `body`."),
        parentId: z.string().optional().describe("Parent page id."),
        status: z.enum(["current", "draft"]).default("current").describe("Page status."),
      },
    },
    ({ spaceId, spaceKey, title, body, representation, parentId, status }) =>
      guard(async () => {
        if (config.readOnly) return errorResult(READ_ONLY_MSG);
        if (!spaceId && !spaceKey) return errorResult("Provide spaceId or spaceKey.");
        const resolvedSpaceId = spaceId ?? (await resolveSpaceId(spaceKey as string));
        const payload: Record<string, unknown> = {
          spaceId: resolvedSpaceId,
          status,
          title,
          body: { representation, value: body },
        };
        if (parentId) payload.parentId = parentId;
        return respond(await confluenceRequest({ method: "POST", path: "/api/v2/pages", body: payload }));
      }),
  );

  server.registerTool(
    "confluence_page_update",
    {
      title: "Update a Confluence page",
      description:
        "Update a Confluence page's title and/or body. The current version is fetched automatically and " +
        "incremented; unspecified fields keep their current values.",
      inputSchema: {
        id: z.string().describe("Page id."),
        title: z.string().optional().describe("New title (defaults to current)."),
        body: z.string().optional().describe("New body content (defaults to current)."),
        representation: z
          .enum(["storage", "atlas_doc_format", "wiki"])
          .default("storage")
          .describe("Body format of `body`."),
        status: z.enum(["current", "draft"]).default("current").describe("Page status."),
        versionMessage: z.string().optional().describe("Optional version comment."),
      },
    },
    ({ id, title, body, representation, status, versionMessage }) =>
      guard(async () => {
        if (config.readOnly) return errorResult(READ_ONLY_MSG);
        const current = await confluenceRequest({
          path: `/api/v2/pages/${encodeURIComponent(id)}`,
          query: { "body-format": representation },
        });
        if (!current.ok) return respond(current);

        const cur = current.data as {
          title?: string;
          version?: { number?: number };
          body?: Record<string, { value?: string }>;
        };
        const currentVersion = Number(cur.version?.number ?? 0);
        const newTitle = title ?? cur.title ?? "";
        const newBody = body ?? cur.body?.[representation]?.value ?? "";

        const payload: Record<string, unknown> = {
          id,
          status,
          title: newTitle,
          body: { representation, value: newBody },
          version: { number: currentVersion + 1, ...(versionMessage ? { message: versionMessage } : {}) },
        };
        return respond(
          await confluenceRequest({ method: "PUT", path: `/api/v2/pages/${encodeURIComponent(id)}`, body: payload }),
        );
      }),
  );

  server.registerTool(
    "confluence_page_delete",
    {
      title: "Delete a Confluence page",
      description: "Delete a Confluence page by id.",
      inputSchema: {
        id: z.string().describe("Page id."),
      },
    },
    ({ id }) =>
      guard(async () => {
        if (config.readOnly) return errorResult(READ_ONLY_MSG);
        return respond(await confluenceRequest({ method: "DELETE", path: `/api/v2/pages/${encodeURIComponent(id)}` }));
      }),
  );
}
