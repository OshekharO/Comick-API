/* eslint-disable @typescript-eslint/no-explicit-any */
import { FrontpageManga, FrontpageSection } from "@/types";
import {
  BaseFrontpage,
  FrontpageSectionConfig,
  FrontpageFetchOptions,
} from "./base";

export class ComixFrontpage extends BaseFrontpage {
  private readonly baseUrl = "https://comix.to";
  private readonly apiBase = "https://comix.to/api/v1";

  getSourceId(): string {
    return "comix";
  }

  getSourceName(): string {
    return "Comix";
  }

  getAvailableSections(): FrontpageSectionConfig[] {
    return [
      {
        id: "trending",
        title: "Trending",
        type: "trending",
        supportsPagination: true,
        supportsTimeFilter: true,
        availableTimeFilters: [1, 7, 30, 90, 180, 365],
      },
      {
        id: "latest",
        title: "Latest Updates",
        type: "latest_new",
        supportsPagination: true,
        supportsTimeFilter: false,
      },
      {
        id: "new",
        title: "New Comics",
        type: "recently_added",
        supportsPagination: true,
        supportsTimeFilter: false,
      },
    ];
  }

  async fetchSection(
    sectionId: string,
    options: FrontpageFetchOptions = {}
  ): Promise<FrontpageSection> {
    const sectionConfig = this.getAvailableSections().find(
      (s) => s.id === sectionId
    );

    if (!sectionConfig) {
      throw new Error(`Unknown section: ${sectionId}`);
    }

    const { page = 1, limit = 28, days = 7 } = options;

    let url = "";

    switch (sectionId) {
      case "trending":
        url = `${this.apiBase}/manga?type=trending&days=${days}&page=${page}&limit=${limit}`;
        break;

      case "latest":
        url = `${this.apiBase}/manga?type=latest&page=${page}&limit=${limit}`;
        break;

      case "new":
        url = `${this.apiBase}/manga?type=new&page=${page}&limit=${limit}`;
        break;

      default:
        throw new Error(`Unknown section: ${sectionId}`);
    }

    const items = await this.fetchMangaList(url);

    return {
      id: sectionConfig.id,
      title: sectionConfig.title,
      type: sectionConfig.type,
      items,
      supportsPagination: sectionConfig.supportsPagination,
      supportsTimeFilter: sectionConfig.supportsTimeFilter,
      availableTimeFilters: sectionConfig.availableTimeFilters,
    };
  }

  private async fetchMangaList(url: string): Promise<FrontpageManga[]> {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data?.result?.items || !Array.isArray(data.result.items)) {
        return [];
      }

      return data.result.items.map((item: any) =>
        this.mapComixManga(item)
      );
    } catch (error) {
      console.error("[ComixFrontpage] Error fetching manga list:", error);
      throw error;
    }
  }

  private mapComixManga(item: any): FrontpageManga {
    return {
      id: item.hid,
      title: item.title,
      url: `${this.baseUrl}${item.url}`,
      coverImage:
        item.poster?.large ||
        item.poster?.medium ||
        item.poster?.small ||
        undefined,
      latestChapter:
        item.latestChapter && item.latestChapter > 0
          ? item.latestChapter.toString()
          : undefined,
      lastUpdated: item.updatedAtFormatted,
      rating: item.ratedAvg || undefined,
      followers: item.followsTotal?.toString(),
      type: item.type,
      status: item.status,
      synopsis: item.synopsis,
    };
  }
}
