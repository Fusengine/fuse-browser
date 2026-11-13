/**
 * Compute where a domain ranks within a parsed SERP. Pure helper.
 * @module extraction/serp-rank
 */
import type { DomainRank, Serp, SerpResult } from "../interfaces/extraction.js";

/** Normalize a hostname/URL/domain input to a bare lowercase host. */
function normalizeHost(value: string): string {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

/** Result host: for a Google redirect wrapper the host of the display breadcrumb (`https://host › a › b`). */
function resultHost(r: SerpResult): string {
  if (!r.redirect) return normalizeHost(r.url);
  return normalizeHost((r.displayUrl ?? "").split(/\s/)[0] ?? "");
}

function positionsFor(results: SerpResult[], target: string): number[] {
  return results
    .filter((r) => {
      const host = resultHost(r);
      return host === target || host.endsWith(`.${target}`);
    })
    .map((r) => r.position);
}

/** Find the organic/ads positions of `domain` (host or full URL) in a SERP. */
export function findDomainRanks(serp: Serp, domain: string): DomainRank {
  const target = normalizeHost(domain);
  const organic = positionsFor(serp.organic, target);
  const ads = positionsFor(serp.ads, target);
  return {
    domain: target,
    organic,
    ads,
    best: organic.length ? Math.min(...organic) : null,
    found: organic.length > 0 || ads.length > 0,
  };
}
