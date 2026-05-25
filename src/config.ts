function envBool(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function normalizeConfluenceBase(site: string): string {
  let s = site.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const url = new URL(s);
  return `${url.protocol}//${url.host}/wiki`;
}

export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  token: string;
}

interface Config {
  acliPath: string;
  acliTimeoutMs: number;
  readOnly: boolean;
  confluence: ConfluenceConfig | null;
}

function loadConfig(): Config {
  const site = process.env.CONFLUENCE_SITE;
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_API_TOKEN;

  let confluence: ConfluenceConfig | null = null;
  if (site && email && token) {
    confluence = { baseUrl: normalizeConfluenceBase(site), email, token };
  }

  const timeout = Number.parseInt(process.env.ACLI_TIMEOUT_MS ?? "", 10);

  return {
    acliPath: process.env.ACLI_PATH?.trim() || "acli",
    acliTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
    readOnly: envBool(process.env.ATLASSIAN_MCP_READ_ONLY),
    confluence,
  };
}

export const config = loadConfig();

export function getConfluenceConfig(): ConfluenceConfig {
  if (!config.confluence) {
    throw new Error(
      "Confluence is not configured. Set CONFLUENCE_SITE, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN.",
    );
  }
  return config.confluence;
}
