import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const PLACEHOLDER_GITHUB_REPO = "TODO_OWNER/TODO_REPO";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stripGitSuffix(value) {
  return text(value).replace(/\.git$/i, "");
}

export function normalizeGitHubRepository(value) {
  const source = text(value);

  if (!source || /<[^>]+>/.test(source)) {
    return "";
  }

  const ownerRepoMatch = source.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?$/);
  if (ownerRepoMatch) {
    return `${ownerRepoMatch[1]}/${stripGitSuffix(ownerRepoMatch[2])}`;
  }

  const sshMatch = source.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${stripGitSuffix(sshMatch[2])}`;
  }

  try {
    const url = new URL(source);
    if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      return "";
    }

    const [owner, repo] = url.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    if (owner && repo) {
      return `${owner}/${stripGitSuffix(repo)}`;
    }
  } catch {
    return "";
  }

  return "";
}

export async function inferGitHubRepositoryFromOrigin({ cwd = process.cwd(), env = process.env } = {}) {
  try {
    const { stdout } = await execFile("git", ["remote", "get-url", "origin"], { cwd, env });
    return normalizeGitHubRepository(stdout);
  } catch {
    return "";
  }
}

export async function resolveGitHubRepository(explicitValue, { cwd = process.cwd(), env = process.env } = {}) {
  return (
    normalizeGitHubRepository(explicitValue) ||
    normalizeGitHubRepository(env.GITHUB_REPOSITORY) ||
    (await inferGitHubRepositoryFromOrigin({ cwd, env })) ||
    PLACEHOLDER_GITHUB_REPO
  );
}
