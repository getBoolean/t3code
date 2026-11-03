#!/usr/bin/env bash
# Fork: fails when an app bundle imports a libc++ symbol that iOS 17.0 does not export, which dyld
# rejects at launch. Swift explicit modules import libc++ headers at the SDK version, so libc++'s
# availability guards don't stop this at compile time (see docs/operations/fork-releases.md).
# ios17-libcxx-exports.txt is `nm -gUj` of usr/lib/libc++.1.dylib and libc++abi.dylib in the
# iOS 17.0 simulator runtime, sorted with LC_ALL=C.
set -euo pipefail
export LC_ALL=C

app=${1:?usage: check-ios17-libcxx-imports.sh <path/to/App.app>}
exports="$(dirname "$0")/ios17-libcxx-exports.txt"
[ -d "$app" ] || { echo "::error::no app bundle at $app"; exit 1; }
[ -s "$exports" ] || { echo "::error::missing $exports"; exit 1; }

imports=$(mktemp)
binaries=0
while IFS= read -r -d '' file; do
  file -b "$file" | grep -q '^Mach-O' || continue
  binaries=$((binaries + 1))
  xcrun nm -m -u "$file" | awk '/\(from libc\+\+(abi)?\)$/ { print $(NF - 2) }' >>"$imports"
done < <(find "$app" -type f \( -perm -u+x -o -name '*.dylib' \) -print0)

[ "$binaries" -gt 0 ] || { echo "::error::no Mach-O binaries in $app"; exit 1; }
sort -u -o "$imports" "$imports"
count=$(wc -l <"$imports" | tr -d ' ')
[ "$count" -gt 0 ] || { echo "::error::nm found no libc++ imports in $app"; exit 1; }

missing=$(comm -23 "$imports" "$exports")
if [ -n "$missing" ]; then
  echo "::error::$app imports libc++ symbols that iOS 17.0 lacks; dyld would kill it at launch:"
  while IFS= read -r symbol; do echo "  $symbol  $(xcrun c++filt "$symbol")"; done <<<"$missing"
  exit 1
fi
echo "$binaries Mach-O files import $count libc++ symbols, all exported by iOS 17.0."
