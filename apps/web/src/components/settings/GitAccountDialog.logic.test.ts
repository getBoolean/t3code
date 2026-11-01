import { GitAccountId, ProjectId, type UnifiedSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { gitAccountIdFromLabel, projectsUsingGitAccount } from "./GitAccountDialog.logic";

const accounts = { work: {}, "work-2": {} } as unknown as UnifiedSettings["gitAccounts"];

describe("gitAccountIdFromLabel", () => {
  it("slugs the label and never reuses an existing id", () => {
    expect(gitAccountIdFromLabel("Personal Account", accounts)).toBe("personal-account");
    expect(gitAccountIdFromLabel("Work", accounts)).toBe("work-3");
    expect(gitAccountIdFromLabel("!!!", accounts)).toBe("account");
  });
});

describe("projectsUsingGitAccount", () => {
  it("counts only projects that pick the account themselves", () => {
    const settings = {
      projectSettingsOverrides: {
        [ProjectId.make("a")]: { gitAccountId: GitAccountId.make("work") },
        [ProjectId.make("b")]: { gitAccountId: GitAccountId.make("personal") },
        [ProjectId.make("c")]: { defaultAutoPull: true },
      },
    } as Pick<UnifiedSettings, "projectSettingsOverrides">;
    expect(projectsUsingGitAccount(settings, GitAccountId.make("work"))).toBe(1);
  });
});
