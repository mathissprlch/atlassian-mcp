import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const READ_ONLY_MSG =
  "Server is in read-only mode (ATLASSIAN_MCP_READ_ONLY). This write operation is disabled.";

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}
