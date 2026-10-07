// Write a snapshot of the yard: yard.json and, beside it, events.json and
// quota.json, what is left of the providers' quota (aiquokka --json).
//
//   node scripts/snapshot.mjs <yard.json>
//
// scripts/snapshot.sh is the way in: it brings layout.json up to date after.
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { quota, snapshot, yardr } from "./yard.mjs";

const [out] = process.argv.slice(2);
if (out === undefined) {
  console.error("usage: snapshot.mjs <yard.json>");
  process.exit(2);
}
const { yard, log } = await snapshot(yardr());
// The quota is no part of the yard, and a snapshot is one without it: the
// page then draws no tower.
const fuel = await quota().catch((err) => {
  console.error(`snapshot: no quota.json: ${err.message}`);
  return undefined;
});
const beside = join(dirname(out), "quota.json");
// Both are asked before either is written, and each is written whole: a
// command that fails leaves the files as they were.
const files = [
  [out, yard],
  [join(dirname(out), "events.json"), log],
  ...(fuel !== undefined ? [[beside, fuel]] : []),
];
for (const [path, value] of files) writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
for (const [path] of files) renameSync(`${path}.tmp`, path);
// An older one would be shown as this snapshot's.
if (fuel === undefined) rmSync(beside, { force: true });
