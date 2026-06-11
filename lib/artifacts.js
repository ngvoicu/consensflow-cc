const MAX_ARTIFACT_BYTES = 192 * 1024;

export async function collectGitDiff(cwd, execFn) {
  if (!execFn) return null;
  const status = await execFn("git", ["status", "--short"], { cwd });
  const diff = await execFn("git", ["diff", "--stat"], { cwd });
  const patch = await execFn("git", ["diff", "--", "."], { cwd });
  const cached = await execFn("git", ["diff", "--cached", "--", "."], { cwd });
  return {
    status: status.code === 0 ? status.stdout : status.stderr,
    stat: diff.code === 0 ? diff.stdout : diff.stderr,
    patch: patch.code === 0 ? patch.stdout.slice(0, MAX_ARTIFACT_BYTES) : patch.stderr,
    cached: cached.code === 0 ? cached.stdout.slice(0, MAX_ARTIFACT_BYTES) : cached.stderr,
  };
}

// Did the workspace change between two collectGitDiff snapshots? Compares status + patch + stat +
// cached, NOT just the unstaged patch: `git diff -- .` excludes untracked files and staged-only
// edits, so a participant that creates a new file or runs `git add` would otherwise look unchanged.
// `git status --short` reflects untracked/staged/modified; pre-existing entries appear identically
// in both snapshots, so they cancel and never cause a false positive.
export function gitChangesDiffer(before, after) {
  if (!after) return false;
  if (!before) return true;
  return ["status", "patch", "stat", "cached"].some((key) => (after[key] ?? "") !== (before[key] ?? ""));
}
