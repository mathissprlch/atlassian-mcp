import { getAtlassianConfig } from "./config.js";

export interface JiraResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

type QueryValue = string | number | boolean | undefined;

export interface JiraRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

function normalizePath(p: string): string {
  let path = p.trim();
  if (!path.startsWith("/")) path = "/" + path;
  if (path.split(/[/\\]/).includes("..")) {
    throw new Error(`Invalid path '${p}': '..' segments are not allowed.`);
  }
  return path;
}

export async function jiraRequest(opts: JiraRequestOptions): Promise<JiraResponse> {
  const cfg = getAtlassianConfig();
  const url = new URL(`https://${cfg.siteHost}${normalizePath(opts.path)}`);
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
      // not JSON — keep raw text
    }
  }
  return { ok: resp.ok, status: resp.status, data };
}
