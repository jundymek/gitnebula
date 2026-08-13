/**
 * "open on github" (AC-3, FR-20): turn `repo.remoteUrl` into a browsable URL
 * for one node.
 *
 * The contract carries the remote exactly as git reports it, which is one of
 * three shapes — `https://`, `ssh://git@`, or the scp-like
 * `git@host:owner/repo`. Only GitHub is resolvable here: GitLab and Bitbucket
 * use different path segments (`-/tree`, `src`), and guessing one would
 * produce a link that 404s. Anything that is not GitHub returns `null`, and
 * the caller renders no button at all — a dead or disabled control is worse
 * than an absent one.
 *
 * Nothing here reaches the network. It is string work on a value that was
 * already in `analysis.json`.
 */

/** `https://github.com/<owner>/<repo>`, or null for any other remote. */
export function githubRepoUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const trimmed = remoteUrl.trim();
  if (trimmed === "") return null;

  const match =
    // https://github.com/o/r(.git) and ssh://git@github.com/o/r(.git)
    /^(?:https?|ssh|git):\/\/(?:[^@/]*@)?github\.com(?::\d+)?\/(.+)$/i.exec(
      trimmed,
    ) ??
    // git@github.com:o/r(.git) — the scp-like form, which has no scheme
    /^[^@\s]+@github\.com:(.+)$/i.exec(trimmed);
  if (!match) return null;

  const path = stripGitSuffix(match[1]!).replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").filter((segment) => segment !== "");
  // Exactly owner + repo. Fewer is not a repository; more is a URL shape we
  // did not parse and must not guess at.
  if (segments.length !== 2) return null;
  // Encoded like every other segment: the remote is data out of
  // `analysis.json`, and the scheme and host are ours rather than its.
  return `https://github.com/${encodeURIComponent(
    segments[0]!,
  )}/${encodeURIComponent(segments[1]!)}`;
}

/**
 * The node's page on GitHub: `tree` for a module (a directory), `blob` for a
 * file (AC-3). Null whenever the remote is not a GitHub one.
 */
export function githubNodeUrl(
  remoteUrl: string | null,
  defaultBranch: string,
  path: string,
  kind: "module" | "file",
): string | null {
  const base = githubRepoUrl(remoteUrl);
  if (base === null) return null;
  const branch = defaultBranch.trim();
  if (branch === "") return null;

  // Module paths carry a trailing slash in the contract (`core/`); the repo
  // root is the empty path, which is the repository's own tree page.
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (clean === "") return `${base}/tree/${encodePath(branch)}`;

  const view = kind === "module" ? "tree" : "blob";
  return `${base}/${view}/${encodePath(branch)}/${encodePath(clean)}`;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

/** Percent-encode each segment, leaving the separators alone. */
function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}
