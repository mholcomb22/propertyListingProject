# Zillow Cash Flow Dashboard

A local Python web app that searches Zillow listings by ZIP code, estimates rental cash flow with a 20% down payment, and displays the results in a browser dashboard.

## Features

- ZIP code search
- Zillow listing extraction with `curl_cffi`
- Cash-flow estimates using rent, mortgage, taxes, insurance, vacancy, maintenance, management, and capex assumptions
- Property type filter, including duplex and triplex display when Zillow exposes enough detail
- User-adjustable rent, mortgage rate, and expense assumptions
- SQLite search caching by ZIP code
- Saved searches by local user name
- Map links for listings with coordinates
- Sortable browser table
- Property detail panel
- CSV export

## Setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## Run

```bash
.venv/bin/python main.py --serve --port 8001
```

Then open:

```text
http://localhost:8001/index.html
```

## Deploy On Render

1. Go to [Render](https://render.com).
2. Sign in with GitHub.
3. Choose **New** > **Web Service**.
4. Select this repository.
5. Use these settings:

```text
Runtime: Python
Build command: pip install -r requirements.txt
Start command: python main.py --serve --host 0.0.0.0
```

Render will set the `PORT` environment variable automatically. The app reads that value when it starts.

This repository also includes `render.yaml`, so Render can detect the same settings from the repo.

## Command-Line Scrape

```bash
.venv/bin/python main.py --zipcode 83642 --pages 1
```

The app writes the latest output to:

- `zillow_cash_flow.json`
- `zillow_cash_flow.csv`

## Notes

Zillow may block scraping from some networks or cloud hosting providers. If that happens, the UI will still load, but searches may fail or return no results.

This app includes a `REAL_ESTATE_DATA_PROVIDER` setting as a future extension point. The current implementation supports Zillow scraping only. For production use, replace the scraper with a licensed real-estate data API adapter and add real authentication instead of the local saved-search username field.
