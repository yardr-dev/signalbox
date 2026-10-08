// The one thing of node's the tests use: reading a file of the kit. The
// project has no types of node's, for the page uses none of it.
declare module "node:fs/promises" {
  export function readFile(path: URL): Promise<Uint8Array<ArrayBuffer>>;
}
