import {
  BrowserNotConnected,
  loadModel,
  siteApi,
  siteName,
  type PageEndpoint,
  type SiteApi,
  type SiteModel,
} from "site-to-api";
import type { ScrapeOptions } from "../types.js";
import type { Fetched, Fetcher } from "./types.js";

// Sites mapped with site-to-api: their pages come back as the structured data the page is built
// from, and whole collections are walked through the API's own pagination. No HTML parsing.

function matchTemplate(template: string, path: string): Record<string, string> | undefined {
  const pattern = template.split("/");
  const parts = path.split("/");
  if (pattern.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const name = /^\{(.+)\}$/.exec(pattern[i] ?? "")?.[1];
    if (name) params[name] = decodeURIComponent(parts[i] ?? "");
    else if (pattern[i] !== parts[i]) return undefined;
  }
  return params;
}

export class ApiFetcher implements Fetcher {
  readonly name = "api" as const;
  private readonly models = new Map<string, Promise<SiteModel | undefined>>();
  private readonly apis = new Map<string, Promise<SiteApi>>();
  private readonly direct = new Map<string, Promise<SiteApi>>();

  private model(url: URL): Promise<SiteModel | undefined> {
    const site = siteName(url.href);
    if (!this.models.has(site))
      this.models.set(
        site,
        loadModel(site).catch(() => undefined),
      );
    return this.models.get(site) as Promise<SiteModel | undefined>;
  }

  api(site: string): Promise<SiteApi> {
    if (!this.apis.has(site)) this.apis.set(site, siteApi(site));
    return this.apis.get(site) as Promise<SiteApi>;
  }

  /** The page endpoint that serves this URL, if the site is mapped. */
  async endpoint(
    input: string,
  ): Promise<{ page: PageEndpoint; params: Record<string, string> } | undefined> {
    const url = new URL(input);
    const model = await this.model(url);
    for (const page of model?.pages ?? []) {
      if (page.origin !== url.origin) continue;
      const params = matchTemplate(page.path, url.pathname);
      if (params) return { page, params };
    }
    return undefined;
  }

  async fetch(url: string, options: ScrapeOptions): Promise<Fetched> {
    void options;
    const match = await this.endpoint(url);
    if (!match) throw new Error(`No mapped API serves ${url}`);
    const site = siteName(url);
    let json: unknown;
    try {
      json = await (await this.api(site)).fetchPage(match.page.id, match.params);
    } catch (error) {
      // No browser: pages read from embedded data still work over plain HTTP.
      if (!(error instanceof BrowserNotConnected) || match.page.extractor) throw error;
      if (!this.direct.has(site)) this.direct.set(site, siteApi(site, { transport: "direct" }));
      json = await (
        await (this.direct.get(site) as Promise<SiteApi>)
      ).fetchPage(match.page.id, match.params);
    }
    const body = Buffer.from(JSON.stringify(json));
    return {
      url,
      finalUrl: url,
      status: 200,
      headers: {},
      contentType: "application/json",
      body,
      fetchedBy: "api",
      json,
    };
  }

  /** Every item of a mapped, paginated operation. */
  async *items(
    site: string,
    operation: string,
    params: Record<string, unknown> = {},
    maxItems?: number,
  ): AsyncGenerator<unknown> {
    const api = await this.api(site);
    yield* api.paginate(operation, params, maxItems ? { maxItems } : {});
  }
}
