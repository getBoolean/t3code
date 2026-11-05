// Fork: Keep regression coverage for run each project as its own git account (#1).
import {
  EnvironmentId,
  type GitAccountConfig,
  GitAccountId,
  ProjectId,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

// The server only ever sends this marker for a saved token, never the secret.
const SAVED_TOKEN = "••••••";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  settings: null as unknown,
}));

vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: (() => state.settings) as never,
  useUpdateEnvironmentSettings: (() => state.update) as never,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));

import { GitAccountDialog } from "./GitAccountDialog";
import { GitAccountsSettings } from "./GitAccountsSettings";

const environmentId = EnvironmentId.make("local");
const work = GitAccountId.make("work");
const account: GitAccountConfig = {
  label: "Work",
  authorName: "Work Name",
  authorEmail: "work@acme.test",
  forge: SourceControlProviderKind.make("github"),
  host: "github.com",
  credentialKind: "token",
  token: SAVED_TOKEN,
  cliLogin: "",
  sshKeyPath: "",
};

function setup() {
  state.update = vi.fn();
  state.settings = {
    gitAccounts: { [work]: account },
    gitAccountId: work,
    projectSettingsOverrides: { [ProjectId.make("project-app")]: { gitAccountId: work } },
  };
}

it("edits an account without replacing its saved token", async () => {
  setup();
  // No routing: the dialog reads no route, and the app shell would try to connect.
  await using _screen = await render(
    <GitAccountDialog
      environmentId={environmentId}
      accounts={{ [work]: account }}
      editing={{ id: work, account }}
      onClose={() => {}}
    />,
    { router: false },
  );
  const label = page.getByLabelText("Label");
  await userEvent.clear(label);
  await userEvent.type(label, "Work laptop");
  // The modal's inert layer covers its own popup in this harness; typing above shows it is live.
  (page.getByRole("button", { name: "Save" }).element() as HTMLButtonElement).click();

  await vi.waitFor(() =>
    expect(state.update).toHaveBeenCalledWith({
      gitAccounts: {
        [work]: expect.objectContaining({ label: "Work laptop", token: SAVED_TOKEN }),
      },
    }),
  );
});

it("names who uses an account before removing it", async () => {
  setup();
  // No routing: the settings section reads no route, and the app shell would try to connect.
  await using _screen = await render(<GitAccountsSettings environmentId={environmentId} />, {
    router: false,
  });
  await expect.element(page.getByText("saved token", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect
    .element(page.getByText("1 project and every project that uses the default", { exact: false }))
    .toBeVisible();
});
