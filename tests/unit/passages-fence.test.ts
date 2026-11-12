import { describe, expect, test } from "bun:test";
import { splitPassages } from "../../src/extraction/passages-split.js";

// CommonMark fenced code blocks: a closing fence uses the SAME character as the opening
// one, is at least as long, and carries no info string. A `# line` inside a fence is code,
// never a heading.

const headings = (md: string): string[] => splitPassages(md).map((c) => c.heading);
const bodyOf = (md: string, heading: string): string => splitPassages(md).find((c) => c.heading === heading)?.text ?? "";

describe("fenced code blocks and headings", () => {
  test("a ~~~ line inside a ``` block does not close it", () => {
    const md = "```\n~~~\n# not a heading\n```\n# Real\nreal body";
    expect(headings(md)).toEqual(["", "Real"]);
    expect(bodyOf(md, "")).toContain("# not a heading");
  });

  test("a ``` line inside a ~~~ block does not close it", () => {
    const md = "~~~\n```\n# not a heading\n~~~\n# Real\nreal body";
    expect(headings(md)).toEqual(["", "Real"]);
  });

  test("a shorter fence does not close a longer one; an equal or longer one does", () => {
    const md = "````\n```\n# still code\n````\n# Out\nout body";
    expect(headings(md)).toEqual(["", "Out"]);
    expect(bodyOf(md, "")).toContain("# still code");
    expect(headings("```\n# code\n`````\n# After\nbody")).toEqual(["", "After"]); // longer closes
  });

  test("a fence line with an info string does not close a block", () => {
    const md = "```\n```js\n# code\n```\n# Real\nbody";
    expect(headings(md)).toEqual(["", "Real"]);
  });

  test("a backtick line whose info string contains a backtick is inline code, not a fence (CommonMark 0.31.2)", () => {
    const md = "```js``` is inline code\n\n# Install\ninstall body\n\n# Usage\nusage body";
    expect(headings(md)).toEqual(["", "Install", "Usage"]);
    expect(headings("``` `x`\n# Real\nbody")).toEqual(["", "Real"]);
  });

  test("a tilde fence may carry backticks in its info string", () => {
    expect(headings("~~~ `x`\n# code\n~~~\n# Real\nbody")).toEqual(["", "Real"]);
    expect(bodyOf("~~~ `x`\n# code\n~~~\n# Real\nbody", "")).toContain("# code");
  });

  test("an unterminated fence swallows the rest (no heading inside it)", () => {
    expect(headings("intro\n```\n# code\n# more code")).toEqual([""]);
  });

  test("ordinary headings around a well-formed fence are unchanged", () => {
    expect(headings("# A\na\n```\n# c\n```\n## B\nb")).toEqual(["A", "B"]);
  });
});
