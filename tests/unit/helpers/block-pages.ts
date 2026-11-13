/**
 * Page matrix shared by the block-detection tests: BLOCKED pages (real captured
 * interstitials + synthetic ones) and NOT-blocked pages (normal, sparse,
 * look-alike). Served through the fixture server and fed to the pure detector.
 */
import { type FixtureRoute, loadHtml, routeFromCaptured } from "./fixture-server.js";

const PROSE =
  "The committee reviewed the annual report and discussed the findings at length. " +
  "Several members raised questions about the methodology, and the authors answered each one in turn. ";

/** A realistic article page with enough prose to clear every sparse-page threshold. */
export function article(title: string, extra = ""): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><title>${title}</title></head><body>` +
    `<nav>Home About Contact</nav><article><h1>${title}</h1>` +
    `<p>${PROSE.repeat(8)}</p><p>${extra}</p><p>${PROSE.repeat(4)}</p></article><footer>Copyright</footer></body></html>`
  );
}

/** Real captured interstitials, keyed by route path. `vendor` is the expected `blockedBy`. */
export const REAL_BLOCKED: Record<string, { route: FixtureRoute; vendor: string }> = {
  "/cf-managed": { route: routeFromCaptured("cloudflare-managed-miraheze"), vendor: "cloudflare" },
  "/cf-security": { route: routeFromCaptured("cloudflare-security-glassdoor"), vendor: "cloudflare" },
  "/cf-moment": { route: routeFromCaptured("cloudflare-just-a-moment-stockx"), vendor: "cloudflare" },
  "/datadome": { route: routeFromCaptured("datadome-g2"), vendor: "datadome" },
};

/**
 * Synthetic blocked pages. AWS WAF shape: from the AWS WAF developer guide,
 * "CAPTCHA and Challenge action behavior" (docs.aws.amazon.com/waf/latest/developerguide/
 * waf-captcha-and-challenge-actions.html): header `x-amzn-waf-action: challenge`, HTTP 202,
 * JavaScript interstitial. Generic shape: a vendor-less thin 403 with two weak signals.
 */
export const SYNTHETIC_BLOCKED: Record<string, { route: FixtureRoute; vendor: string }> = {
  "/aws-waf": {
    vendor: "aws-waf",
    route: {
      status: 202,
      headers: { "x-amzn-waf-action": "challenge" },
      body: "<html><head></head><body><script>window.awsWafCookieDomainList=[];/* challenge script */</script></body></html>",
    },
  },
  "/generic-weak": {
    vendor: "unknown",
    route: {
      status: 403,
      body:
        '<html><head><title>Pardon Our Interruption</title><meta http-equiv="refresh" content="30"></head>' +
        "<body><h1>Pardon Our Interruption</h1><p>Please enable JavaScript to continue.</p></body></html>",
    },
  },
};

/** Pages that must NEVER be flagged: every one keeps today's exact output. */
export const NOT_BLOCKED: Record<string, FixtureRoute> = {
  "/article": { status: 200, body: article("Quarterly report") },
  "/article-mentions-captcha": {
    status: 200,
    body: article(
      "How bot protection works",
      'A captcha, a "Checking your connection..." screen or "Just a moment..." page, the cf-mitigated: challenge header, ' +
        "window._cf_chl_opt and ct.captcha-delivery.com are all things this article merely talks about.",
    ),
  },
  "/real-404": {
    status: 404,
    body:
      "<html><head><title>Page not found</title></head><body><h1>Page not found</h1>" +
      "<p>We could not find the page you were looking for. It may have been moved or deleted.</p>" +
      '<p>Try the <a href="/">home page</a> or search the archive.</p></body></html>',
  },
  "/forbidden-with-text": {
    status: 403,
    body: article("Access forbidden", "You do not have permission to view this resource. Contact the administrator if you think this is a mistake."),
  },
  "/bare-403": {
    status: 403,
    body: "<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center><hr><center>nginx</center></body></html>",
  },
  "/maintenance-503": {
    status: 503,
    body: article("Down for maintenance", "We are performing scheduled maintenance and will be back shortly. Thank you for your patience."),
  },
  "/maintenance-refresh-503": {
    status: 503,
    body:
      '<html><head><title>Maintenance</title><meta http-equiv="refresh" content="60"></head>' +
      "<body><h1>We will be right back</h1><p>Scheduled maintenance in progress.</p></body></html>",
  },
  // Found by the adversarial review: two weak signals that legitimately co-occur on error pages.
  "/datadome-site-503-refresh": {
    status: 503,
    headers: { "x-datadome": "protected" },
    body:
      '<html><head><meta http-equiv="refresh" content="60"><title>Maintenance</title></head>' +
      "<body><h1>We will be back soon</h1></body></html>",
  },
  "/denied-403-refresh-to-login": {
    status: 403,
    body:
      '<html><head><title>Access Denied</title><meta http-equiv="refresh" content="5;url=/login"></head>' +
      "<body><p>You are not allowed here. Redirecting to the sign-in page.</p></body></html>",
  },
  // C: `x-datadome` rides on EVERY response of a DataDome-protected site, so it must not help two page-level hints reach the quorum.
  "/denied-403-refresh-datadome-site": {
    status: 403,
    headers: { "x-datadome": "protected" },
    body:
      '<html><head><title>Access Denied</title><meta http-equiv="refresh" content="5;url=/login"></head>' +
      "<body><p>You are not allowed here. Redirecting to the sign-in page.</p></body></html>",
  },
  // D1: one phrase ("verify you are human") in both title and text is ONE hint, not two.
  "/one-phrase-title-and-text-403": {
    status: 403,
    body:
      '<html><head><title>Verify you are human</title><meta http-equiv="refresh" content="30"></head>' +
      "<body><p>Verify you are human.</p></body></html>",
  },
  // D2: a thin 200 SPA shell whose CSP meta merely whitelists the DataDome challenge host.
  "/spa-csp-captcha-delivery": {
    status: 200,
    body:
      '<html><head><meta http-equiv="Content-Security-Policy" content="frame-src https://*.captcha-delivery.com"></head>' +
      '<body><div id="root"></div><script src="/a.js"></script></body></html>',
  },
  // D3: a long 403 that quotes the Cloudflare option name in prose (no assignment, no script).
  "/thick-403-quotes-cf-opt": {
    status: 403,
    body: article("Forbidden", "Challenge pages define window._cf_chl_opt before loading their script."),
  },
  "/security-check-401-noscript": {
    status: 401,
    body:
      "<html><head><title>Security Check</title></head><body><p>Sign in required.</p>" +
      "<noscript>Please enable JavaScript to use this form.</noscript></body></html>",
  },
  "/rate-limited-429": {
    status: 429,
    headers: { "retry-after": "30" },
    body: article("Too many requests", "You have sent too many requests in a given amount of time. Please retry later."),
  },
  "/spa-shell": {
    status: 200,
    body: '<html><body><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>',
  },
  "/login": { status: 200, body: loadHtml("sparse-login.html") },
  "/listing": { status: 200, body: loadHtml("smf-board.html") },
  "/datadome-header-only": {
    status: 200,
    headers: { "x-datadome": "protected" },
    body: article("Protected shop front page"),
  },
  "/datadome-tag-article": {
    status: 200,
    body: article("Protected article").replace("</body>", '<script src="https://ct.captcha-delivery.com/c.js"></script></body>'),
  },
  "/json-403": { status: 403, contentType: "application/json", body: '{"error":"forbidden"}' },
};
