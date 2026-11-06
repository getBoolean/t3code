#!/usr/bin/env bash
# Fork: fails when an upstream merge dropped fork-owned work listed in .github/fork-manifest.txt,
# or when a "Fork:" code comment lives in a file the manifest doesn't list.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
manifest=.github/fork-manifest.txt
[ -s "$manifest" ] || { echo "::error::missing $manifest"; exit 1; }

status=0
entries=0
listed=$(mktemp)
trap 'rm -f "$listed"' EXIT
reason=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '') reason=""; continue ;;
    '# Fork: '*) reason=${line#'# Fork: '}; continue ;;
    '#'*) continue ;;
  esac
  path=${line%%$'\t'*}
  text=""
  [[ "$line" == *$'\t'* ]] && text=${line#*$'\t'}
  entries=$((entries + 1))
  echo "$path" >>"$listed"
  if [ -z "$reason" ]; then
    echo "::error file=$manifest::$path needs a preceding # Fork: explanation"
    status=1
  fi
  if [ ! -e "$path" ]; then
    echo "::error file=$manifest::$path is missing"
    status=1
  elif [ -n "$text" ] && ! grep -qF -- "$text" "$path"; then
    echo "::error file=$path::no longer contains: $text"
    status=1
  fi
  # Fork: These generated/comment-free files keep their preservation reasons in the manifest.
  case "$path" in
    pnpm-lock.yaml | .github/scripts/ios17-libcxx-exports.txt | \
      apps/server/src/provider/agentContextBudget.json | \
      evals/mcp-tool-use/cases/projects.ndjson | packages/client-runtime/package.json | apps/mobile/package.json) ;;
    *)
      if [ -f "$path" ] && ! grep -qE '(#|//|/\*|<!--|--)[[:space:]]*Fork:' "$path"; then
        echo "::error file=$path::missing Fork: explanation in source"
        status=1
      fi
      ;;
  esac
done <"$manifest"
[ "$entries" -gt 0 ] || { echo "::error::$manifest lists nothing"; exit 1; }

# Every Fork: comment (#, //, /*, <!--, --) must be in a listed file. Markdown is prose, not code.
while IFS= read -r file; do
  if ! grep -qxF -- "$file" "$listed"; then
    echo "::error file=$file::has a Fork: comment but isn't listed in $manifest"
    status=1
  fi
done < <(git grep -lE '(#|//|/\*|<!--|--)[[:space:]]*Fork:' -- ':!*.md' ':!.github/fork-manifest.txt')

[ "$status" -eq 0 ] && echo "fork manifest: $entries entries present"
exit "$status"
