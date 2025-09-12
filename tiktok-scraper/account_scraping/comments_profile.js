// account_scraping/comments_profile.js
// Usage:
//   node account_scraping/comments_profile.js @handle [--max 10] [--dir <folderName>]
//
// Reads:  account_scraping/data/<handle>/<handle>_video_ids_with_urls.csv
// Writes: account_scraping/comments/<dir or handle>/comments_<VIDEOID>.json

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const COOKIES_PATH   = path.resolve(__dirname, "..", "cookies.json");
const DATA_ROOT      = path.resolve(__dirname, "data");
const COMMENTS_ROOT  = path.resolve(__dirname, "comments");

const ensureDir = (p) => fs.existsSync(p) || fs.mkdirSync(p, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------- Page helpers ----------
async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_PATH)) return;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
    await page.setCookie(...cookies);
    console.log("✅ Cookies loaded");
  } catch {}
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
    if (el) { await el.click({ delay: 80 }).catch(() => {}); break; }
  }
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

// ---------- Network harvester ----------
function makeCommentHarvester() {
  const bag = new Map();
  const norm = (c) => {
    const id = c?.cid || c?.comment_id || c?.id || null;
    const author =
      c?.user?.nickname || c?.user?.unique_id || c?.user?.name || null;
    const handle = c?.user?.unique_id || c?.user?.sec_uid || null;
    const text = c?.text ?? c?.content ?? c?.desc ?? "";
    const likes =
      c?.digg_count?.toString?.() ||
      c?.like_count?.toString?.() ||
      c?.likes?.toString?.() ||
      "0";
    const time =
      c?.create_time || c?.createTime || c?.comment_time || c?.timestamp || null;
    return { id: id || `${handle || ""}_${(text || "").slice(0, 40)}`, author, handle, text, likes, time };
  };
  const isComment = (o) =>
    o && typeof o === "object" &&
    (typeof o.text === "string" || typeof o.content === "string" ||
      "cid" in o || "comment_id" in o);

  const traverse = (node) => {
    if (Array.isArray(node)) return node.forEach(traverse);
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.comments)) node.comments.forEach((c) => traverse(c));
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(traverse);
      else if (v && typeof v === "object") traverse(v);
      else if (isComment(node)) bag.set(norm(node).id, norm(node));
    }
  };

  const handler = async (res) => {
    try {
      if (!/\/api\/comment\/list/i.test(res.url())) return;
      const ct = res.headers()["content-type"] || "";
      if (!/json/i.test(ct)) return;
      const data = await res.json();
      traverse(data);
    } catch {}
  };

  return { handler, dump: () => Array.from(bag.values()) };
}

// ---------- DOM fallback ----------
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
          node.querySelector('a[href^="/@"]')?.getAttribute("href")?.replace(/^\/@/, "") ||
          null;
        const textEl =
          node.querySelector('[data-e2e="comment-text"]') ||
          node.querySelector('[data-e2e="comment-level-1"]') ||
          node.querySelector('[data-e2e="comment-content"]') ||
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

// ---------- Per-video ----------
async function scrapeOne(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await closeOverlays(page);
  await openCommentsPanelIfCollapsed(page);

  const harvest = makeCommentHarvester();
  const listener = harvest.handler.bind(null);
  page.on("response", listener);

  let last = 0, idle = 0;
  for (let i = 0; i < 30; i++) {
    await scrollOneRound(page);
    await delay(1200);
    const cnt = await page
      .evaluate(
        () =>
          document.querySelectorAll(
            '[data-e2e="comment-item"], li[data-e2e*="comment"], div[data-e2e*="comment-item"]'
          ).length
      )
      .catch(() => 0);
    if (cnt <= last) idle++; else idle = 0;
    last = cnt;
    if (idle >= 3) break;
  }

  page.off("response", listener);
  let comments = harvest.dump();
  if (!comments.length) comments = await domExtract(page);
  return comments;
}

// ---------- Run ----------
(async () => {
  const handleArg = process.argv[2];
  if (!handleArg || !handleArg.startsWith("@")) {
    console.error('Usage: node account_scraping/comments_profile.js @handle [--max 10] [--dir <folder>]');
    process.exit(1);
  }
  const handle = handleArg.replace(/^@/, "").toLowerCase();

  const maxIdx = process.argv.indexOf("--max");
  const max = maxIdx !== -1 ? parseInt(process.argv[maxIdx + 1], 10) || Infinity : Infinity;

  const dirIdx = process.argv.indexOf("--dir");
  const outDirName = (dirIdx !== -1 && process.argv[dirIdx + 1]) || handle; // default: comments/<handle>
  const OUT_DIR = path.resolve(COMMENTS_ROOT, outDirName);
  ensureDir(OUT_DIR);

  const CSV_DIR = path.resolve(DATA_ROOT, handle);
  const csvPath = path.resolve(CSV_DIR, `${handle}_video_ids_with_urls.csv`);
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing CSV: ${path.relative(process.cwd(), csvPath)}. Run profile.js first.`);
    process.exit(1);
  }

  const rows = readCsvPairs(csvPath).slice(0, isFinite(max) ? max : undefined);
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
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
    );
    await loadCookies(page);

    for (const { id, url } of rows) {
      try {
        console.log(`➡️  ${id} — scraping comments`);
        const comments = await scrapeOne(page, url);
        const dest = path.resolve(OUT_DIR, `comments_${id}.json`);
        fs.writeFileSync(dest, JSON.stringify(comments, null, 2));
        console.log(`✅ Saved ${comments.length} comments -> ${path.relative(process.cwd(), dest)}`);
      } catch (e) {
        console.error(`❌ ${id} failed: ${e.message}`);
      }
    }
  } finally {
    await browser.close();
  }
})();
