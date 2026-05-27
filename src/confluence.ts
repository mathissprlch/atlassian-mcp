import { atlassianFetch, type AtlassianHttpResponse } from "./atlassian.js";
import { getAtlassianConfig } from "./config.js";

export type ConfluenceResponse = AtlassianHttpResponse;

type QueryValue = string | number | boolean | undefined;

export interface ConfluenceRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

// baseUrl ends in /wiki, so allow callers to pass either '/api/...' or '/wiki/api/...'.
function confluencePath(p: string): string {
  let path = p.trim();
  if (!path.startsWith("/")) path = "/" + path;
  if (path === "/wiki") path = "/";
  else if (path.startsWith("/wiki/")) path = path.slice("/wiki".length);
  return path;
}

export async function confluenceRequest(opts: ConfluenceRequestOptions): Promise<ConfluenceResponse> {
  const cfg = getAtlassianConfig();
  return atlassianFetch(cfg.siteBase + "/wiki", { ...opts, path: confluencePath(opts.path) });
}

export async function resolveSpaceId(spaceKey: string): Promise<string> {
  const res = await confluenceRequest({ path: "/api/v2/spaces", query: { keys: spaceKey, limit: 25 } });
  if (!res.ok) {
    throw new Error(`Failed to resolve space key '${spaceKey}': HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  const results = (res.data as { results?: Array<{ id?: string | number; key?: string }> })?.results ?? [];
  // Require an exact (case-insensitive) key match rather than blindly taking the first result.
  const match = results.find((s) => s.key?.toLowerCase() === spaceKey.toLowerCase());
  if (!match || match.id === undefined) {
    throw new Error(`No Confluence space found with key '${spaceKey}'.`);
  }
  return String(match.id);
}

export interface PageMeta {
  id: string;
  title: string;
  version: number;
  status: string;
  spaceId?: string;
  parentId?: string;
}

type Fetched<T> = { ok: true; value: T } | { ok: false; response: ConfluenceResponse };

// Fetches page metadata (no body). Used to read the current version/title and to verify the
// target before a destructive write. Returns the raw failing response so callers can surface it.
export async function getPageMeta(id: string): Promise<Fetched<PageMeta>> {
  const res = await confluenceRequest({ path: `/api/v2/pages/${encodeURIComponent(id)}` });
  if (!res.ok) return { ok: false, response: res };
  const d = res.data as {
    id?: string | number;
    title?: string;
    status?: string;
    spaceId?: string | number;
    parentId?: string | number | null;
    version?: { number?: number };
  };
  if (typeof d.title !== "string" || typeof d.version?.number !== "number") {
    return {
      ok: false,
      response: {
        ok: false,
        status: res.status,
        data: `Unexpected page response for id ${id} (missing title/version): ${JSON.stringify(res.data)}`,
      },
    };
  }
  return {
    ok: true,
    value: {
      id: String(d.id ?? id),
      title: d.title,
      version: d.version.number,
      status: d.status ?? "current",
      spaceId: d.spaceId !== undefined ? String(d.spaceId) : undefined,
      parentId: d.parentId !== undefined && d.parentId !== null ? String(d.parentId) : undefined,
    },
  };
}

// Fetches the current body in storage format. Used to preserve content on a metadata-only update.
// Never returns a silent empty string: if the body can't be read, the caller must abort.
export async function getPageStorageBody(id: string): Promise<Fetched<string>> {
  const res = await confluenceRequest({
    path: `/api/v2/pages/${encodeURIComponent(id)}`,
    query: { "body-format": "storage" },
  });
  if (!res.ok) return { ok: false, response: res };
  const value = (res.data as { body?: { storage?: { value?: string } } })?.body?.storage?.value;
  if (typeof value !== "string") {
    return {
      ok: false,
      response: {
        ok: false,
        status: res.status,
        data: `Could not read the current body of page ${id} to preserve it; pass 'body' explicitly.`,
      },
    };
  }
  return { ok: true, value };
}
