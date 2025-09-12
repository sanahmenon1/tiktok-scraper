import pandas as pd
from pathlib import Path

# Paths
DATA_DIR = Path(f"data/")
INPUT_FILE = DATA_DIR / "content_details.csv"
OUTPUT_FILE = DATA_DIR / "metrics_summary.csv"

# Load content details
df = pd.read_csv(INPUT_FILE)

if df.empty:
    print("⚠️ content_details.csv is empty")
    exit()

# Calculate overall averages
avg_likes = df["likes"].mean()
avg_comments = df["comments"].mean()
avg_views = df["views"].mean()

# Also calculate averages by content type
avg_by_type = df.groupby("content_type")[["likes", "comments", "views"]].mean().reset_index()

# Save to CSV
summary = pd.DataFrame({
    "metric": ["avg_likes", "avg_comments", "avg_views"],
    "value": [avg_likes, avg_comments, avg_views]
})
summary.to_csv(OUTPUT_FILE, index=False)

# Save detailed breakdown by type
avg_by_type.to_csv(DATA_DIR / "metrics_by_type.csv", index=False)

# Print to console
print("Overall averages:")
print(summary)
print("\nAverages by content type:")
print(avg_by_type)
print(f"\n✅ Results saved to {OUTPUT_FILE} and metrics_by_type.csv")
