import { execFile } from "node:child_process";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { errorResult, textResult } from "./util.js";

export interface AcliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runAcli(args: string[]): Promise<AcliResult> {
  return new Promise((resolve) => {
    execFile(
      config.acliPath,
      args,
      { maxBuffer: 16 * 1024 * 1024, timeout: config.acliTimeoutMs, env: process.env },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { code?: string | number };
          if (e.code === "ENOENT") {
            resolve({
              ok: false,
              stdout: stdout ?? "",
              stderr:
                `acli not found (tried '${config.acliPath}'). Install the Atlassian CLI, ` +
                "authenticate it (`acli jira auth login`), and make sure it is on PATH or set ACLI_PATH.",
              code: null,
            });
            return;
          }
          resolve({
            ok: false,
            stdout: stdout ?? "",
            stderr: (stderr || String(err)).toString(),
            code: typeof e.code === "number" ? e.code : null,
          });
          return;
        }
        resolve({ ok: true, stdout: stdout ?? "", stderr: stderr ?? "", code: 0 });
      },
    );
  });
}

export function acliResultToTool(res: AcliResult): CallToolResult {
  if (!res.ok) {
    const msg = [res.stderr.trim(), res.stdout.trim()].filter(Boolean).join("\n\n");
    return errorResult(msg || `acli exited with code ${res.code ?? "unknown"}.`);
  }
  return textResult(res.stdout.trim() || res.stderr.trim() || "(no output)");
}

const MUTATING_VERBS = new Set([
  "create", "edit", "update", "transition", "delete", "add", "remove", "assign",
  "unassign", "archive", "move", "rename", "set", "import", "clone", "close",
  "link", "unlink", "start", "stop", "complete",
]);

// Best-effort: inspect the command-path tokens (before the first flag) for a mutating verb.
export function isMutatingAcli(args: string[]): boolean {
  for (const a of args) {
    if (a.startsWith("-")) break;
    if (MUTATING_VERBS.has(a.toLowerCase())) return true;
  }
  return false;
}
