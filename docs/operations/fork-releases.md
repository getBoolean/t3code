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

| Variable                | Turns on                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T3CODE_NPM_PUBLISH`    | Publishing the `t3` npm package. A fork can't publish that name, so most leave it unset; servers then check GitHub releases.                                              |
| `T3CODE_WEB_DEPLOY`     | Building and deploying the hosted web app to Vercel (`VERCEL_*` secrets).                                                                                                 |
| `T3CODE_RELEASE_APP`    | The stable-release version bump pushed to `main` by a GitHub App (`RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`). Without it, bump versions by hand after a stable release. |
| `T3CODE_MOBILE_RELEASE` | An unsigned iOS IPA on every release (see [iOS sideload build](#ios-sideload-build)). A failed build blocks the release.                                                  |

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

## iOS 17

This fork lowers the mobile app's iOS minimum from upstream's 18.0 to 17.0. These fork changes carry it,
each marked `Fork:`. Keep them all when merging upstream:

- `deploymentTarget` in `apps/mobile/app.config.ts`
- `:ios` in `apps/mobile/modules/t3-native-controls/ios/T3NativeControls.podspec`
- `HOSTED_RELAY_MIN_IOS_MAJOR` in `apps/mobile/src/features/agent-awareness/registrationPayload.ts`.
  The hosted relay rejects devices reporting iOS below 18, so iOS 17 devices report 18. They show
  as iOS 18 in the device list. This gets registration accepted. Push delivery still needs a build
  signed with the relay's APNs team and bundle ID.
- `patches/react-native-nitro-modules@0.37.1.patch`. Swift's explicit module builds import libc++
  headers at the SDK version, not the deployment target. Nitro's Swift-visible `make_exception_ptr`
  calls then link `std::exception_ptr::__from_native_exception_pointer`, which only iOS 18 exports,
  and dyld kills the app at launch on iOS 17. The patch mirrors upstream nitro#1824. Drop it once a
  stable Nitro release includes that fix.

Set `T3CODE_IOS17_CHECK` to `true` to run `mobile-ios17-compile.yml`. It compiles the app for the
iOS Simulator SDK at the 17.0 target on mobile changes, which catches unguarded iOS 18+ APIs. It then
runs `.github/scripts/check-ios17-libcxx-imports.sh`, which fails when the app imports a libc++ symbol
that iOS 17.0 doesn't export. The compiler misses those, as described above.
Dispatch it with `simulator` checked to also launch a Release build on an iOS 17 simulator.
Features that need iOS 26 or later, such as liquid glass, voice transcription and the native iPad
workspace columns, stay hidden on iOS 17.

## iOS sideload build

With `T3CODE_MOBILE_RELEASE` set to `true`, `release.yml` runs `release-mobile-ios.yml` and attaches
`T3-Code-<version>-ios-unsigned.ipa`. The fork has no Apple signing in CI, so the IPA is unsigned
and users re-sign it with their own Apple ID (AltStore, SideStore, Sideloadly). That makes it the
Personal Team build (`T3CODE_IOS_PERSONAL_TEAM=1`): no push notifications, widgets, share extension,
or native Sign in with Apple.

- The bundle ID is `T3CODE_IOS_SIDELOAD_BUNDLE_ID`, or `io.github.<owner>.t3code` when that is unset.
  Sideloading tools may change it again.
- Expo over-the-air updates are off (`T3CODE_MOBILE_UPDATES_ENABLED=0`), so upstream's update channel
  can't replace the fork's JavaScript. New versions come from new releases.
- The app version is the release version's numeric part (`0.1.7` for `0.1.7-nightly.20261103.1`),
  because iOS rejects prerelease suffixes.
- The build runs the iOS 17 libc++ check above before packaging and fails on missing symbols.

A pull request that edits `release-mobile-ios.yml` builds the IPA as a check without publishing it.
