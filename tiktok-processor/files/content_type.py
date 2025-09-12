import json
from pathlib import Path
import pandas as pd

# Input/output paths
DATA_DIR = Path("data/")
OUT_DIR = DATA_DIR / "velocity"
OUT_DIR.mkdir(parents=True, exist_ok=True)

records = []

for fpath in DATA_DIR.glob("*_metadata.json"):
    try:
        with open(fpath, "r") as f:
            data = json.load(f)
        meta = data["video_metadata"]

        # Determine content type (heuristic)
        if meta.get("image_post", False):
            ctype = "image"
        elif meta.get("is_ad", False):
            ctype = "ad"
        else:
            ctype = "video"   # default for TikTok

        records.append({
            "id": meta["id"],
            "time_created": meta["time_created"],
            "content_type": ctype,
            "likes": meta.get("diggcount", 0),
            "comments": meta.get("commentcount", 0),
            "views": meta.get("playcount", 0),
        })
    except Exception as e:
        print(f"Skipping {fpath}: {e}")

# Build DataFrame
df = pd.DataFrame(records)

if df.empty:
    print("⚠️ No metadata found")
    exit()

# Distribution of content types
distribution = df["content_type"].value_counts(normalize=True).reset_index()
distribution.columns = ["content_type", "share"]

# Save outputs
df.to_csv(OUT_DIR / "content_details.csv", index=False)
distribution.to_csv(OUT_DIR / "content_distribution.csv", index=False)

print("Content type distribution:")
print(distribution)

print(f"\n✅ Saved details to {OUT_DIR}")
