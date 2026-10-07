// Write a snapshot of the yard: yard.json and, beside it, events.json.
//
//   node scripts/snapshot.mjs <yard.json>
//
// scripts/snapshot.sh is the way in: it brings layout.json up to date after.
import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { snapshot, yardr } from "./yard.mjs";

const [out] = process.argv.slice(2);
if (out === undefined) {
  console.error("usage: snapshot.mjs <yard.json>");
  process.exit(2);
}
const { yard, log } = await snapshot(yardr());
// Both are asked before either is written, and each is written whole: a
// command that fails leaves the files as they were.
const files = [
  [out, yard],
  [join(dirname(out), "events.json"), log],
];
for (const [path, value] of files) writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
for (const [path] of files) renameSync(`${path}.tmp`, path);
