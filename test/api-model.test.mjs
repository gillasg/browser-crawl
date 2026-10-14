import assert from "node:assert/strict";
import test from "node:test";
import { saveFlow, rebuild, siteName } from "site-to-api";
import {
  crawl,
  scrape,
  extractJson,
  summarize,
  optionsFromPrompt,
  generateCssSchema,
  extractCss,
} from "../dist/index.js";
import { startCrawlSite } from "./fixture-site.mjs";
import { fakeAuto, tempHome } from "./helpers.mjs";

/** Records the fixture's catalog API and product pages as HAR, the way a browser would. */
async function recordShop(origin) {
  const entries = [];
  let clock = Date.parse("2026-10-01T10:00:00Z");
  const get = async (path, type) => {
    const response = await fetch(origin + path);
    const text = await response.text();
    entries.push({
      startedDateTime: new Date((clock += 1000)).toISOString(),
      _resourceType: type,
      request: {
        method: "GET",
        url: origin + path,
        headers: [{ name: "referer", value: origin + "/" }],
      },
      response: {
        status: response.status,
        headers: [...response.headers].map(([name, value]) => ({ name, value })),
        content: { mimeType: response.headers.get("content-type"), text },
      },
    });
    return text;
  };
  const first = JSON.parse(await get("/api/catalog?limit=5", "fetch"));
  await get(`/api/catalog?limit=5&cursor=${first.nextCursor}`, "fetch");
  for (const slug of ["oak-desk", "office-chair", "green-sofa"])
    await get(`/product/${slug}`, "document");
  return { log: { entries } };
}

test("crawling through a mapped API: every item of a paginated operation, and pages as data", async (t) => {
  await tempHome(t);
  const site = await startCrawlSite();
  t.after(() => site.close());
  const name = siteName(site.origin);
  await saveFlow(
    name,
    { name: "shop", recordedAt: new Date().toISOString() },
    await recordShop(site.origin),
  );
  const { model } = await rebuild(name);
  const operation = model.operations.find((op) => op.path === "/api/catalog");
  assert.equal(operation.pagination.style, "cursor");
  const { fetcher } = fakeAuto();
  const items = await crawl(
    { api: { site: name, operation: operation.id }, limit: 100 },
    { fetcher },
  );
  assert.equal(items.length, 17);
  assert.equal(items[16].json.name, "Item 16");
  assert.ok(items.every((item) => item.fetchedBy === "api"));
  const page = await scrape(
    `${site.origin}/product/blue-lamp`,
    { formats: ["markdown", "pageData"] },
    { fetcher },
  );
  assert.equal(page.fetchedBy, "api", "a mapped page endpoint answers with the page's data");
  assert.equal(page.json.jsonLd[0].name, "blue-lamp");
});

function scripted(answers) {
  const seen = [];
  return {
    seen,
    complete: async (context) => {
      seen.push(context);
      const [name, args] = answers.shift();
      return { content: [{ type: "toolCall", id: "1", name, arguments: args }] };
    },
  };
}

test("model features: JSON extraction, summaries, CSS schemas and crawl options from plain English", async (t) => {
  await tempHome(t);
  const site = await startCrawlSite();
  t.after(() => site.close());
  const model = scripted([
    ["result", { data: { name: "Desk lamp", price: 25 } }],
    ["summary", { summary: "A desk lamp for $25." }],
    [
      "schema",
      {
        baseSelector: ".product",
        fields: [
          { name: "name", selector: ".name" },
          { name: "price", selector: ".price", type: "number" },
        ],
      },
    ],
    [
      "options",
      {
        url: "https://docs.example.com",
        include: ["/api/**"],
        limit: 40,
        strategy: "best",
        query: "rate limits",
        bogus: true,
      },
    ],
  ]);
  const page = await scrape(
    `${site.origin}/product/lamp`,
    {
      formats: ["markdown", "summary"],
      extract: {
        schema: {
          type: "object",
          properties: { name: { type: "string" }, price: { type: "number" } },
        },
      },
    },
    { fetcher: fakeAuto().fetcher, model },
  );
  assert.deepEqual(page.json, { name: "Desk lamp", price: 25 });
  assert.equal(page.summary, "A desk lamp for $25.");
  assert.match(model.seen[0].messages[0].content, /Desk lamp/, "the model sees the page");
  const schema = await generateCssSchema(page.markdown, "product name and price", model);
  assert.deepEqual(
    extractCss(
      '<div class="product"><b class="name">Lamp</b><i class="price">$9</i></div>',
      schema,
      "https://x.test/",
    ),
    [{ name: "Lamp", price: 9 }],
  );
  const options = await optionsFromPrompt(
    "the API docs about rate limits on docs.example.com",
    model,
  );
  assert.deepEqual(options, {
    url: "https://docs.example.com",
    include: ["/api/**"],
    limit: 40,
    strategy: "best",
    query: "rate limits",
  });
  assert.equal(typeof extractJson, "function");
  assert.equal(typeof summarize, "function");
});
