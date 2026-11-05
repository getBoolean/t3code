// Fork: Treat Git 2.56 invalid-gitfile diagnostics as a missing repository alongside the older not-a-repository wording.
/** Git 2.56+ reports a `.git` file that points at a missing directory as an invalid gitfile. */
export function isNonRepositoryGitStderr(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return (
    text.includes("not a git repository") || text.includes("does not point to a valid repository")
  );
}
