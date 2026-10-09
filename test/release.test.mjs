// The release script (scripts/release.sh): what its archive holds, and that
// this is all the serve script needs. It is run on a copy of the tree with a
// page of two files, and packs only: the install, the checks and the build
// are the gate's, and this test is one of them.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";

const here = fileURLToPath(new URL("..", import.meta.url));
const script = readFileSync(join(here, "scripts/release.sh"), "utf8");

// The script's list, read where the script has it.
const files = script.match(/^files="([^"]+)"$/m)[1].split(" ");

const dir = mkdtempSync(join(tmpdir(), "signalbox-release-"));
afterAll(() => rmSync(dir, { recursive: true }));

// A tree the script can pack: the listed files as they are, a page in the
// place of the built one, and the two files the version is written into.
function tree(name) {
  const root = join(dir, name);
  for (const file of [...files.filter((f) => f !== "dist"), "scripts/release.sh", "package.json", "package-lock.json"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(here, file), join(root, file));
  }
  mkdirSync(join(root, "dist/assets"), { recursive: true });
  writeFileSync(join(root, "dist/index.html"), "<!doctype html><title>signalbox</title>");
  writeFileSync(join(root, "dist/assets/index.js"), "");
  return root;
}

const pack = (root, version, env = {}) =>
  spawnSync("sh", ["scripts/release.sh", version, "out"], { cwd: root, encoding: "utf8", env: { ...process.env, SIGNALBOX_RELEASE_PACK: "1", ...env } });

// The members of a tar, from its headers: a block of 512 bytes before each
// member's content, and two empty ones at the end.
function members(tar) {
  const text = (at, length) => tar.subarray(at, at + length).toString("utf8").replace(/\0.*$/s, "");
  const found = [];
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const size = parseInt(text(at + 124, 12), 8);
    found.push({
      name: text(at + 345, 155) === "" ? text(at, 100) : `${text(at + 345, 155)}/${text(at, 100)}`,
      uid: parseInt(text(at + 108, 8), 8),
      gid: parseInt(text(at + 116, 8), 8),
      type: String.fromCharCode(tar[at + 156]),
      user: text(at + 265, 32),
      group: text(at + 297, 32),
    });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return found;
}

describe("the release script", () => {
  test("packs the listed files under signalbox/, with nothing of the machine that packed them", () => {
    const root = tree("pack");
    // What a Mac puts on a file it made, and bsdtar would pack with it.
    if (process.platform === "darwin") execFileSync("xattr", ["-w", "com.example.signalbox", "here", join(root, "README.md")]);
    const ran = pack(root, "v1.2.3-rc.1");
    expect(ran.status, ran.stderr).toBe(0);

    const archive = join(root, "out/signalbox_1.2.3-rc.1.tar.gz");
    const packed = members(gunzipSync(readFileSync(archive)));
    expect(packed.map((m) => m.name).sort()).toEqual(
      [
        "signalbox/",
        "signalbox/INSTALL.md",
        "signalbox/LICENSE",
        "signalbox/NOTICE",
        "signalbox/README.md",
        "signalbox/dist/",
        "signalbox/dist/assets/",
        "signalbox/dist/assets/index.js",
        "signalbox/dist/index.html",
        "signalbox/scripts/",
        "signalbox/scripts/serve.mjs",
        "signalbox/scripts/yard.mjs",
        "signalbox/src/",
        "signalbox/src/layout.ts",
        "signalbox/src/project.ts",
        "signalbox/src/yard.ts",
      ].sort(),
    );
    for (const member of packed) {
      // A file or a directory: an extended header (x, g) is where a tar
      // keeps a file's attributes, and ._ is where a Mac's keeps them.
      expect(["0", "5"], member.name).toContain(member.type);
      expect(member, member.name).toMatchObject({ uid: 0, gid: 0, user: "", group: "" });
    }

    // The sum is the archive's, by its name alone.
    const sum = execFileSync("shasum", ["-a", "256", archive], { encoding: "utf8" }).split(" ")[0];
    expect(readFileSync(join(root, "out/checksums.txt"), "utf8")).toBe(`${sum}  signalbox_1.2.3-rc.1.tar.gz\n`);

    // The version is the tag's, in both files that have one.
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version).toBe("1.2.3-rc.1");
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    expect([lock.version, lock.packages[""].version]).toEqual(["1.2.3-rc.1", "1.2.3-rc.1"]);
  });

  test("refuses what is no tag", () => {
    const root = tree("usage");
    for (const version of [undefined, "1.2.3", "v1.2", "latest"]) {
      const ran = pack(root, ...(version === undefined ? [] : [version]));
      expect(ran.status).toBe(2);
      expect(ran.stderr).toContain("usage: scripts/release.sh <version>");
    }
    expect(existsSync(join(root, "out"))).toBe(false);
  });

  test("refuses a node older than package.json asks for", () => {
    const root = tree("node");
    // A node that says only how old it is, before the system's.
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const old = (version) => {
      writeFileSync(join(bin, "node"), `#!/bin/sh\necho ${version}\n`);
      chmodSync(join(bin, "node"), 0o755);
      return pack(root, "v1.2.3", { PATH: `${bin}:${process.env.PATH}` });
    };
    for (const version of ["v22.5.9", "v20.19.0"]) {
      const ran = old(version);
      expect(ran.status, version).toBe(1);
      expect(ran.stderr).toContain(`node is ${version.slice(1)}; package.json asks for 22.6 or later`);
    }
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines).toEqual({ node: ">=22.6" });
    expect(existsSync(join(root, "out/checksums.txt"))).toBe(false);
  });
});

