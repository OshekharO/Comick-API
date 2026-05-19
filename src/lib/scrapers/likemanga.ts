/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from "cheerio";
import { BaseScraper } from "./base";
import { ScrapedChapter, SearchResult } from "@/types";

export class LikeMangaScraper extends BaseScraper {
  getName(): string {
    return "LikeManga";
  }

  getBaseUrl(): string {
    return "https://mgread.io";
  }

  canHandle(url: string): boolean {
    return url.includes("mgread.io");
  }

  async extractMangaInfo(url: string): Promise<{ title: string; id: string }> {
    const html = await this.fetchWithRetry(url);
    const $ = cheerio.load(html);

    const title =
      $(".post-title h1").first().text().trim() ||
      $("h1").first().text().trim() ||
      $("title").text().split(" - ")[0].trim();

    const urlMatch = url.match(/\/manga\/([^/]+)/);
    const id = urlMatch ? urlMatch[1] : Date.now().toString();

    return { title, id };
  }

  async getChapterList(mangaUrl: string): Promise<ScrapedChapter[]> {
    const chapters: ScrapedChapter[] = [];
    const seenChapterNumbers = new Set<number>();

    const ajaxUrl = `${mangaUrl.replace(/\/$/, "")}/ajax/chapters/`;

    try {
      const response = await fetch(ajaxUrl, {
        method: "POST",
        headers: {
          "User-Agent": this.config.userAgent,
          "X-Requested-With": "XMLHttpRequest",
          Referer: mangaUrl,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const ajaxHtml = await response.text();
      const $ = cheerio.load(ajaxHtml);

      $(".wp-manga-chapter").each((_: number, element: any) => {
        const $chapter = $(element);
        const $link = $chapter.find("a").first();
        const href = $link.attr("href");
        const chapterText = $link.text().trim();

        if (href) {
          const fullUrl = href.startsWith("http")
            ? href
            : `https://mgread.io${href}`;

          const chapterNumber = this.extractChapterNumber(fullUrl, chapterText);

          if (chapterNumber >= 0 && !seenChapterNumbers.has(chapterNumber)) {
            seenChapterNumbers.add(chapterNumber);

            chapters.push({
              id: `${chapterNumber}`,
              number: chapterNumber,
              title: chapterText,
              url: fullUrl,
            });
          }
        }
      });
    } catch (error) {
      console.error("[LikeManga] AJAX chapter fetch error:", error);
    }

    return chapters.sort((a, b) => a.number - b.number);
  }

  protected extractChapterNumber(chapterUrl: string, chapterText?: string): number {
    if (chapterText) {
      const concatenatedMatch = chapterText.match(/Chapter\s+(\d+)\s*[\+\-]\s*(\d+)/i);

      if (concatenatedMatch) {
        return -1;
      }

      const textMatch = chapterText.match(/Chapter\s+(\d+(?:\.\d+)?)/i);

      if (textMatch) {
        return parseFloat(textMatch[1]);
      }
    }

    const patterns = [
      /\/chapter[/-](\d+)(?:[.-](\d+))?/i,
      /chapter[/-](\d+)(?:[.-](\d+))?$/i,
    ];

    for (const pattern of patterns) {
      const match = chapterUrl.match(pattern);

      if (match) {
        const mainNumber = parseInt(match[1], 10);
        const decimalPart = match[2] ? match[2] : null;

        if (decimalPart) {
          const divisor = Math.pow(10, decimalPart.length);

          return mainNumber + parseInt(decimalPart, 10) / divisor;
        }

        return mainNumber;
      }
    }

    return -1;
  }

  async search(query: string): Promise<SearchResult[]> {
    const searchUrl = `https://mgread.io/wp-json/initlise/v1/search?term=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        "User-Agent": this.config.userAgent,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://mgread.io/",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const item of data) {
      const url =
        typeof item.url === "string"
          ? item.url
          : "";

      if (!url) continue;

      const idMatch = url.match(/\/manga\/([^/]+)/);

      const id = idMatch ? idMatch[1] : "";

      const title =
         typeof item.title === "string"
          ? item.title
            .replace(/<[^>]+>/g, "")
            .replace(/&#8217;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .trim(): "";

      results.push({
        id,
        title,
        url,
        coverImage:
          typeof item.thumb === "string"
            ? item.thumb
            : undefined,
        latestChapter: 0,
        lastUpdated:
          typeof item.date === "string"
            ? item.date
            : "",
      });
    }

    return results;
  }
}
