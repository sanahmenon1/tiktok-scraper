# TikTok Scraper Toolkit

This repo contains several Puppeteer- and Python-based scrapers for collecting TikTok video metadata and comments.  
You can scrape by **account handle**, **video ID list**, or **keyword search**, and then analyze engagement/comment sentiment.

---

## 📦 Requirements

- **Node.js** (v18+ recommended)
- **npm** (comes with Node)
- **Python 3.9+** (for the `TT_Scraper` Python module)
- **Pandas** (`pip install pandas`)
- **Puppeteer** (`npm install puppeteer`)
- A valid **cookies.json** (auto-generated on first login)

---

## 🔑 Login / Cookies

On the first run of any script, a browser window will open and ask you to log into TikTok.  
Once logged in, press **Enter** in your terminal — your session cookies will be saved to `cookies.json`.  
Future runs will auto-login with this file.

---

## 📂 Repo Structure

```

account\_scraping/
profile.js               # scrape profile top popular videos → CSV
comments\_profile.js      # scrape comments for those profile videos
data/                    # per-handle CSVs
comments/                # per-handle comment JSONs

websearch\_scraping/
index.js                 # scrape search results → CSV
comments.js              # scrape comments for search-result videos
data/                    # per-query CSVs
websearch\_comments/      # per-query comment JSONs

python/
many\_scraper\_example.py  # demo of TT\_Scraper with ID lists

processing/
metrics\_processor.py     # engagement + averages
velocity\_summary.py      # posting frequency
content\_distribution.py  # content mix breakdown

````

---

## 🚀 Usage

### 1. Scrape a TikTok Profile (videos only)

```bash
node account_scraping/profile.js @lululemon --limit 10
````

**Outputs:**

* `account_scraping/data/lululemon/lululemon_video_ids.csv`
* `account_scraping/data/lululemon/lululemon_video_ids_with_urls.csv`

---

### 2. Scrape Comments from Profile Videos

```bash
node account_scraping/comments_profile.js @lululemon --max 5 --dir lululemon_run1
```

**Reads:**

* `account_scraping/data/lululemon/lululemon_video_ids_with_urls.csv`

**Writes:**

* `account_scraping/comments/lululemon_run1/comments_<VIDEOID>.json`

---

### 3. Scrape by Video ID List (Python TT\_Scraper)

First, prepare a CSV:

```csv
video_id
7114393903368785194
7191768531430624558
6672674748264090886
6748121078884732165
```

Then run:

```python
import pandas as pd
from TT_Scraper import TT_Scraper

# Configure scraper
tt = TT_Scraper(wait_time=0.3, output_files_fp="data/lululemon/")

# Load video IDs
data = pd.read_csv("data/lululemon.csv")
my_list = data["ids"].tolist()

# Scrape in batches
tt.scrape_list(ids=my_list, scrape_content=True, batch_size=4, clear_console=True)
```

Or scrape a single account:

```python
from TT_Scraper import TT_Scraper

tt = TT_Scraper(wait_time=0.3, output_files_fp="data/")
tt.scrape_user(username="lululemon", download_metadata=True)
```

---

### 4. Scrape by Keyword Search

```bash
node websearch_scraping/index.js "nyc mayoral election"
```

**Outputs:**

* `websearch_scraping/data/nyc-mayoral-election/video_ids.csv`
* `websearch_scraping/data/nyc-mayoral-election/video_ids_with_urls.csv`

---

### 5. Scrape Comments for Keyword Search Results

```bash
node websearch_scraping/comments.js "nyc mayoral election"
```

**Writes:**

* `websearch_scraping/websearch_comments/nyc-mayoral-election/comments_<VIDEOID>.json`

Or provide a CSV path explicitly:

```bash
node websearch_scraping/comments.js websearch_scraping/data/nyc-mayoral-election/video_ids_with_urls.csv
```

---

## 📊 Data Processing & Metrics

Once data is scraped, you can run the **processors** to compute engagement metrics, posting velocity, and content distribution.

### 1. Engagement Metrics

**File:** `processing/metrics_processor.py`