// What a file imports and node loads: every import and re-export but one of
// types alone, which node strips with the types. One that names a type among
// values (import { type A }) is loaded, so it counts.
function imports(source) {
  const found = [];
  for (const [, type, from] of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm)) if (type === undefined) found.push(from);
  for (const [, from] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(from);
  return found;
}

// Every file the serve script loads, from the files it starts at; and what
// it names that is no file of the tree, nor node's own.
function loaded(root, starts) {
  const seen = new Set();
  const foreign = [];
  const follow = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!/\.(ts|mjs|js)$/.test(file) || !existsSync(join(root, file))) return;
    for (const from of imports(readFileSync(join(root, file), "utf8"))) {
      if (from.startsWith("node:")) continue;
      if (!from.startsWith(".")) foreign.push(`${file}: ${from}`);
      else follow(relative(root, resolve(root, dirname(file), from)));
    }
  };
  for (const start of starts) follow(start);
  return { files: [...seen].sort(), foreign };
}

const carried = (file) => files.some((f) => f === file || file.startsWith(`${f}/`));

describe("the release's file list", () => {
  test("reads the imports node loads, and no others", () => {
    expect(imports('import { a } from "./a.ts";\nimport type { B } from "./b";\nimport {\n  c,\n  type D,\n} from "../c.mjs";\nexport * from "./e.ts";\nexport type { F } from "./f";\nimport "./g.mjs";\nconst h = await import("./h.ts");')).toEqual([
      "./a.ts",
      "../c.mjs",
      "./e.ts",
      "./g.mjs",
      "./h.ts",
    ]);
  });

  test("carries every file the serve script loads", () => {
    const { files: needs, foreign } = loaded(here, ["scripts/serve.mjs", "scripts/yard.mjs"]);
    // The archive has no node_modules: the script runs on node alone.
    expect(foreign).toEqual([]);
    expect(needs).toEqual(["scripts/serve.mjs", "scripts/yard.mjs", "src/layout.ts", "src/project.ts"]);
    expect(needs.filter((file) => !carried(file))).toEqual([]);
  });

  test("fails for an import the list does not carry", () => {
    const root = join(dir, "imports");
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "scripts/serve.mjs"), 'import { place } from "../src/layout.ts";\nimport three from "three";\n');
    writeFileSync(join(root, "src/layout.ts"), 'import type { Yard } from "./yard";\nimport { state } from "./replay.ts";\n');
    writeFileSync(join(root, "src/replay.ts"), "");
    const { files: needs, foreign } = loaded(root, ["scripts/serve.mjs"]);
    expect(foreign).toEqual(["scripts/serve.mjs: three"]);
    expect(needs.filter((file) => !carried(file))).toEqual(["src/replay.ts"]);
  });
});
