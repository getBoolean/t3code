# Releases and CI on a fork

A fork can run CI, publish its own desktop and CLI releases, and have installs update from them.
Everything is driven by repository variables (**Settings → Secrets and variables → Actions →
Variables**). With none set, the workflows behave exactly as they do upstream.

## Runners

Upstream runs on Blacksmith. A fork without Blacksmith sets these to GitHub-hosted labels, which
are free for public repositories:

| Variable                  | Example            |
| ------------------------- | ------------------ |
| `T3CODE_LINUX_RUNNER`     | `ubuntu-24.04`     |
| `T3CODE_LINUX_ARM_RUNNER` | `ubuntu-24.04-arm` |
| `T3CODE_MACOS_RUNNER`     | `macos-26`         |
| `T3CODE_WINDOWS_RUNNER`   | `windows-2025`     |

One variable covers every size of its platform, so jobs sized for 32 vCPU on Blacksmith run on a
standard runner and take longer. CI's Test Web job does not fit its 10-minute limit on a 4 vCPU
runner; set `T3CODE_TEST_WEB_TIMEOUT_MINUTES` (for example `20`) to raise it.

## Releases

Set `T3CODE_RELEASES` to `true`. The release workflow then builds nightlies on its schedule and
stable or preview releases when dispatched, the same as upstream, and publishes them as GitHub
releases of the fork. Release builds take the fork's repository from `GITHUB_REPOSITORY`, so:

- Desktop apps update from the fork's releases.
- `t3 update` and the server's update check read the fork's releases. Each release carries
  `t3-release.json` with the migration number the update check needs.
- Each release attaches `install.sh` and `install.ps1` that install from the fork:

  ```bash
  curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | sh
  ```

  ```powershell
  irm https://github.com/<owner>/<repo>/releases/latest/download/install.ps1 | iex
  ```

Upstream-only publishers are skipped on a fork: AUR, the marketing site, and Discord. These run
only when the fork opts in:

| Variable             | Turns on                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T3CODE_NPM_PUBLISH` | Publishing the `t3` npm package. A fork can't publish that name, so most leave it unset; servers then check GitHub releases.                                              |
| `T3CODE_WEB_DEPLOY`  | Building and deploying the hosted web app to Vercel (`VERCEL_*` secrets).                                                                                                 |
| `T3CODE_RELEASE_APP` | The stable-release version bump pushed to `main` by a GitHub App (`RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`). Without it, bump versions by hand after a stable release. |

Builds are unsigned unless the signing secrets in [release](./release.md) are set. Unsigned
Windows and Linux builds install and update; macOS needs signing and notarization before it can
update itself.

## T3 Connect

Release builds bake in where T3 Connect lives. To use the hosted service, set these variables to
the public values the hosted app ships with:

| Variable                    | Value                          |
| --------------------------- | ------------------------------ |
| `RELAY_DOMAIN`              | `relay.t3.codes`               |
| `CLERK_PUBLISHABLE_KEY`     | `pk_live_Y2xlcmsudDMuY29kZXMk` |
| `CLERK_JWT_TEMPLATE`        | `t3-relay`                     |
| `CLERK_CLI_OAUTH_CLIENT_ID` | `hzxSgY2cH10sDU2r`             |

Desktop sign-in to the hosted service works only while the app keeps the upstream app id and
`t3code://` scheme. To run your own Connect instead, see [Connect setup](./connect-setup.md) and
point these variables at it.

The release workflow uses a `production` environment for these values; GitHub creates it on the
first run.
