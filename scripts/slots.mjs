// Write the layout's memory beside a snapshot: the slot of every depot, flow,
// stage and peer (src/layout.ts, place). Slots the file holds are kept, so
// what was drawn stays where it was; only what is new in the snapshot is added.
//
//   node scripts/slots.mjs <yard.json> <layout.json>
//
// node runs the layout's TypeScript as it is: it has only types to strip.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { place } from "../src/layout.ts";

const [yard, out] = process.argv.slice(2);
if (yard === undefined || out === undefined) {
  console.error("usage: slots.mjs <yard.json> <layout.json>");
  process.exit(2);
}
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const slots = place(read(yard), existsSync(out) ? read(out) : {});
writeFileSync(out, `${JSON.stringify(slots, null, 2)}\n`);
