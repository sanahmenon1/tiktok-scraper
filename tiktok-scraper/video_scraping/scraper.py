from TT_Scraper import TT_Scraper

# Configure the scraper, this step is always needed
tt = TT_Scraper(wait_time=0.3, output_files_fp="data/")

# scrape user profile
tt.scrape_user(username="lululemon", download_metadata=True)

