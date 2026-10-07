#!/bin/sh
# Write public/yard.json: the structure of a yardr yard, as the page draws it,
# bring layout.json beside it up to date: the slots its elements stand in, and
# write events.json there too: the yard's last events, for the page to replay.
# Everything comes from the yard's own commands (yardr ... --json), never from
# its store or socket. src/yard.ts and src/replay.ts hold the shapes of the
# files as types.
#
#   scripts/snapshot.sh [out]     YARDR=/path/to/yardr to name the binary
#
# Each list is cut down to the fields the picture needs: the commands also
# print bead bodies, paths on the machine, secret files and process handles,
# and the file is committed and served. src/project.ts does the cutting, for
# these files and for the serve script (scripts/serve.mjs) alike.
set -eu

here=$(dirname "$0")
out=${1:-"$here/../public/yard.json"}

node "$here/snapshot.mjs" "$out"

# The layout's memory: written when it is missing, and given what is new in
# this snapshot otherwise. What it holds already is never changed.
node "$here/slots.mjs" "$out" "$(dirname "$out")/layout.json"
