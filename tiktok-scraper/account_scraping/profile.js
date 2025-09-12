// account_scraping/profile.js
// Usage: node account_scraping/profile.js @lululemon --limit 10
//
// Outputs:
//   account_scraping/data/<handle>/<handle>_video_ids.csv
//   account_scraping/data/<handle>/<handle>_video_ids_with_urls.csv

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const COOKIES_PATH = path.resolve(__dirname, "..", "cookies.json");
const DATA_ROOT   = path.resolve(__dirname, "data");

const ensureDir = (p) => fs.existsSync(p) || fs.mkdirSync(p, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeProfileTopPopular(handleRaw, limit = 10) {
  const handle = handleRaw.replace(/^@?/, "").toLowerCase();
  const url = `https://www.tiktok.com/@${handle}`;

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
  );

  // Cookies
  if (fs.existsSync(COOKIES_PATH)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
    await page.setCookie(...cookies);
    console.log("Loaded saved cookies ✅");
  }

  await page.goto(url, { waitUntil: "domcontentloaded" });

  if (!fs.existsSync(COOKIES_PATH)) {
    console.log("\n👉 Please log in to TikTok in the browser window.");
    console.log("When finished, press Enter here in the terminal to continue...");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log("✅ Cookies saved to cookies.json — next time it will auto-login.");
  }

  // Click "Popular" tab (robust selectors)
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("a,button,div[role='tab'],span"));
    const popular = nodes.find((el) => (el.textContent || "").trim().toLowerCase() === "popular");
    if (popular) popular.click();
  });
  await delay(1200);

  // Collect top-N links (scroll if needed)
  const seen = new Set();
  for (let i = 0; i < 16 && seen.size < limit; i++) {
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/video/"]')).map((a) => a.href)
    );
    links.forEach((l) => l.includes("/video/") && seen.add(l));
    if (seen.size >= limit) break;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await delay(1200);
  }
  const topLinks = Array.from(seen).slice(0, limit);

  // Save under data/<handle>/
  const DATA_DIR = path.resolve(DATA_ROOT, handle);
  ensureDir(DATA_DIR);

  const rows = topLinks
    .map((link) => {
      const m = link.match(/\/video\/(\d+)/);
      return { video_id: m ? m[1] : null, url: link };
    })
    .filter((r) => r.video_id && r.url);

  const idsPath  = path.resolve(DATA_DIR, `${handle}_video_ids.csv`);
  const urlsPath = path.resolve(DATA_DIR, `${handle}_video_ids_with_urls.csv`);

  fs.writeFileSync(idsPath,  "video_id\n" + rows.map((r) => r.video_id).join("\n"));
  fs.writeFileSync(urlsPath, "video_id,url\n" + rows.map((r) => `${r.video_id},${r.url}`).join("\n"));

  console.log(`\n🎉 Saved ${rows.length} IDs -> ${path.relative(process.cwd(), idsPath)}`);
  console.log(`🎉 Saved ${rows.length} IDs+URLs -> ${path.relative(process.cwd(), urlsPath)}`);

  await browser.close();
  return rows;
}

// CLI
(async () => {
  const handle = process.argv[2];
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) || 10 : 10;

  if (!handle || !handle.startsWith("@")) {
    console.error('Usage: node account_scraping/profile.js @handle [--limit 10]');
    process.exit(1);
  }

  try {
    await scrapeProfileTopPopular(handle, limit);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
