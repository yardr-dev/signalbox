// Write the layout's memory beside a snapshot: the slot of every depot, flow,
// stage, peer and provider's tower (src/layout.ts, place). A depot, a flow, a
// peer and a tower keep the slot the file gave them. A flow's stages are
// seated again when they, or the order a bead travels them, are not the ones
// the file holds.
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
