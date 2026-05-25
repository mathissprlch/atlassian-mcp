import { getConfluenceConfig } from "./config.js";

export interface ConfluenceResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

type QueryValue = string | number | boolean | undefined;

export interface ConfluenceRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

function normalizePath(p: string): string {
  let path = p.trim();
  if (!path.startsWith("/")) path = "/" + path;
  // baseUrl already ends in /wiki, so strip a leading /wiki if the caller included it.
  if (path === "/wiki") path = "/";
  else if (path.startsWith("/wiki/")) path = path.slice("/wiki".length);
  // Reject path traversal so a crafted path can't escape the intended API roots.
  if (path.split(/[/\\]/).includes("..")) {
    throw new Error(`Invalid path '${p}': '..' segments are not allowed.`);
  }
  return path;
}

export async function confluenceRequest(opts: ConfluenceRequestOptions): Promise<ConfluenceResponse> {
  const cfg = getConfluenceConfig();
  const url = new URL(cfg.baseUrl + normalizePath(opts.path));
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Authorization: "Basic " + Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64"),
    Accept: "application/json",
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const resp = await fetch(url, { method: (opts.method ?? "GET").toUpperCase(), headers, body });
  const raw = await resp.text();
  let data: unknown = raw;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      // not JSON — keep the raw text
    }
  }
  return { ok: resp.ok, status: resp.status, data };
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
