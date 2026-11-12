import { describe, expect, test } from "bun:test";
import type { Page } from "playwright";
import { registryFor } from "../../src/actions/ref-registry.js";
import { guardRef } from "../../src/actions/ref-guard.js";
import { SENSITIVE_RULES, sensitiveCategory } from "../../src/actions/sensitive-vocab.js";
import type { InteractiveElement } from "../../src/interfaces/extraction.js";

const el = (ref: string, text: string, frame = 0): InteractiveElement => ({
  index: 0,
  ref,
  frame: frame || undefined,
  tag: "button",
  text,
  role: null,
  id: null,
  name: null,
  type: null,
  href: null,
  visible: true,
  box: { x: 0, y: 0, width: 1, height: 1 },
});

describe("RefRegistry", () => {
  test("a page without an agent-facing snapshot has no valid refs (new tab, recovered page)", async () => {
    const page = {} as Page;
    expect(registryFor(page).active).toBe(false);
    const r = await guardRef(page, "3");
    expect(r?.error).toBe("ref_stale");
    expect(r?.reason).toBe("no_snapshot");
  });

  test("begin() bumps the generation and replaces entries; merge() adds without refreshing", () => {
    const reg = registryFor({} as Page);
    expect(reg.begin({ elements: [el("0", "Cancel")], docs: { 0: "d1" } })).toBe(1);
    reg.merge({ elements: [el("5", "New"), el("0", "Renamed")], docs: { 0: "d1" } });
    expect(reg.get("5")?.text).toBe("New");
    expect(reg.get("0")?.text).toBe("Renamed");
    expect(reg.begin({ elements: [el("5", "New")], docs: { 0: "d1" } })).toBe(2);
    expect(reg.get("0")).toBeUndefined();
  });

  test("a changed document token drops that frame's refs", () => {
    const reg = registryFor({} as Page);
    reg.begin({ elements: [el("0", "A"), el("1:0", "InFrame", 1)], docs: { 0: "d1", 1: "f1" } });
    reg.merge({ elements: [], docs: { 1: "f2" } });
    expect(reg.get("1:0")).toBeUndefined();
    expect(reg.get("0")?.text).toBe("A");
    expect(reg.docOf(1)).toBe("f2");
  });

  test("guardRef refuses a ref that is not in the last snapshot (frame gone -> ref_stale)", async () => {
    const page = { frames: () => [] } as unknown as Page;
    registryFor(page).begin({ elements: [el("0", "A")], docs: { 0: "d1" } });
    const unknown = await guardRef(page, "9");
    expect(unknown?.error).toBe("ref_stale");
    expect(unknown?.reason).toBe("not_in_snapshot");
    const gone = await guardRef(page, "0");
    expect(gone?.error).toBe("ref_stale");
    expect(gone?.reason).toBe("element_gone");
    expect(String(gone?.hint)).toContain("browser_snapshot");
  });
});

describe("sensitive vocabulary", () => {
  test("data table, destructive and payment, EN and FR", () => {
    expect(SENSITIVE_RULES.length).toBeGreaterThan(1);
    expect(sensitiveCategory("Delete account")).toBe("destructive");
    expect(sensitiveCategory("Cancel subscription")).toBe("destructive");
    expect(sensitiveCategory("Supprimer le compte")).toBe("destructive");
    expect(sensitiveCategory("Pay now")).toBe("payment");
    expect(sensitiveCategory("Place your order")).toBe("payment");
  });

  test("unsubscribe (EN/FR) and remove-with-object are destructive", () => {
    for (const t of ["Unsubscribe", "Se désabonner", "Remove account", "Remove all", "Erase history", "Effacer le compte"]) {
      expect(sensitiveCategory(t)).toBe("destructive");
    }
  });

  test("French elision and filter-like objects", () => {
    expect(sensitiveCategory("Effacer l'historique")).toBe("destructive");
    expect(sensitiveCategory("Effacer l’historique")).toBe("destructive");
    expect(sensitiveCategory("Supprimer le compte")).toBe("destructive");
    for (const t of ["Supprimer le filtre", "Supprimer la recherche", "Delete filter", "Delete this tag"]) {
      expect(sensitiveCategory(t)).toBeNull();
    }
  });

  test("newsletter Subscribe and bare Remove/Effacer are not sensitive", () => {
    for (const t of ["Subscribe", "Remove filter", "Remove tag", "Effacer", "Effacer le filtre"]) {
      expect(sensitiveCategory(t)).toBeNull();
    }
  });

  test("harmless controls do not match", () => {
    for (const t of ["Cancel", "Save", "Search", "Sign in", "Confirm email", "Undelete"]) {
      expect(sensitiveCategory(t)).toBeNull();
    }
  });
});
