import * as Schema from "effect/Schema";

// Separate module avoids an import cycle between settings and git-account consumers.
export const GitAccountId = Schema.String.pipe(Schema.brand("GitAccountId"));
export type GitAccountId = typeof GitAccountId.Type;