```python
import pandas as pd
from pathlib import Path

DATA_DIR = Path("data/")
INPUT_FILE = DATA_DIR / "content_details.csv"
OUTPUT_FILE = DATA_DIR / "metrics_summary.csv"

df = pd.read_csv(INPUT_FILE)

# Overall averages
avg_likes = df["likes"].mean()
avg_comments = df["comments"].mean()
avg_views = df["views"].mean()

# Averages by content type
avg_by_type = df.groupby("content_type")[["likes", "comments", "views"]].mean().reset_index()

# Save results
df.to_csv(OUTPUT_FILE, index=False)
avg_by_type.to_csv(DATA_DIR / "metrics_by_type.csv", index=False)
```

**Outputs:**

* `metrics_summary.csv` → overall averages
* `metrics_by_type.csv` → averages split by `content_type`

---

### 2. Posting Velocity

**File:** `processing/velocity_summary.py`

Counts how many videos were posted per week.

```python
import json, pandas as pd
from pathlib import Path

DATA_DIR = Path("data/")
OUT_DIR = DATA_DIR / "velocity"
OUT_DIR.mkdir(parents=True, exist_ok=True)

timestamps = []
for fpath in DATA_DIR.glob("*_metadata.json"):
    with open(fpath) as f: data = json.load(f)
    timestamps.append(data["video_metadata"]["time_created"])

df = pd.DataFrame({"created": pd.to_datetime(timestamps)})
df["year_week"] = df["created"].dt.strftime("%G-W%V")

weekly_counts = df.groupby("year_week").size().reset_index(name="posts")
weekly_counts.to_csv(OUT_DIR / "velocity_summary.csv", index=False)
```

**Outputs:**

* `velocity_summary.csv` → weekly posting activity

---

### 3. Content Distribution

**File:** `processing/content_distribution.py`

Builds a dataset of all posts and their content types.

```python
import json, pandas as pd
from pathlib import Path

DATA_DIR = Path("data/")
OUT_DIR = DATA_DIR / "velocity"
OUT_DIR.mkdir(parents=True, exist_ok=True)

records = []
for fpath in DATA_DIR.glob("*_metadata.json"):
    with open(fpath) as f: data = json.load(f)
    meta = data["video_metadata"]
    ctype = "image" if meta.get("image_post") else "ad" if meta.get("is_ad") else "video"
    records.append({
        "id": meta["id"],
        "time_created": meta["time_created"],
        "content_type": ctype,
        "likes": meta.get("diggcount", 0),
        "comments": meta.get("commentcount", 0),
        "views": meta.get("playcount", 0),
    })

df = pd.DataFrame(records)
df.to_csv(OUT_DIR / "content_details.csv", index=False)

distribution = df["content_type"].value_counts(normalize=True).reset_index()
distribution.columns = ["content_type", "share"]
distribution.to_csv(OUT_DIR / "content_distribution.csv", index=False)
```

**Outputs:**

* `content_details.csv` → per-post metadata
* `content_distribution.csv` → share of each content type

---

## 📝 Notes

* Puppeteer runs with `headless: false` so you can see the browser actions.
* Scripts handle **auto-scrolling**, **loading more replies**, and **cookies**.
* Comments are saved as structured JSON for downstream sentiment analysis.
* Use the processing scripts to quickly get **averages, velocity trends, and content mix**.
* Large data collections should use `--limit` / `--max` flags to avoid TikTok rate limits.
* For bulk datasets, prefer **Python TT\_Scraper** for efficiency.

---

🔄 Example Full Pipeline

1. Scrape profile videos
node account_scraping/profile.js @lululemon --limit 10

2. Scrape comments from those videos
node account_scraping/comments_profile.js @lululemon --max 5 --dir lululemon_run1

3. Process content distribution & engagement metrics
python processing/content_distribution.py
python processing/metrics_processor.py
python processing/velocity_summary.py

👉 This gives you:
content_details.csv & content_distribution.csv
metrics_summary.csv & metrics_by_type.csv
velocity_summary.csv
---
---

🎉 Happy scraping & analyzing!

```
---
