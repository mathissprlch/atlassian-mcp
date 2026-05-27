function envBool(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseAtlassianSite(site: string): { siteHost: string; siteBase: string } {
  let s = site.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const url = new URL(s);
  return { siteHost: url.host, siteBase: `${url.protocol}//${url.host}` };
}

export interface AtlassianConfig {
  siteHost: string; // e.g. "your-site.atlassian.net"
  siteBase: string; // e.g. "https://your-site.atlassian.net" (scheme preserved from the input)
  email: string;
  token: string;
}

interface Config {
  acliPath: string;
  acliTimeoutMs: number;
  allowWrites: boolean;
  atlassian: AtlassianConfig | null;
}

function loadConfig(): Config {
  // ATLASSIAN_SITE is the preferred name; CONFLUENCE_SITE is accepted as a synonym for backward compat.
  const site = process.env.ATLASSIAN_SITE ?? process.env.CONFLUENCE_SITE;
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_API_TOKEN;

  let atlassian: AtlassianConfig | null = null;
  if (site && email && token) {
    try {
      const { siteHost, siteBase } = parseAtlassianSite(site);
      atlassian = { siteHost, siteBase, email, token };
    } catch (e) {
      console.error(
        `atlassian-mcp: ignoring malformed Atlassian site '${site}' (${e instanceof Error ? e.message : String(e)}). ` +
          "REST tools will report as not configured.",
      );
    }
  }

  const timeout = Number.parseInt(process.env.ACLI_TIMEOUT_MS ?? "", 10);

  return {
    acliPath: process.env.ACLI_PATH?.trim() || "acli",
    acliTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
    allowWrites: envBool(process.env.ATLASSIAN_MCP_ALLOW_WRITES),
    atlassian,
  };
}

export const config = loadConfig();

export function getAtlassianConfig(): AtlassianConfig {
  if (!config.atlassian) {
    throw new Error(
      "Atlassian REST is not configured. Set ATLASSIAN_SITE (or CONFLUENCE_SITE), ATLASSIAN_EMAIL " +
        "and ATLASSIAN_API_TOKEN.",
    );
  }
  return config.atlassian;
}
