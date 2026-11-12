/**
 * Orchestrate a single probe run: launch, navigate, act, capture, report.
 * @module agent/probe-run
 */
import { join } from "node:path";
import { type ActionInput } from "../actions/perform.js";
import { prepareBookingCurrency } from "../consent/booking-currency.js";
import { handleCommonConsent } from "../consent/consent.js";
import { applyCurrencyPreference } from "../consent/currency.js";
import { urlWithCurrency } from "../consent/currency-url.js";
import { selectEngineForConfig } from "../engine/registry.js";
import { teardownOpened } from "../engine/teardown.js";
import { mainText } from "../extraction/main-text.js";
import { visualObservation } from "../extraction/visual.js";
import type { Challenges } from "../interfaces/extraction.js";
import type { ProbeReport } from "../interfaces/report.js";
import type { ProbeOptions } from "../interfaces/types.js";
import { sha1 } from "../lib/fs.js";
import { withBreaker } from "../net/breaker-guard.js";
import { DEFAULT_GOTO, gotoWithRetry } from "../net/navigate.js";
import { assertRobotsAllowed } from "../net/robots-guard.js";
import { throttleHost } from "../net/throttle.js";
import { reportProxyBlocked } from "../proxy/pool.js";
import { persistStorageState } from "../session/persist-auth.js";
import { domSignature } from "../state/dom-signature.js";
import { runActions } from "./actions-loop.js";
import type { ResolvedConfig } from "./config.js";
import { detectAndSolve } from "./detect.js";
import { reExtractIfEmpty, settleLoad } from "./probe-settle.js";
import { attachListeners } from "./network.js";
import { extractSerpStep } from "./serp-step.js";
import { huntContacts } from "./contact-hunt.js";
import { buildReport } from "./report.js";

/**
 * Report a pool proxy as blocked when the page is a block/challenge (Cloudflare,
 * a captcha widget or an AWS WAF challenge). No-op for non-pool proxies or when
 * challenges were not detected.
 *
 * @param config - Resolved config (proxy source and URL).
 * @param challenges - Result of the challenge detection (`{}` when it did not run).
 * @param report - Reporter, injectable for tests.
 */
export function reportBlockedProxy(
  config: Pick<ResolvedConfig, "proxySource" | "proxyUrl">,
  challenges: Partial<Challenges>,
  report: (proxyUrl: string) => void = reportProxyBlocked,
): void {
  if (config.proxySource !== "pool" || !config.proxyUrl || !("cloudflare" in challenges)) return;
  if (challenges.cloudflare || challenges.captcha || challenges.awsWaf) report(config.proxyUrl);
}

/** Run one probe against `url` and return the assembled report. */
export async function runProbe(
  config: ResolvedConfig,
  url: string,
  options: ProbeOptions = {},
): Promise<ProbeReport> {
  const actions = (options.actions ?? []) as ActionInput[];
  const runId = sha1(`${url}-${Date.now()}`).slice(0, 10);
  const screenshotPath = join(config.outputDir, `${runId}.png`);
  const reportPath = join(config.outputDir, `${runId}.json`);
  const robots = await assertRobotsAllowed(config, url);
  const opened = await selectEngineForConfig(config).open(config);
  const { context } = opened;
  try {
    const page = opened.page ?? (await context.newPage());
    const logs = attachListeners(page);
    const targetUrl = urlWithCurrency(url, config.currency);
    if (targetUrl.includes("booking.com") && config.currency) await prepareBookingCurrency(page, config.currency);
    await throttleHost(targetUrl, config.retry.throttleMs);
    await withBreaker(targetUrl, config.circuitBreaker, () => gotoWithRetry(page, targetUrl, DEFAULT_GOTO, config.retry));
    await settleLoad(page);
    const consent = options.autoConsent
      ? await handleCommonConsent(page, config.humanMode)
      : { handled: false };
    const currency = await applyCurrencyPreference(page, config.currency, config.identity.countryCode);
    if (options.waitMs) await page.waitForTimeout(options.waitMs);
    const before = await domSignature(page);
    const outcome = await runActions(page, config, actions, targetUrl, runId);
    if (options.waitMs) await page.waitForTimeout(options.waitMs);
    const after = await domSignature(page);
    const first = await mainText(page);
    const { text, title } = await reExtractIfEmpty(page, first, await page.title());
    const { challenges, captcha } = await detectAndSolve(page, text, options, config);
    reportBlockedProxy(config, challenges);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const visual = options.observeVisual ? await visualObservation(page, screenshotPath) : {};
    const serp = await extractSerpStep(page, options, config);
    await persistStorageState(context, config.storageStatePath);
    const report = buildReport({
      config,
      targetUrl,
      title,
      text,
      before,
      after,
      hasActions: actions.length > 0,
      consent,
      currency,
      challenges,
      visual,
      outcome,
      logs,
      screenshotPath,
      reportPath,
      extractPricesFlag: Boolean(options.extractPrices),
      captcha,
      serp,
      contacts: options.extractContacts ? await huntContacts(page, config, options.contactCrawl, robots ?? undefined, options.contactFilter) : undefined,
    });
    if (options.returnHtml) report.html = await page.content();
    return report;
  } finally {
    await teardownOpened(opened);
  }
}
