// The pages a reader is sent through: the README, INSTALL.md, CONTRIBUTING.md
// and the reference in docs/. The README is kept short, so it is mostly links,
// and a moved page or a renamed heading would leave one pointing at nothing.
// This follows every link to a file of the repository, and to a heading where
// the link names one, as yardr's README test does.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const here = fileURLToPath(new URL("..", import.meta.url));
const pages = ["README.md", "INSTALL.md", "CONTRIBUTING.md", ...readdirSync(join(here, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];

// The links of a page that name no other site: [text](target), an image's too.
const links = (page) => [...page.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((to) => !to.includes("://"));

// The anchor of each heading of a page, as GitHub makes it: lower case,
// spaces to hyphens, everything but letters, figures, hyphens and
// underscores dropped. A heading inside a code block is no heading.
function anchors(page) {
  const found = [];
  let fenced = false;
  for (const line of page.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = fenced ? null : line.match(/^#+\s+(.*)$/);
    if (heading) found.push(heading[1].trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replaceAll(" ", "-"));
  }
  return found;
}

// The links of a page that lead nowhere, each as the page writes it.
function dead(root, name) {
  const lost = [];
  for (const to of links(readFileSync(join(root, name), "utf8"))) {
    const [file, anchor] = to.split("#");
    const target = file === "" ? name : join(dirname(name), file);
    if (!existsSync(join(root, target))) lost.push(to);
    else if (anchor && !anchors(readFileSync(join(root, target), "utf8")).includes(anchor)) lost.push(to);
  }
  return lost;
}

describe("the pages' links", () => {
  test.each(pages)("%s links only to what is there", (name) => {
    expect(dead(here, name)).toEqual([]);
  });

  test("the README names its picture and its pages", () => {
    // Not for want of looking: these are the links the README is made of.
    expect(links(readFileSync(join(here, "README.md"), "utf8"))).toEqual(expect.arrayContaining(["docs/yard.png", "INSTALL.md", "docs/look.md", "docs/replay.md", "docs/code.md", "CONTRIBUTING.md", "LICENSE", "NOTICE"]));
  });

  test("INSTALL.md names the licence the archive holds, and the look outside it", () => {
    // scripts/release.sh packs LICENSE and NOTICE with the page. The look
    // moved to docs/look.md, and that page is not in the archive, so a
    // reader of INSTALL.md is sent to the source for it.
    const install = readFileSync(join(here, "INSTALL.md"), "utf8");
    const what = install.slice(install.indexOf("What is in it:"), install.indexOf("\n## Run"));
    expect(what).toContain("`LICENSE`");
    expect(what).toContain("`NOTICE`");
    const shows = install.slice(install.indexOf("## What the page shows"), install.indexOf("\n## Trouble"));
    expect(shows).toContain("`docs/look.md`");
    expect(shows).toContain("https://github.com/yardr-dev/signalbox");
    expect(shows).toContain("This archive does not hold that");
    expect(shows).not.toContain("full key and the look");
  });

  test("the pull request template has three prompts", () => {
    expect(readFileSync(join(here, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8").trim().split("\n")).toEqual(["What:", "Why:", "How tested:"]);
  });

  test("a link to a missing file or heading is found", () => {
    expect(links("[a](b.md) ![c](d.png) [e](https://example.com/f) (g) [h](#i)")).toEqual(["b.md", "d.png", "#i"]);
    expect(anchors("# Following a yard as it runs\n```\n# not one\n```\n## `npm run live`, twice")).toEqual(["following-a-yard-as-it-runs", "npm-run-live-twice"]);

    const root = mkdtempSync(join(tmpdir(), "signalbox-docs-"));
    try {
      mkdirSync(join(root, "docs"));
      writeFileSync(join(root, "README.md"), "# Top\n[a](docs/a.md) [b](docs/a.md#there) [c](docs/a.md#gone) [d](docs/gone.md) [e](#top) [f](#gone)");
      writeFileSync(join(root, "docs/a.md"), "## There\n[up](../README.md) [lost](README.md) ![g](gone.png)");
      expect(dead(root, "README.md")).toEqual(["docs/a.md#gone", "docs/gone.md", "#gone"]);
      expect(dead(root, "docs/a.md")).toEqual(["README.md", "gone.png"]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
