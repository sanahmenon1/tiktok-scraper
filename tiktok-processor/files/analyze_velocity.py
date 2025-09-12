import json
from pathlib import Path
import pandas as pd

# Paths
DATA_DIR = Path("data/")
OUT_DIR = DATA_DIR / "velocity"
OUT_DIR.mkdir(parents=True, exist_ok=True)  # create if not exists

timestamps = []

for fpath in DATA_DIR.glob("*_metadata.json"):
    try:
        with open(fpath, "r") as f:
            data = json.load(f)
        time_created = data["video_metadata"]["time_created"]
        timestamps.append(time_created)
    except Exception as e:
        print(f"Skipping {fpath}: {e}")

if not timestamps:
    print("No timestamps found — check if *_metadata.json files exist in data/cuomo/")
    exit()

df = pd.DataFrame({"created": pd.to_datetime(timestamps)})
df["year_week"] = df["created"].dt.strftime("%G-W%V")

weekly_counts = df.groupby("year_week").size().reset_index(name="posts")
avg_per_week = weekly_counts["posts"].mean()

# Save to CSV
out_file = OUT_DIR / "velocity_summary.csv"
weekly_counts.to_csv(out_file, index=False)

print("Posts per week:")
print(weekly_counts)
print(f"\nAverage posts per week: {avg_per_week:.2f}")
print(f"\n✅ Results saved to {out_file}")