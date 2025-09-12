// websearch_scraping/index.js
// Usage: node websearch_scraping/index.js "your keyword here"
// Writes:
//   websearch_scraping/data/<slug>/video_ids.csv
//   websearch_scraping/data/<slug>/video_ids_with_urls.csv

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const COOKIES_PATH = path.resolve(ROOT, "cookies.json");

const ensureDir = (p) => fs.existsSync(p) || fs.mkdirSync(p, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");

async function scrapeTikTok(keyword, scrolls = 8) {
  const slug = slugify(keyword || "search");
  const DATA_DIR = path.resolve(__dirname, "data", slug);

  const url = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
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

  // Scroll
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await delay(1500);
  }

  // Collect links
  const videoLinks = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
    return anchors.map((a) => a.href).filter((h) => h.includes("/video/"));
  });

  const uniqueLinks = [...new Set(videoLinks)];
  const videoData = uniqueLinks
    .map((link) => {
      const match = link.match(/\/video\/(\d+)/);
      return { video_id: match ? match[1] : null, url: link };
    })
    .filter((v) => v.video_id && v.url);

  // Save under data/<slug>/
  ensureDir(DATA_DIR);
  const idsPath = path.resolve(DATA_DIR, "video_ids.csv");
  const urlsPath = path.resolve(DATA_DIR, "video_ids_with_urls.csv");

  fs.writeFileSync(idsPath, "video_id\n" + videoData.map((v) => v.video_id).join("\n"));
  fs.writeFileSync(
    urlsPath,
    "video_id,url\n" + videoData.map((v) => `${v.video_id},${v.url}`).join("\n")
  );

  console.log(`\n🎉 Saved ${videoData.length} IDs -> ${path.relative(process.cwd(), idsPath)}`);
  console.log(`🎉 Saved ${videoData.length} IDs+URLs -> ${path.relative(process.cwd(), urlsPath)}`);

  await browser.close();
  return { slug, videoData };
}

// CLI
const keyword = process.argv.slice(2).join(" ") || "nyc mayoral election";
scrapeTikTok(keyword, 8).catch((err) => {
  console.error(err);
  process.exit(1);
});
