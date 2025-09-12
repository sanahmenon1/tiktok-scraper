import pandas as pd
from TT_Scraper import TT_Scraper

# Configure the scraper, this step is always needed
tt = TT_Scraper(wait_time=0.3, output_files_fp="data/cuomo/")

# Define list of TikTok ids (ids can be string or integer) 
data = pd.read_csv("data/cuomo.csv")
my_list = data["ids"].tolist()

# Insert list into scraper
tt.scrape_list(ids = my_list, scrape_content = True, batch_size = 4, clear_console = True)