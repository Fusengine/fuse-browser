/**
 * Session block verdict on captcha WIDGET shapes, through the real `browser_navigate` /
 * `browser_extract` tools: a visitor-facing widget (even an empty container whose iframe
 * renders late) is evidence; invisible reCAPTCHA (button-bound, v3 badge, zero-size or
 * `size=invisible` iframe) is not. Local fixture server; third-party hosts are aborted.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, withClient } from "../integration/helpers/safe-actions-harness.js";
import { type FixtureServer, serveFixtures } from "./helpers/fixture-server.js";

let site: FixtureServer;
beforeAll(() => {
  site = serveFixtures({
    // empty h-captcha CONTAINER whose 303x78 iframe is injected after load (real widgets render late)
    "/hcaptcha-delayed": {
      status: 200,
      body:
        `<html><body><div class="h-captcha" data-sitekey="k"></div><script>setTimeout(() => {` +
        `const f = document.createElement("iframe"); f.src = "https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html"; f.width = 303; f.height = 78;` +
        `document.querySelector(".h-captcha").appendChild(f);}, 1500);</script></body></html>`,
    },
    // Google-documented invisible reCAPTCHA binding: <button class="g-recaptcha"> (developers.google.com/recaptcha/docs/invisible)
    "/confirm-invisible": {
      status: 200,
      body: `<html><body><h1>Confirm your subscription</h1><p>Click below to confirm.</p><form action="/c" method="post"><button class="g-recaptcha" data-sitekey="k" data-callback="onSubmit">Confirm</button></form></body></html>`,
    },
    // reCAPTCHA v3 badge iframe on a thin thank-you page (src shape supposed, not measured on a live site)
    "/thanks-v3-badge": {
      status: 200,
      body: `<html><body><h1>Thank you</h1><p>Your order is confirmed.</p><div class="grecaptcha-badge"><iframe src="about:blank?recaptcha/api2/anchor&size=invisible"></iframe></div></body></html>`,
    },
    // invisible / zero-size challenge iframes are not a human step either
    "/thanks-hidden-iframe": {
      status: 200,
      body: `<html><body><h1>Thank you</h1><iframe src="about:blank?recaptcha/api2/bframe" style="width:0;height:0;border:0"></iframe></body></html>`,
    },
  });
});
afterAll(() => site.stop());

describe("a visitor-facing widget on a short page is evidence", () => {
  test("empty h-captcha container: blocked at navigate (iframe not rendered yet) and after it renders", async () => {
    await withClient(async (c, sessionId, page) => {
      await page.context().route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const nav = await call(c, "browser_navigate", { sessionId, url: `${site.origin}/hcaptcha-delayed` });
      expect(nav.blocked).toBe(true);
      expect(nav.blockedBy).toBe("unknown");
      await page.waitForSelector(".h-captcha iframe");
      const ext = await call(c, "browser_extract", { sessionId, kind: "text" });
      expect(ext.blocked).toBe(true);
      expect(ext.blockedBy).toBe("unknown");
    }, "about:blank");
  }, 60_000);
});

describe("invisible reCAPTCHA is never a block", () => {
  for (const path of ["/confirm-invisible", "/thanks-v3-badge", "/thanks-hidden-iframe"]) {
    test(path, async () => {
      await withClient(async (c, sessionId, page) => {
        await page.context().route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
        const nav = await call(c, "browser_navigate", { sessionId, url: `${site.origin}${path}` });
        expect(Object.keys(nav).sort()).toEqual(["title", "url"]);
        const ext = await call(c, "browser_extract", { sessionId, kind: "text" });
        expect(Object.keys(ext).sort()).toEqual(["text", "url"]);
        const all = await call(c, "browser_extract", { sessionId });
        expect(Object.keys(all).sort()).toEqual(["challenges", "hotelOffers", "prices", "text", "url"]);
      }, "about:blank");
    }, 60_000);
  }
});
