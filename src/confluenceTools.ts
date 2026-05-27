import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { atlassianGuard, respondAtlassian } from "./atlassian.js";
import { config } from "./config.js";
import {
  confluenceRequest,
  getPageMeta,
  getPageStorageBody,
  resolveSpaceId,
  type ConfluenceResponse,
} from "./confluence.js";
import { errorResult, textResult, WRITES_DISABLED_MSG } from "./util.js";

const guard = atlassianGuard;
const respond = (res: ConfluenceResponse) => respondAtlassian(res, "Confluence");

export function registerConfluenceTools(server: McpServer): void {
  server.registerTool(
    "confluence_request",
    {
      title: "Call any Confluence REST API endpoint",
      description:
        "Escape hatch: make a raw request to the Confluence Cloud REST API. `path` is relative to the " +
        "site's /wiki base (e.g. '/api/v2/pages', '/api/v2/spaces', '/rest/api/search'). Use v2 " +
        "(/api/v2/...) for CRUD and v1 (/rest/api/...) for CQL search. This tool is unrestricted within " +
        "the API token's permissions, so a wrong path/method/body can damage or delete content. Non-GET " +
        "methods require ATLASSIAN_MCP_ALLOW_WRITES=true. Prefer the typed confluence_* tools, which add " +
        "target checks. Auth uses ATLASSIAN_SITE (or CONFLUENCE_SITE), ATLASSIAN_EMAIL and " +
        "ATLASSIAN_API_TOKEN.",
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
        if (!config.allowWrites && method !== "GET") return errorResult(WRITES_DISABLED_MSG);
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
        "'storage' representation (Confluence storage format / XHTML). Confluence rejects a duplicate " +
        "title within a space. Requires ATLASSIAN_MCP_ALLOW_WRITES=true.",
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
        if (!config.allowWrites) return errorResult(WRITES_DISABLED_MSG);
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
        "Update a Confluence page. The Confluence API has no partial update: this reads the current page, " +
        "then sends a full replacement with version+1. Provide `body` to change content; if you omit it, " +
        "the existing body is preserved (never blanked). Omitted title/status default to current values, " +
        "and the page's current parent is always re-sent so an edit can't move it (pass `parentId` to move " +
        "it on purpose). Pass `expectedTitle` and/or `expectedVersion` to refuse the write if the page isn't what you " +
        "expect (wrong page, or changed since you read it). Requires ATLASSIAN_MCP_ALLOW_WRITES=true.",
      inputSchema: {
        id: z.string().describe("Page id."),
        title: z.string().optional().describe("New title (defaults to current)."),
        body: z.string().optional().describe("New body content. If omitted, the current body is kept."),
        representation: z
          .enum(["storage", "atlas_doc_format", "wiki"])
          .default("storage")
          .describe("Body format of `body` (only used when `body` is provided)."),
        status: z.enum(["current", "draft"]).optional().describe("Page status (defaults to current value)."),
        parentId: z
          .string()
          .optional()
          .describe("Move the page under this parent id. If omitted, the current parent is preserved (the page won't move)."),
        versionMessage: z.string().optional().describe("Optional version comment."),
        expectedTitle: z
          .string()
          .optional()
          .describe("If set, the page's current title must match exactly or the update is refused."),
        expectedVersion: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("If set, the page's current version must match exactly or the update is refused."),
      },
    },
    ({ id, title, body, representation, status, parentId, versionMessage, expectedTitle, expectedVersion }) =>
      guard(async () => {
        if (!config.allowWrites) return errorResult(WRITES_DISABLED_MSG);

        const metaRes = await getPageMeta(id);
        if (!metaRes.ok) return respond(metaRes.response);
        const {
          title: actualTitle,
          version: actualVersion,
          status: actualStatus,
          parentId: actualParentId,
        } = metaRes.value;

        if (expectedTitle !== undefined && expectedTitle !== actualTitle) {
          return errorResult(
            `Refusing to update: page ${id} is titled "${actualTitle}", not "${expectedTitle}". ` +
              "Re-check the page id.",
          );
        }
        if (expectedVersion !== undefined && expectedVersion !== actualVersion) {
          return errorResult(
            `Refusing to update: page ${id} is at version ${actualVersion}, not ${expectedVersion}. ` +
              "It changed since you read it; re-fetch before updating.",
          );
        }

        let writeRepresentation = representation;
        let writeBody: string;
        if (body !== undefined) {
          writeBody = body;
        } else {
          // Metadata-only change (e.g. title): preserve the existing body via a storage round-trip.
          const bodyRes = await getPageStorageBody(id);
          if (!bodyRes.ok) return respond(bodyRes.response);
          writeBody = bodyRes.value;
          writeRepresentation = "storage";
        }

        const payload: Record<string, unknown> = {
          id,
          status: status ?? actualStatus,
          title: title ?? actualTitle,
          body: { representation: writeRepresentation, value: writeBody },
          version: { number: actualVersion + 1, ...(versionMessage ? { message: versionMessage } : {}) },
        };
        // Always re-send the current parent (unless the caller is intentionally moving the page) so a
        // title/body/status edit can never relocate the page in the hierarchy.
        const effectiveParentId = parentId ?? actualParentId;
        if (effectiveParentId !== undefined) payload.parentId = effectiveParentId;
        return respond(
          await confluenceRequest({ method: "PUT", path: `/api/v2/pages/${encodeURIComponent(id)}`, body: payload }),
        );
      }),
  );

  server.registerTool(
    "confluence_page_delete",
    {
      title: "Delete a Confluence page",
      description:
        "Move a Confluence page to the trash by id (recoverable; not a permanent purge). The page is " +
        "fetched first so its title is verified and reported. Pass `expectedTitle` to refuse the delete " +
        "if it doesn't match. Requires ATLASSIAN_MCP_ALLOW_WRITES=true.",
      inputSchema: {
        id: z.string().describe("Page id."),
        expectedTitle: z
          .string()
          .optional()
          .describe("If set, the page's current title must match exactly or the delete is refused."),
      },
    },
    ({ id, expectedTitle }) =>
      guard(async () => {
        if (!config.allowWrites) return errorResult(WRITES_DISABLED_MSG);

        const metaRes = await getPageMeta(id);
        if (!metaRes.ok) return respond(metaRes.response);
        const actualTitle = metaRes.value.title;

        if (expectedTitle !== undefined && expectedTitle !== actualTitle) {
          return errorResult(
            `Refusing to delete: page ${id} is titled "${actualTitle}", not "${expectedTitle}". ` +
              "Re-check the page id.",
          );
        }

        const res = await confluenceRequest({ method: "DELETE", path: `/api/v2/pages/${encodeURIComponent(id)}` });
        if (!res.ok) return respond(res);
        return textResult(`Moved page ${id} ("${actualTitle}") to trash.`);
      }),
  );
}
