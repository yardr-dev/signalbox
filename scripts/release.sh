#!/bin/sh
# Builds signalbox's release archive: signalbox_<version>.tar.gz, one for
# every platform, which holds the built page and the serve script with what
# it imports under a top directory signalbox/, and a checksums.txt (sha256)
# over it. INSTALL.md says what one does with it.
#
#   scripts/release.sh <version> [out-dir]      (out-dir defaults to release)
#
# <version> is the tag, v1.2.3 or v1.2.3-rc.1. The script writes it, without
# the v, into package.json and the lockfile: commit that, and tag the commit.
# Then it does what the gate does (.yardr/check) and packs what that built.
#
# SIGNALBOX_RELEASE_PACK=1 packs the dist/ that is there, without the
# install, the checks and the build. The test of this script runs it so
# (test/release.test.mjs): npm test is one of the steps it leaves out.
set -eu

usage() {
  echo "usage: scripts/release.sh <version> [out-dir]   (version like v1.2.3 or v1.2.3-rc.1)" >&2
  exit 2
}

version=${1:-}
out=${2:-release}
printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || usage

mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$(dirname "$0")/.."

# What the archive holds, and nothing else of the tree: the page, the serve
# script, what that imports and node runs as it is, the two files to
# read, and the licence with its notice. The one place that says so: the test reads this line, and fails when
# the script imports a file that is not on it.
files="dist scripts/serve.mjs scripts/yard.mjs src/layout.ts src/project.ts src/yard.ts README.md INSTALL.md LICENSE NOTICE"

# The node that packs the script can run it: the lowest is package.json's
# (engines), the first to take a TypeScript file as it is.
want=$(sed -n 's/.*"node": *">=\([0-9][0-9.]*\)".*/\1/p' package.json)
have=$(node --version)
have=${have#v}
minor() {
  rest=${1#*.}
  echo "${rest%%.*}"
}
if [ -z "$want" ] || [ "${have%%.*}" -lt "${want%%.*}" ] ||
  { [ "${have%%.*}" -eq "${want%%.*}" ] && [ "$(minor "$have")" -lt "$(minor "$want")" ]; }; then
  echo "scripts/release.sh: node is $have; package.json asks for $want or later" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sum="sha256sum"
else
  sum="shasum -a 256"
fi

# The v is the tag's, not the version's.
npm version "${version#v}" --no-git-tag-version --allow-same-version >/dev/null

if [ "${SIGNALBOX_RELEASE_PACK:-}" != 1 ]; then
  # From the lockfile, as the gate does.
  npm ci
  npm run check
  npm test
  npm run build
fi
# The build can exit 0 and write no page.
test -s dist/index.html

# An archive holds the listed files and nothing of the machine that packed
# it, as yardr's does (contrib/release/build there). bsdtar on a Mac packs a
# file's extended attributes (com.apple.provenance, on anything a Mac made)
# as pax headers and as AppleDouble ._ members, which GNU tar warns of and
# unpacks beside the files; each tar is asked for what it understands, as
# the two do not share the flags. Owner 0/0 and no names, for the same
# reason: not the builder's user and group.
accepts() {
  # shellcheck disable=SC2086 # $1 is a list
  tar -cf /dev/null $1 -T /dev/null 2>/dev/null
}
tarflags="--numeric-owner"
if accepts "--uid 0 --gid 0"; then
  tarflags="$tarflags --uid 0 --gid 0"
else
  tarflags="$tarflags --owner=0 --group=0"
fi
for flag in --no-xattrs --no-mac-metadata; do
  if accepts "$flag"; then
    tarflags="$tarflags $flag"
  fi
done

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
for file in $files; do
  mkdir -p "$stage/signalbox/$(dirname "$file")"
  cp -R "$file" "$stage/signalbox/$file"
done
# A Mac does not always let the provenance attribute go, so this is on top
# of the tar flags, not in their place.
if command -v xattr >/dev/null 2>&1; then
  xattr -cr "$stage/signalbox" 2>/dev/null || true
fi

archive=signalbox_${version#v}.tar.gz
# COPYFILE_DISABLE is what an older bsdtar without --no-mac-metadata reads.
# shellcheck disable=SC2086 # $tarflags is a list
COPYFILE_DISABLE=1 tar -czf "$out/$archive" $tarflags -C "$stage" signalbox

# shellcheck disable=SC2086 # $sum is a list
(cd "$out" && $sum "$archive" >checksums.txt)
echo "wrote to $out:"
(cd "$out" && ls -l "$archive" checksums.txt)
