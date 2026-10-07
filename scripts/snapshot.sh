#!/bin/sh
# Write public/yard.json: the structure of a yardr yard, as the page draws it,
# bring layout.json beside it up to date: the slots its elements stand in, and
# write events.json there too: the yard's last events, for the page to replay,
# and quota.json: what is left of the providers' quota, from aiquokka --json
# (AIQUOKKA=/path/to/aiquokka), for the coaling towers. Without aiquokka there
# is no quota.json, and the page draws no tower.
# Everything of the yard comes from its web view (yardr web serve, which has
# to run), never from its store or socket, and no command of yardr's is run.
# src/yard.ts and src/replay.ts hold the shapes of the files as types.
#
#   scripts/snapshot.sh [out]     YARDR_WEB=http://127.0.0.1:8791 names the view
#
# Each list is cut down to the fields the picture needs: the view also
# answers bead bodies, paths on the machine, secret files and process handles,
# and the file is committed and served. src/project.ts does the cutting, for
# these files and for the serve script (scripts/serve.mjs) alike.
set -eu

here=$(dirname "$0")
out=${1:-"$here/../public/yard.json"}

node "$here/snapshot.mjs" "$out"

# The layout's memory: written when it is missing, and given what is new in
# this snapshot otherwise. What it holds already is never changed.
node "$here/slots.mjs" "$out" "$(dirname "$out")/layout.json"
