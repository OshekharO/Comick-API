/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import {
  ScrapedChapter,
  SearchResult,
  SourceType,
} from "@/types";

export class AsuraScanScraper extends BaseScraper {
  private readonly BASE_URL = "https://asurascans.com";

  /**
   * Safer fetch with timeout + browser headers
   */
  protected override async fetchWithRetry(
    url: string,
  ): Promise<string> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 10000);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,

        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",

          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",

          "Accept-Language":
            "en-US,en;q=0.5",

          Referer:
            "https://asurascans.com/",

          DNT: "1",

          "Upgrade-Insecure-Requests":
            "1",

          "Sec-Fetch-Dest": "document",

          "Sec-Fetch-Mode": "navigate",

          "Sec-Fetch-Site":
            "same-origin",

          "Cache-Control": "no-cache",

          Pragma: "no-cache",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const html = await response.text();

      /**
       * Basic Cloudflare detection
       */
      const lowerHtml = html.toLowerCase();

      if (
        lowerHtml.includes("cloudflare") ||
        lowerHtml.includes(
          "checking your browser",
        ) ||
        lowerHtml.includes(
          "attention required",
        ) ||
        lowerHtml.includes("/cdn-cgi/")
      ) {
        throw new Error(
          "Cloudflare protection detected",
        );
      }

      return html;
    } catch (error: unknown) {
      clearTimeout(timeout);

      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        throw new Error(
          "Request timeout",
        );
      }

      throw error;
    }
  }

  getName(): string {
    return "AsuraScan";
  }

  getBaseUrl(): string {
    return this.BASE_URL;
  }

  canHandle(url: string): boolean {
    return (
      url.includes("asurascans.com") ||
      url.includes("asuracomic.net")
    );
  }

  /**
   * Since we're using nodejs runtime now
   */
  isClientOnly(): boolean {
    return false;
  }

  getType(): SourceType {
    return "scanlator";
  }

  async search(
    query: string,
  ): Promise<SearchResult[]> {
    const searchUrl =
      `${this.BASE_URL}/browse?search=${encodeURIComponent(
        query,
      )}`;

    const html =
      await this.fetchWithRetry(searchUrl);

    const $ = cheerio.load(html);

    const results: SearchResult[] = [];

    $(".series-card").each(
      (_, element) => {
        const $card = $(element);

        const $link = $card
          .find('a[href^="/comics/"]')
          .first();

        const href = $link.attr("href");

        if (!href) return;

        const slugMatch = href.match(
          /\/comics\/([^/?]+)/,
        );

        const id = slugMatch
          ? slugMatch[1]
          : "";

        const title = $card
          .find("h3")
          .first()
          .text()
          .trim();

        if (!title) return;

        const coverImg = $card
          .find("img")
          .first();

        const coverImage =
          coverImg.attr("src") ||
          coverImg.attr("data-src");

        const chapterSpans = $card.find(
          "span.text-xs.font-medium",
        );

        let latestChapter = 0;

        chapterSpans.each((_, span) => {
          const text = $(span)
            .text()
            .trim();

          const chapterMatch =
            text.match(
              /^(\d+)\s+(Chs\.|Chapters?)$/i,
            );

          if (chapterMatch) {
            latestChapter = parseInt(
              chapterMatch[1],
              10,
            );
          }
        });

        const ratingSpan = $card
          .find("span.text-\\[10px\\]")
          .first();

        const rating =
          ratingSpan.length > 0
            ? parseFloat(
                ratingSpan.text().trim(),
              )
            : undefined;

        const fullUrl =
          `${this.BASE_URL}${href}`;

        results.push({
          id,
          title,
          url: fullUrl,

          coverImage:
            coverImage?.startsWith("http")
              ? coverImage
              : coverImage
                ? `${this.BASE_URL}${coverImage}`
                : undefined,

          latestChapter,

          lastUpdated: "",

          rating,
        });
      },
    );

    return results;
  }

  async extractMangaInfo(
    url: string,
  ): Promise<{
    title: string;
    id: string;
  }> {
    const html =
      await this.fetchWithRetry(url);

    const $ = cheerio.load(html);

    let title = $("h1")
      .first()
      .text()
      .trim();

    if (!title) {
      title = $("h2")
        .first()
        .text()
        .trim();
    }

    if (!title) {
      title = $("h3")
        .first()
        .text()
        .trim();
    }

    if (!title) {
      const pageTitle =
        $("title").text();

      title = pageTitle
        .split(" - ")[0]
        .split("|")[0]
        .trim();
    }

    const urlMatch = url.match(
      /\/(?:comics|series)\/([^/?]+)/,
    );

    const id = urlMatch
      ? urlMatch[1]
      : Date.now().toString();

    return {
      title,
      id,
    };
  }

  async getChapterList(
    mangaUrl: string,
  ): Promise<ScrapedChapter[]> {
    const html =
      await this.fetchWithRetry(mangaUrl);

    const $ = cheerio.load(html);

    const chapters: ScrapedChapter[] = [];

    const seenChapterNumbers =
      new Set<number>();

    const chapterLinks = $(
      'a[href*="/chapter/"]',
    );

    chapterLinks.each(
      (
        _: number,
        element: any,
      ) => {
        const $link = $(element);

        let href =
          $link.attr("href");

        if (!href) {
          return;
        }

        const chapterText =
          $link
            .find("span.font-medium")
            .first()
            .text()
            .trim() ||
          $link
            .find("h3")
            .first()
            .text()
            .trim();

        href = href.trim();

        let fullUrl: string;

        if (
          href.startsWith("http")
        ) {
          fullUrl = href;
        } else if (
          href.startsWith("/")
        ) {
          fullUrl =
            `${this.BASE_URL}${href}`;
        } else {
          fullUrl =
            `${this.BASE_URL}/comics/${href}`;
        }

        const chapterNumber =
          this.extractChapterNumber(
            fullUrl,
            chapterText,
          );

        if (
          chapterNumber >= 0 &&
          !seenChapterNumbers.has(
            chapterNumber,
          )
        ) {
          seenChapterNumbers.add(
            chapterNumber,
          );

          chapters.push({
            id: `${chapterNumber}`,

            number:
              chapterNumber,

            title:
              chapterText,

            url: fullUrl,
          });
        }
      },
    );

    return chapters.sort(
      (a, b) =>
        a.number - b.number,
    );
  }

  protected override extractChapterNumber(
    chapterUrl: string,
    chapterText?: string,
  ): number {
    if (chapterText) {
      /**
       * Ignore merged chapters
       */
      const concatenatedMatch =
        chapterText.match(
          /Chapter\s+(\d+)\s*[\+\-]\s*(\d+)(?!\.)(?:\s*$|\s+[^0-9])/i,
        );

      if (concatenatedMatch) {
        return -1;
      }

      const textMatch =
        chapterText.match(
          /Chapter\s+(\d+(?:\.\d+)?)/i,
        );

      if (textMatch) {
        return parseFloat(
          textMatch[1],
        );
      }
    }

    const patterns = [
      /\/chapter\/(\d+)(?:[.-](\d+))?/i,

      /chapter[/-](\d+)(?:[.-](\d+))?$/i,
    ];

    for (const pattern of patterns) {
      const match =
        chapterUrl.match(pattern);

      if (match) {
        const mainNumber =
          parseInt(match[1], 10);

        const decimalPart =
          match[2]
            ? match[2]
            : null;

        if (decimalPart) {
          const divisor =
            Math.pow(
              10,
              decimalPart.length,
            );

          return (
            mainNumber +
            parseInt(
              decimalPart,
              10,
            ) /
              divisor
          );
        }

        return mainNumber;
      }
    }

    return -1;
  }
}
