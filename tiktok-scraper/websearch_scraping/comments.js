// websearch_scraping/comments.js
// Usage (recommended):
//   node websearch_scraping/comments.js "nyc mayoral election"
//   -> reads:   websearch_scraping/data/<slug>/video_ids_with_urls.csv
//   -> writes:  websearch_scraping/websearch_comments/<slug>/comments_<VIDEOID>.json
//
// Or pass a CSV path explicitly (kept for flexibility):
//   node websearch_scraping/comments.js websearch_scraping/data/<slug>/video_ids_with_urls.csv

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const COOKIES_PATH = path.resolve(ROOT, "cookies.json");
const BASE_DATA_DIR = path.resolve(__dirname, "data");
const BASE_OUT_DIR = path.resolve(__dirname, "websearch_comments");

const ensureDir = (p) => fs.existsSync(p) || fs.mkdirSync(p, { recursive: true });
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

// ---------- CSV ----------
function readCsvPairs(csvPath) {
  const rows = fs.readFileSync(csvPath, "utf-8").trim().split(/\r?\n/);
  if (!rows.length) return [];
  const hasHeader = rows[0].toLowerCase().includes("video_id");
  const lines = hasHeader ? rows.slice(1) : rows;
  return lines
    .map((l) => {
      const idx = l.indexOf(",");
      if (idx < 0) return null;
      const id = l.slice(0, idx).trim();
      const url = l.slice(idx + 1).trim();
      return id && url ? { id, url } : null;
    })
    .filter(Boolean);
}

// ---------- COOKIES / PAGE UTIL ----------
async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_PATH)) return;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
    await page.setCookie(...cookies);
    console.log("✅ Cookies loaded");
  } catch (e) {
    console.warn("⚠️ Failed to load cookies:", e.message);
  }
}
async function closeOverlays(page) {
  try {
    await page.keyboard.press("Escape").catch(() => {});
    await page.$$eval("button", (btns) => {
      btns.forEach((b) => {
        const t = (b.textContent || "").toLowerCase();
        if (/(accept|agree|got it|close|ok)/i.test(t)) b.click();
      });
    });
  } catch {}
}
async function openCommentsPanelIfCollapsed(page) {
  if (await page.$('[data-e2e="comment-list"]')) return;
  const sels = [
    '[data-e2e="browse-comment-icon"]',
    '[data-e2e="comment-icon"]',
    'button[aria-label*="comment" i]',
    'svg[aria-label*="comment" i]',
  ];
  for (const sel of sels) {
    const el = await page.$(sel);
    if (el) { try { await el.click({ delay: 80 }); break; } catch {} }
  }
  await page
    .waitForSelector('[data-e2e="comment-list"], [data-e2e*="comment"]', { timeout: 8000 })
    .catch(() => {});
}
async function scrollOneRound(page) {
  await page
    .$eval("body", () => {
      const btns = Array.from(document.querySelectorAll("button"));
      btns.forEach((b) => {
        const t = (b.textContent || "").toLowerCase();
        if (/view more replies|more replies|show more/i.test(t)) b.click();
      });
    })
    .catch(() => {});
  await page
    .evaluate(() => {
      const list =
        document.querySelector('[data-e2e="comment-list"]') ||
        document.querySelector('div[data-e2e*="comment-list"]');
      if (list) list.scrollTop = list.scrollHeight;
      else window.scrollBy(0, window.innerHeight * 2);
    })
    .catch(() => {});
}

// ---------- NETWORK CAPTURE ----------
function makeCommentHarvester() {
  const bag = new Map();
  const normalize = (c) => {
    const id = c?.cid || c?.comment_id || c?.id || c?.aweme_id || c?.uid || null;
    const user =
      c?.user?.nickname || c?.user?.unique_id || c?.user?.name || c?.user_name || null;
    const handle = c?.user?.unique_id || c?.user?.sec_uid || c?.user_id || null;
    const text = c?.text ?? c?.content ?? c?.desc ?? "";
    const likes =
      c?.digg_count?.toString?.() || c?.like_count?.toString?.() || c?.likes?.toString?.() || "0";
    const time = c?.create_time || c?.createTime || c?.comment_time || c?.timestamp || null;
    return {
      id: id || `${handle || ""}_${(text || "").slice(0, 40)}`,
      author: user || null,
      handle: handle || null,
      text: (text || "").toString(),
      likes,
      time,
    };
  };
  const isCommentish = (o) =>
    o && typeof o === "object" &&
    (typeof o.text === "string" || typeof o.content === "string" || "cid" in o || "comment_id" in o);

  const traverse = (node) => {
    if (Array.isArray(node)) return node.forEach(traverse);
    if (node && typeof node === "object") {
      if (Array.isArray(node.comments)) {
        node.comments.forEach((c) => {
          if (isCommentish(c)) {
            const n = normalize(c);
            if (n.text) bag.set(n.id, n);
          }
          traverse(c);
        });
      }
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (Array.isArray(v)) {
          v.forEach((x) => {
            if (isCommentish(x)) {
              const n = normalize(x);
              if (n.text) bag.set(n.id, n);
            }
            traverse(x);
          });
        } else if (v && typeof v === "object") {
          traverse(v);
        }
      }
    }
  };

  const handler = async (res) => {
    try {
      const url = res.url();
      if (!/\/api\/comment\/list/i.test(url)) return;
      const ct = res.headers()["content-type"] || "";
      if (!/json/i.test(ct)) return;
      const data = await res.json();
      traverse(data);
    } catch {}
  };

  return { handler, dump: () => Array.from(bag.values()) };
}

