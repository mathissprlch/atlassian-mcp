import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const WRITES_DISABLED_MSG =
  "Writes are disabled. Set ATLASSIAN_MCP_ALLOW_WRITES=true to allow create, edit, transition, " +
  "delete and other non-GET operations.";

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}
