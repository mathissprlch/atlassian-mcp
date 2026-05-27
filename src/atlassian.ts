import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getAtlassianConfig } from "./config.js";
import { errorResult, jsonResult, textResult } from "./util.js";

export interface AtlassianHttpResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

type QueryValue = string | number | boolean | undefined;

export interface AtlassianHttpRequest {
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

function normalizePath(p: string): string {
  let path = p.trim();
  if (!path.startsWith("/")) path = "/" + path;
  // Reject path traversal so a crafted path can't escape the intended API roots.
  if (path.split(/[/\\]/).includes("..")) {
    throw new Error(`Invalid path '${p}': '..' segments are not allowed.`);
  }
  return path;
}

export async function atlassianFetch(
  baseUrl: string,
  opts: AtlassianHttpRequest,
): Promise<AtlassianHttpResponse> {
  const cfg = getAtlassianConfig();
  const url = new URL(baseUrl + normalizePath(opts.path));
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

export function respondAtlassian(
  res: AtlassianHttpResponse,
  product: "Confluence" | "Jira",
): CallToolResult {
  if (!res.ok) {
    const detail = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
    return errorResult(`${product} API error: HTTP ${res.status}\n${detail}`);
  }
  if (res.data === "" || res.data === null || res.data === undefined) {
    return textResult(`Success (HTTP ${res.status}).`);
  }
  return jsonResult(res.data);
}

export async function atlassianGuard(
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}
