// Fork: Keep regression coverage for treat Git 2.56's invalid gitfile message as no repository.
import { expect, it } from "vite-plus/test";

import { isNonRepositoryGitStderr } from "./gitNonRepository.ts";

it.each([
  ["fatal: not a git repository (or any of the parent directories): .git", true],
  // A worktree whose .git file points at a deleted directory, worded by Git 2.56.
  ["fatal: gitfile does not point to a valid repository: /tmp/worktree/.git", true],
  ["fatal: Unable to create '/repo/.git/index.lock': File exists.", false],
])("classifies %j", (stderr, expected) => {
  expect(isNonRepositoryGitStderr(stderr)).toBe(expected);
});
