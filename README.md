# Zillow Cash Flow Dashboard

A local Python web app that searches Zillow listings by ZIP code, estimates rental cash flow with a 20% down payment, and displays the results in a browser dashboard.

## Features

- ZIP code search
- Zillow listing extraction with `curl_cffi`
- Cash-flow estimates using rent, mortgage, taxes, insurance, vacancy, maintenance, management, and capex assumptions
- Property type filter, including duplex and triplex display when Zillow exposes enough detail
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

## Command-Line Scrape

```bash
.venv/bin/python main.py --zipcode 83642 --pages 1
```

The app writes the latest output to:

- `zillow_cash_flow.json`
- `zillow_cash_flow.csv`

## Notes

Zillow may block scraping from some networks or cloud hosting providers. If that happens, the UI will still load, but searches may fail or return no results.
