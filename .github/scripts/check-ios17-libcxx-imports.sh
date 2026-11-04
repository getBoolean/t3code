#!/usr/bin/env bash
# Fork: fails when an app bundle imports a libc++ or libc++abi symbol that the library it is bound to
# doesn't export on iOS 17.0. Eager binds kill the app at launch; lazy binds crash on first call, so
# both fail. The compiler misses these (see docs/operations/fork-releases.md).
# ios17-libcxx-exports.txt lists `<library> <symbol>` from `dyld_info -exports` (re-exports included)
# of usr/lib/libc++.1.dylib and libc++abi.dylib in the iOS 17.0 simulator runtime, LC_ALL=C sorted.
# Keep the libraries apart: iOS 17's libc++abi exports symbols that its libc++ doesn't re-export.
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
  xcrun nm -m -u "$file" 2>/dev/null | awk '/\(from libc\+\+(abi)?\)$/ { lib = $NF; sub(/\)$/, "", lib); print lib, $(NF - 2) }' >>"$imports"
# Every file, not only executables: prebuilt frameworks such as ReactNativeDependencies ship 0644.
done < <(find "$app" -type f -print0)

[ "$binaries" -gt 0 ] || { echo "::error::no Mach-O binaries in $app"; exit 1; }
sort -u -o "$imports" "$imports"
count=$(wc -l <"$imports" | tr -d ' ')
[ "$count" -gt 0 ] || { echo "::error::nm found no libc++ imports in $app"; exit 1; }

missing=$(comm -23 "$imports" "$exports")
if [ -n "$missing" ]; then
  echo "::error::$app imports libc++ symbols that iOS 17.0 lacks; the app crashes at launch or on first call:"
  while read -r lib symbol; do echo "  $symbol from $lib  $(xcrun c++filt "$symbol")"; done <<<"$missing"
  exit 1
fi
echo "$binaries Mach-O files import $count libc++ symbols, all exported by iOS 17.0."
