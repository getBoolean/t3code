#!/usr/bin/env node
// Fork: Emit t3-release.json migration metadata for servers updating from fork GitHub assets instead of npm.
// Servers that update from GitHub releases instead of npm read this asset; see CLI_RELEASE_MANIFEST_ASSET.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";

import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import { latestServerMigrationId } from "./build-npm-launcher.ts";

const encodeJson = Schema.encodeEffect(fromJsonStringPretty(Schema.Unknown));

/** The fields npmReleaseDatabaseMigration reads, matching the npm `t3` manifest. */
const writeReleaseManifest = Effect.fn("writeReleaseManifest")(function* (input: {
  readonly version: string;
  readonly output: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const manifest = {
    version: input.version,
    t3code: { databaseMigration: yield* latestServerMigrationId() },
  };
  yield* fs.writeFileString(input.output, `${yield* encodeJson(manifest)}\n`);
  yield* Effect.log(`[release-manifest] Wrote ${input.output}`);
});

const command = Command.make(
  "write-release-manifest",
  {
    version: Flag.String("version").pipe(Flag.withDescription("Exact release version.")),
    output: Flag.String("output").pipe(Flag.withDefault("t3-release.json")),
  },
  writeReleaseManifest,
).pipe(Command.withDescription("Write the release manifest servers read from GitHub releases."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
