import { BaseScraper } from "@/lib/scrapers/base";
import pLimit from "p-limit";

export enum SourceStatus {
  HEALTHY = "healthy",
  CLOUDFLARE = "cloudflare",
  TIMEOUT = "timeout",
  ERROR = "error",
}

const CONCURRENT_HEALTH_CHECKS = 5;

export interface SourceHealthResult {
  status: SourceStatus;
  message: string;
  responseTime?: number;
  lastChecked: string;
}

/**
 * Detect Cloudflare protection pages
 */
export function detectCloudflare(
  html: string,
  headers?: Headers,
  status?: number,
): boolean {
  if (!html) return false;

  const lowerHtml = html.toLowerCase();

  const cloudflarePatterns = [
    "cloudflare",
    "cf-ray",
    "checking your browser",
    "enable javascript and cookies",
    "ddos protection by cloudflare",
    "attention required",
    "challenge-platform",
    "cf-chl",
    "/cdn-cgi/",
    "just a moment...",
    "verify you are human",
    "captcha",
  ];

  /**
   * Check HTML body
   */
  if (cloudflarePatterns.some((pattern) => lowerHtml.includes(pattern))) {
    return true;
  }

  /**
   * Check suspicious HTTP status
   */
  if (
    (status === 403 || status === 429 || status === 503) &&
    lowerHtml.includes("cloudflare")
  ) {
    return true;
  }

  /**
   * Check response headers
   */
  if (headers) {
    const server = headers.get("server")?.toLowerCase();
    const cfRay = headers.get("cf-ray");

    if (
      (server?.includes("cloudflare") || cfRay) &&
      lowerHtml.includes("challenge")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check individual source health
 */
export async function checkSourceHealth(
  scraper: BaseScraper,
  testQuery = "one piece",
): Promise<SourceHealthResult> {
  const startedAt = Date.now();
  const lastChecked = new Date().toISOString();

  try {
    /**
     * Execute scraper search
     */
    const results = await scraper.search(testQuery);

    const responseTime = Date.now() - startedAt;

    /**
     * Invalid result type
     */
    if (!Array.isArray(results)) {
      return {
        status: SourceStatus.ERROR,
        message: "Invalid scraper response",
        responseTime,
        lastChecked,
      };
    }

    /**
     * Empty arrays are suspicious
     */
    if (results.length === 0) {
      return {
        status: SourceStatus.CLOUDFLARE,
        message: "Possible Cloudflare block or empty result",
        responseTime,
        lastChecked,
      };
    }

    /**
     * Validate result structure
     */
    const first = results[0];

    if (
      !first ||
      typeof first !== "object" ||
      !("title" in first)
    ) {
      return {
        status: SourceStatus.ERROR,
        message: "Malformed search results",
        responseTime,
        lastChecked,
      };
    }

    return {
      status: SourceStatus.HEALTHY,
      message: `Operational (${results.length} results)`,
      responseTime,
      lastChecked,
    };
  } catch (error: unknown) {
    const responseTime = Date.now() - startedAt;

    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";

    /**
     * Cloudflare detection from message
     */
    if (
      message.toLowerCase().includes("cloudflare") ||
      message.toLowerCase().includes("cf-ray") ||
      message.toLowerCase().includes("challenge")
    ) {
      return {
        status: SourceStatus.CLOUDFLARE,
        message: "Cloudflare protection detected",
        responseTime,
        lastChecked,
      };
    }

    /**
     * Axios / Fetch response detection
     */
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error
    ) {
      try {
        const response = (
          error as {
            response: {
              status?: number;
              headers?: Headers;
              text?: () => Promise<string>;
              data?: unknown;
            };
          }
        ).response;

        const status = response.status;

        let html = "";

        /**
         * Fetch API style
         */
        if (typeof response.text === "function") {
          html = await response.text();
        }

        /**
         * Axios style
         */
        else if (typeof response.data === "string") {
          html = response.data;
        }

        if (
          detectCloudflare(
            html,
            response.headers,
            status,
          )
        ) {
          return {
            status: SourceStatus.CLOUDFLARE,
            message: "Cloudflare challenge page detected",
            responseTime,
            lastChecked,
          };
        }
      } catch {
        /**
         * Ignore parsing failures
         */
      }
    }

    return {
      status: SourceStatus.ERROR,
      message,
      responseTime,
      lastChecked,
    };
  }
}

/**
 * Check health of all scrapers
 */
export async function checkAllSourcesHealth(
  scrapers: BaseScraper[],
): Promise<Map<string, SourceHealthResult>> {
  const results = new Map<string, SourceHealthResult>();

  /**
   * Limit concurrency
   */
  const limit = pLimit(CONCURRENT_HEALTH_CHECKS);

  const checks = scrapers.map((scraper) =>
    limit(async () => {
      const sourceName = scraper
        .getName()
        .toLowerCase()
        .replace(/\s+/g, "-");

      try {
        const health = await checkSourceHealth(scraper);

        results.set(sourceName, health);
      } catch (error: unknown) {
        results.set(sourceName, {
          status: SourceStatus.ERROR,
          message:
            error instanceof Error
              ? error.message
              : "Unknown health check failure",
          lastChecked: new Date().toISOString(),
        });
      }
    }),
  );

  /**
   * Never fail entire batch
   */
  await Promise.allSettled(checks);

  return results;
}
