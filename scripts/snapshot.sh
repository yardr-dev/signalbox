#!/bin/sh
# Write public/yard.json: the structure of a yardr yard, as the page draws it,
# and bring layout.json beside it up to date: the slots its elements stand in.
# Everything comes from the yard's own commands (yardr ... --json), never from
# its store or socket. src/yard.ts holds the shape of the file as types.
#
#   scripts/snapshot.sh [out]     YARDR=/path/to/yardr to name the binary
#
# Each list is cut down to the fields the picture needs: the commands also
# print bead bodies, paths on the machine, secret files and process handles,
# and the file is committed and served.
set -eu

yardr=${YARDR:-yardr}
out=${1:-"$(dirname "$0")/../public/yard.json"}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

"$yardr" depot list --json >"$tmp/depots"
"$yardr" group list --json >"$tmp/groups"
"$yardr" route list --json >"$tmp/routes"
"$yardr" crew list --json >"$tmp/crew"
"$yardr" peer list --json >"$tmp/peers"
# Without -a or --all: every open bead.
"$yardr" bead list --json >"$tmp/beads"

# One file of flows per depot, in the order of depot list: {depot, flows}.
: >"$tmp/flows"
jq -r '.[].name' "$tmp/depots" | while IFS= read -r depot; do
  "$yardr" flow show "$depot" --json | jq --arg depot "$depot" '{depot: $depot, flows: .}' >>"$tmp/flows"
done

jq -n \
  --arg taken_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --slurpfile depots "$tmp/depots" \
  --slurpfile flows "$tmp/flows" \
  --slurpfile groups "$tmp/groups" \
  --slurpfile routes "$tmp/routes" \
  --slurpfile crew "$tmp/crew" \
  --slurpfile peers "$tmp/peers" \
  --slurpfile beads "$tmp/beads" '
  # Drop the keys whose value is null, as yardr leaves out what is unset.
  def tidy: with_entries(select(.value != null));
  {
    taken_at: $taken_at,
    depots: [$depots[0][] | {name, kind, base} | tidy],
    flows: [$flows[] | {
      depot,
      flows: [.flows[] | {
        name: .flow.name,
        type,
        stages: [.stages[] | {stage, group, next, human, terminal} | tidy]
      } | tidy]
    }],
    groups: [$groups[0][] | {name, runner, limit, members} | tidy],
    routes: [$routes[0][] | {stage, type, depot, label, group, priority} | tidy],
    crew: [$crew[0][] | {name, kind: .config.kind, state, status} | tidy],
    peers: [$peers[0][] | {name, send, receive} | tidy],
    beads: [$beads[0][] | {id, title, type, stage, depot, group, working: (.session != null), train, labels, priority, created_at} | tidy]
  }' >"$tmp/yard.json"

mv "$tmp/yard.json" "$out"

# The layout's memory: written when it is missing, and given what is new in
# this snapshot otherwise. What it holds already is never changed.
node "$(dirname "$0")/slots.mjs" "$out" "$(dirname "$out")/layout.json"
