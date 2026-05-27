import { atlassianFetch, type AtlassianHttpResponse } from "./atlassian.js";
import { getAtlassianConfig } from "./config.js";

export type JiraResponse = AtlassianHttpResponse;

type QueryValue = string | number | boolean | undefined;

export interface JiraRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export async function jiraRequest(opts: JiraRequestOptions): Promise<JiraResponse> {
  const cfg = getAtlassianConfig();
  return atlassianFetch(cfg.siteBase, opts);
}
