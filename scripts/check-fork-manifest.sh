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
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in '' | '#'*) continue ;; esac
  path=${line%%$'\t'*}
  text=""
  [[ "$line" == *$'\t'* ]] && text=${line#*$'\t'}
  entries=$((entries + 1))
  echo "$path" >>"$listed"
  if [ ! -e "$path" ]; then
    echo "::error file=$manifest::$path is missing"
    status=1
  elif [ -n "$text" ] && ! grep -qF -- "$text" "$path"; then
    echo "::error file=$path::no longer contains: $text"
    status=1
  fi
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
