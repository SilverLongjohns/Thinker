import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const MAIN_BRANCHES = new Set(["main", "master", "develop"]);
const BRANCH_PREFIXES = ["feature/", "bugfix/", "fix/", "chore/"];

export function stripBranchPrefix(branch: string): string {
  for (const prefix of BRANCH_PREFIXES) {
    if (branch.startsWith(prefix)) {
      return branch.slice(prefix.length);
    }
  }
  return branch;
}

export function detectFeature(branch: string): string | null {
  if (MAIN_BRANCHES.has(branch)) return null;
  return stripBranchPrefix(branch);
}

function gitCommand(cwd: string, command: string): string | null {
  try {
    return execSync(command, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function getCurrentBranch(cwd: string): string | null {
  return gitCommand(cwd, "git rev-parse --abbrev-ref HEAD");
}

function getRemoteUrl(cwd: string): string | null {
  return gitCommand(cwd, "git remote get-url origin");
}

function getInitialCommit(cwd: string): string | null {
  return gitCommand(cwd, "git rev-list --max-parents=0 HEAD")?.split("\n")[0] ?? null;
}

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function detectProjectId(cwd: string): string {
  const remoteUrl = getRemoteUrl(cwd);
  if (remoteUrl) return hashString(remoteUrl);

  const initialCommit = getInitialCommit(cwd);
  if (initialCommit) return hashString(initialCommit);

  return hashString(cwd);
}

export function detectProjectName(cwd: string): string {
  try {
    const remoteUrl = getRemoteUrl(cwd);
    if (remoteUrl) {
      const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) return match[1];
    }
  } catch {}

  const parts = cwd.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "unknown";
}