// ---------- DOM FALLBACK ----------
async function domExtract(page) {
  return await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const deepText = (el) => {
      if (!el) return "";
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const parts = [];
      while (w.nextNode()) parts.push(w.currentNode.nodeValue);
      return parts.join(" ").replace(/\s+/g, " ").trim();
    };

    const items = Array.from(
      document.querySelectorAll(
        '[data-e2e="comment-item"], li[data-e2e*="comment"], div[data-e2e*="comment-item"], div[data-e2e^="comment-"][data-e2e$="-item"]'
      )
    );

    return items
      .map((node) => {
        const handle =
          node.querySelector('a[href^="/@"]')?.getAttribute("href")?.replace(/^\/@/, "") || null;

        const textEl =
          node.querySelector('[data-e2e="comment-text"]') ||
          node.querySelector('[data-e2e="comment-level-1"]') ||
          node.querySelector('[data-e2e="comment-content"]') ||
          node.querySelector('div[class*="Comment"] p') ||
          node.querySelector("p");

        let text = deepText(textEl);
        if (text && handle) {
          const naked = text.replace(/^@/, "").trim().toLowerCase();
          if (naked === handle.toLowerCase()) text = "";
        }
        if (text === "@") text = "";

        const author =
          clean(node.querySelector('[data-e2e="comment-username"]')?.textContent) || null;
        const likes = clean(node.querySelector('[data-e2e="comment-like-count"]')?.textContent) || "0";
        const time  = clean(node.querySelector("time")?.textContent) || null;

        return text ? { author, handle, text, likes, time } : null;
      })
      .filter(Boolean);
  });
}

// ---------- PER-VIDEO ----------
async function scrapeOneVideo(page, url, id) {
  console.log(`\n➡️  ${id} — opening`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await closeOverlays(page);
  await openCommentsPanelIfCollapsed(page);

  const harvest = makeCommentHarvester();
  const listener = harvest.handler.bind(null);
  page.on("response", listener);

  let lastSeen = 0, idle = 0;
  for (let i = 0; i < 30; i++) {
    await scrollOneRound(page);
    await delay(1200);
    const domCount = await page
      .evaluate(
        () =>
          document.querySelectorAll(
            '[data-e2e="comment-item"], li[data-e2e*="comment"], div[data-e2e*="comment-item"]'
          ).length
      )
      .catch(() => 0);
    if (domCount <= lastSeen) idle += 1; else idle = 0;
    lastSeen = domCount;
    if (idle >= 3) break;
  }

  page.off("response", listener);
  let comments = harvest.dump();
  if (!comments.length) comments = await domExtract(page);
  return comments;
}

// ---------- RUN ----------
(async () => {
  const arg = process.argv.slice(2).join(" ").trim();

  // If an explicit CSV path is provided, use it; otherwise treat arg as the query
  let csvPath, slug;
  if (!arg) {
    console.error('Provide a search phrase or a CSV path.\nExample: node websearch_scraping/comments.js "nyc mayoral election"');
    process.exit(1);
  }
  if (arg.toLowerCase().endsWith(".csv")) {
    csvPath = path.resolve(arg);
    // try to infer slug from parent folder name
    slug = path.basename(path.dirname(csvPath));
  } else {
    slug = slugify(arg);
    csvPath = path.resolve(BASE_DATA_DIR, slug, "video_ids_with_urls.csv");
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`Missing CSV: ${path.relative(process.cwd(), csvPath)}`);
    process.exit(1);
  }
  const outDir = path.resolve(BASE_OUT_DIR, slug);
  ensureDir(outDir);

  const rows = readCsvPairs(csvPath);
  if (!rows.length) {
    console.error("CSV empty or malformed. Expect: video_id,url");
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
    defaultViewport: { width: 1366, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await loadCookies(page);

    for (const { id, url } of rows) {
      try {
        const comments = await scrapeOneVideo(page, url, id);
        const dest = path.resolve(outDir, `comments_${id}.json`);
        fs.writeFileSync(dest, JSON.stringify(comments, null, 2));
        console.log(`✅ ${id} — saved ${comments.length} comments -> ${path.relative(process.cwd(), dest)}`);
      } catch (e) {
        console.error(`❌ ${id} — failed: ${e.message}`);
      }
    }
  } finally {
    await browser.close();
  }
})();
