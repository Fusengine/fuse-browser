import { describe, expect, test } from "bun:test";
import { findElements } from "../../src/extraction/find-elements.js";
import type { InteractiveElement } from "../../src/interfaces/extraction.js";

const el = (index: number, text: string, extra: Partial<InteractiveElement> = {}): InteractiveElement => ({
  index,
  ref: String(index),
  tag: "button",
  text,
  role: null,
  id: null,
  name: null,
  type: null,
  href: null,
  visible: true,
  box: { x: 0, y: 0, width: 1, height: 1 },
  ...extra,
});

const page = [el(0, "Save draft"), el(1, "Save"), el(2, "Cancel"), el(3, "", { role: "tab", text: "Settings" }), el(4, "x", { tag: "input", placeholder: "Search the docs" })];

describe("findElements", () => {
  test("exact name ranks before prefix before contains; DOM order breaks ties", () => {
    const r = findElements(page, "save", 10);
    expect(r.total).toBe(2);
    expect(r.matches.map((m) => m.ref)).toEqual(["1", "0"]);
  });

  test("every token must match, case-insensitive, across name/role/placeholder", () => {
    expect(findElements(page, "SEARCH docs", 10).matches.map((m) => m.ref)).toEqual(["4"]);
    expect(findElements(page, "tab", 10).matches.map((m) => m.ref)).toEqual(["3"]);
    expect(findElements(page, "save cancel", 10).total).toBe(0);
  });

  test("limit cuts the list but total keeps the full count; blank query matches nothing", () => {
    const many = Array.from({ length: 30 }, (_, i) => el(i, `row ${i}`));
    const r = findElements(many, "row", 5);
    expect(r.matches.length).toBe(5);
    expect(r.total).toBe(30);
    expect(findElements(many, "   ", 5)).toEqual({ matches: [], total: 0 });
  });
});
