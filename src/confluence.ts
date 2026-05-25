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
  const res = await confluenceRequest({ path: "/api/v2/spaces", query: { keys: spaceKey, limit: 1 } });
  if (!res.ok) {
    throw new Error(`Failed to resolve space key '${spaceKey}': HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  const results = (res.data as { results?: Array<{ id?: string | number }> })?.results;
  if (!results || results.length === 0 || results[0].id === undefined) {
    throw new Error(`No Confluence space found for key '${spaceKey}'.`);
  }
  return String(results[0].id);
}
