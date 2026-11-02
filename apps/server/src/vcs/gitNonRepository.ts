/** Git 2.56+ reports a `.git` file that points at a missing directory as an invalid gitfile. */
export function isNonRepositoryGitStderr(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return (
    text.includes("not a git repository") || text.includes("does not point to a valid repository")
  );
}
