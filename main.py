import argparse
import csv
import json
import mimetypes
import os
import re
from dataclasses import asdict, dataclass
from html import unescape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests
from curl_cffi.requests.exceptions import RequestException


DEFAULT_SEARCH_URL = "https://www.zillow.com/meridian-id/"
DEFAULT_CITY = "Meridian"
DEFAULT_STATE = "ID"
DEFAULT_ZIPCODE = "83642"
MIN_PRICE = 100_000
MAX_PRICE = 100_000_000
BASE_DIR = Path(__file__).resolve().parent
REQUEST_HEADERS = {
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
}


@dataclass
class Listing:
    address: str
    price: int | None
    url: str
    beds: float | None
    baths: float | None
    sqft: int | None
    units: int | None
    status: str | None
    home_status: str | None
    property_subtype: str | None
    home_type: str | None
    city: str | None
    state: str | None
    zipcode: str | None
    zpid: str | None
    monthly_rent: float
    down_payment: float
    loan_amount: float
    monthly_mortgage_pi: float
    monthly_taxes: float
    monthly_insurance: float
    monthly_vacancy: float
    monthly_maintenance: float
    monthly_management: float
    monthly_capex: float
    monthly_expenses: float
    monthly_noi: float
    monthly_cash_flow: float
    cash_on_cash_return: float | None


def money_to_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)

    text = str(value).strip()
    if not text:
        return None

    match = re.search(r"\$?([\d,.]+)\s*([kKmM]?)", text)
    if not match:
        return None

    number = float(match.group(1).replace(",", ""))
    suffix = match.group(2).lower()
    if suffix == "k":
        number *= 1_000
    elif suffix == "m":
        number *= 1_000_000

    return int(number)


def number_from_text(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    match = re.search(r"[\d,.]+", str(value))
    if not match:
        return None
    return float(match.group(0).replace(",", ""))


def guess_units(*values: Any) -> int | None:
    combined = " ".join(str(value or "") for value in values).lower()

    word_units = {
        "duplex": 2,
        "triplex": 3,
        "fourplex": 4,
        "4-plex": 4,
        "quadplex": 4,
    }
    for word, units in word_units.items():
        if word in combined:
            return units

    match = re.search(r"(\d+)\s*(?:unit|units|family|families)", combined)
    if match:
        return int(match.group(1))

    return None


def extract_zipcode(*values: Any) -> str | None:
    combined = " ".join(str(value or "") for value in values)
    match = re.search(r"\b\d{5}\b", combined)
    return match.group(0) if match else None


def infer_property_subtype(*values: Any) -> tuple[str | None, int | None]:
    combined = " ".join(str(value or "") for value in values).lower()
    subtype_units = [
        ("fourplex", 4),
        ("4-plex", 4),
        ("quadplex", 4),
        ("triplex", 3),
        ("duplex", 2),
    ]
    for subtype, units in subtype_units:
        if subtype in combined:
            label = "Fourplex" if units == 4 else "Triplex" if units == 3 else "Duplex"
            return label, units

    match = re.search(r"(\d+)\s*(?:unit|units|family|families)", combined)
    if match:
        units = int(match.group(1))
        if units == 2:
            return "Duplex", units
        if units == 3:
            return "Triplex", units
        if units == 4:
            return "Fourplex", units
        if units > 1:
            return f"{units} Units", units

    return None, None


def monthly_payment(principal: float, annual_rate: float, years: int) -> float:
    if principal <= 0:
        return 0

    monthly_rate = annual_rate / 100 / 12
    months = years * 12
    if monthly_rate == 0:
        return principal / months

    return principal * (
        monthly_rate * (1 + monthly_rate) ** months
    ) / ((1 + monthly_rate) ** months - 1)


def analyze_cash_flow(
    price: int,
    units: int | None,
    args: argparse.Namespace,
) -> dict[str, float | None]:
    analysis_units = units or args.default_units
    monthly_rent = args.monthly_rent
    if monthly_rent is None:
        monthly_rent = analysis_units * args.rent_per_unit

    down_payment = price * (args.down_payment_percent / 100)
    loan_amount = price - down_payment
    mortgage_pi = monthly_payment(loan_amount, args.interest_rate, args.loan_years)

    monthly_taxes = price * (args.tax_rate_percent / 100) / 12
    monthly_insurance = price * (args.insurance_rate_percent / 100) / 12
    monthly_vacancy = monthly_rent * (args.vacancy_percent / 100)
    monthly_maintenance = monthly_rent * (args.maintenance_percent / 100)
    monthly_management = monthly_rent * (args.management_percent / 100)
    monthly_capex = monthly_rent * (args.capex_percent / 100)

    monthly_expenses = (
        mortgage_pi
        + monthly_taxes
        + monthly_insurance
        + monthly_vacancy
        + monthly_maintenance
        + monthly_management
        + monthly_capex
    )
    monthly_noi = monthly_rent - (
        monthly_taxes
        + monthly_insurance
        + monthly_vacancy
        + monthly_maintenance
        + monthly_management
        + monthly_capex
    )
    monthly_cash_flow = monthly_rent - monthly_expenses
    cash_on_cash = None
    if down_payment:
        cash_on_cash = (monthly_cash_flow * 12 / down_payment) * 100

    return {
        "monthly_rent": monthly_rent,
        "down_payment": down_payment,
        "loan_amount": loan_amount,
        "monthly_mortgage_pi": mortgage_pi,
        "monthly_taxes": monthly_taxes,
        "monthly_insurance": monthly_insurance,
        "monthly_vacancy": monthly_vacancy,
        "monthly_maintenance": monthly_maintenance,
        "monthly_management": monthly_management,
        "monthly_capex": monthly_capex,
        "monthly_expenses": monthly_expenses,
        "monthly_noi": monthly_noi,
        "monthly_cash_flow": monthly_cash_flow,
        "cash_on_cash_return": cash_on_cash,
    }


def build_page_url(search_url: str, page_number: int) -> str:
    clean_url = search_url.rstrip("/")
    if page_number == 1:
        return f"{clean_url}/"
    return f"{clean_url}/{page_number}_p/"


def build_zip_search_url(zipcode: str) -> str:
    return f"https://www.zillow.com/{zipcode}/"


def fetch_page(session: requests.Session, url: str, timeout: int) -> str | None:
    print(f"Fetching {url}")
    try:
        response = session.get(url, timeout=timeout)
    except RequestException as error:
        print(f"Request failed: {error}")
        return None

    print(f"Response status: {response.status_code}")
    if response.status_code != 200:
        print(response.text[:700])
        return None
    return response.text


def find_dicts_with_key(value: Any, key: str) -> list[dict[str, Any]]:
    found = []
    if isinstance(value, dict):
        if key in value:
            found.append(value)
        for child in value.values():
            found.extend(find_dicts_with_key(child, key))
    elif isinstance(value, list):
        for item in value:
            found.extend(find_dicts_with_key(item, key))
    return found


def extract_json_objects_from_scripts(soup: BeautifulSoup) -> list[dict[str, Any]]:
    objects = []
    for script in soup.find_all("script"):
        text = script.string or script.get_text()
        if not text:
            continue

        candidates = []
        script_id = script.get("id")
        if script_id == "__NEXT_DATA__":
            candidates.append(text)

        if "listResults" in text:
            match = re.search(r"(\{.*\"listResults\".*\})", text, re.DOTALL)
            if match:
                candidates.append(match.group(1))

        for candidate in candidates:
            try:
                objects.append(json.loads(unescape(candidate)))
            except json.JSONDecodeError:
                continue
    return objects


def normalize_json_listing(raw: dict[str, Any]) -> dict[str, Any] | None:
    home_info = raw.get("hdpData", {}).get("homeInfo", {})
    price = money_to_int(raw.get("price") or raw.get("unformattedPrice"))
    detail_url = raw.get("detailUrl") or raw.get("hdpUrl") or raw.get("url")
    subtype, subtype_units = infer_property_subtype(raw, home_info, raw.get("address"))

    if not detail_url:
        return None

    return {
        "address": raw.get("address") or raw.get("addressStreet") or "N/A",
        "price": price,
        "url": urljoin("https://www.zillow.com", detail_url),
        "beds": number_from_text(raw.get("beds")),
        "baths": number_from_text(raw.get("baths")),
        "sqft": money_to_int(raw.get("area") or raw.get("livingArea")),
        "units": subtype_units or guess_units(
            raw.get("hdpData"),
            raw.get("statusText"),
            raw.get("address"),
            raw.get("detailUrl"),
        ),
        "status": raw.get("statusText") or raw.get("homeStatus"),
        "home_status": raw.get("homeStatus") or home_info.get("homeStatus"),
        "property_subtype": subtype,
        "home_type": raw.get("homeType") or home_info.get("homeType"),
        "city": home_info.get("city"),
        "state": home_info.get("state"),
        "zipcode": home_info.get("zipcode") or extract_zipcode(raw.get("address")),
        "zpid": str(raw.get("zpid")) if raw.get("zpid") else None,
    }


def extract_listings_from_json(soup: BeautifulSoup) -> list[dict[str, Any]]:
    listings = []
    seen_urls = set()

    for obj in extract_json_objects_from_scripts(soup):
        for holder in find_dicts_with_key(obj, "listResults"):
            list_results = holder.get("listResults")
            if not isinstance(list_results, list):
                continue

            for raw in list_results:
                if not isinstance(raw, dict):
                    continue
                listing = normalize_json_listing(raw)
                if not listing or listing["url"] in seen_urls:
                    continue
                seen_urls.add(listing["url"])
                listings.append(listing)

    return listings


def extract_listings_from_cards(soup: BeautifulSoup) -> list[dict[str, Any]]:
    listings = []
    seen_urls = set()

    for card in soup.select("article, li"):
        link = card.select_one("a[href*='/homedetails/']")
        if not link:
            continue

        url = urljoin("https://www.zillow.com", link.get("href", ""))
        if url in seen_urls:
            continue
        seen_urls.add(url)

        text = " ".join(card.get_text(" ", strip=True).split())
        price = money_to_int(text)
        address_el = card.select_one("address")
        address = address_el.get_text(" ", strip=True) if address_el else text[:120]

        listings.append(
            {
                "address": address,
                "price": price,
                "url": url,
                "beds": number_from_text(
                    (re.search(r"([\d.]+)\s*bds?", text) or [""])[0]
                ),
                "baths": number_from_text(
                    (re.search(r"([\d.]+)\s*ba", text) or [""])[0]
                ),
                "sqft": money_to_int((re.search(r"([\d,]+)\s*sqft", text) or [""])[0]),
                "units": guess_units(text, url),
                "status": None,
                "home_status": None,
                "property_subtype": infer_property_subtype(text, url)[0],
                "home_type": None,
                "city": None,
                "state": None,
                "zipcode": extract_zipcode(address, text),
                "zpid": None,
            }
        )

    return listings


def is_probably_multiunit(listing: dict[str, Any]) -> bool:
    home_type = str(listing.get("home_type") or "").upper()
    if home_type:
        return home_type in {"MULTI_FAMILY", "DUPLEX", "TRIPLEX"}

    units = listing.get("units")
    if isinstance(units, int) and units >= 2:
        return True

    combined = f"{listing.get('address', '')} {listing.get('url', '')} {listing.get('status', '')}".lower()
    multiunit_terms = [
        "multi-family",
        "multifamily",
        "duplex",
        "triplex",
        "fourplex",
        "4-plex",
        "quadplex",
        "apartment",
        "units",
    ]
    return any(term in combined for term in multiunit_terms)


def enrich_multiunit_listing(
    session: requests.Session, listing: dict[str, Any], timeout: int
) -> None:
    home_type = str(listing.get("home_type") or "").upper()
    if home_type not in {"MULTI_FAMILY", "DUPLEX", "TRIPLEX"}:
        return
    if listing.get("property_subtype") in {"Duplex", "Triplex", "Fourplex"}:
        return

    html = fetch_page(session, listing["url"], timeout)
    if not html:
        return

    text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
    subtype, units = infer_property_subtype(text)
    if subtype:
        listing["property_subtype"] = subtype
    if units:
        listing["units"] = units


def is_for_sale(listing: dict[str, Any]) -> bool:
    status = str(listing.get("status") or "").lower()
    home_status = str(listing.get("home_status") or "").lower()
    combined = f"{status} {home_status}"
    return any(term in combined for term in ["for_sale", "for sale", "active", "coming soon"])


def matches_location(listing: dict[str, Any], city: str, state: str) -> bool:
    listing_city = str(listing.get("city") or "").lower()
    listing_state = str(listing.get("state") or "").lower()
    if listing_city and listing_state:
        return listing_city == city.lower() and listing_state == state.lower()

    address = str(listing.get("address") or "").lower()
    return city.lower() in address and f", {state.lower()}" in address


def matches_zipcode(listing: dict[str, Any], zipcode: str) -> bool:
    listing_zipcode = str(listing.get("zipcode") or "")
    if listing_zipcode:
        return listing_zipcode == zipcode
    return bool(re.search(rf"\b{re.escape(zipcode)}\b", str(listing.get("address") or "")))


def scrape_zillow(args: argparse.Namespace) -> list[Listing]:
    session = requests.Session()
    session.headers.update(REQUEST_HEADERS)
    session.impersonate = "chrome"
    analyzed = []
    seen_urls = set()

    for page_number in range(1, args.pages + 1):
        url = build_page_url(args.search_url, page_number)
        html = fetch_page(session, url, args.timeout)
        if not html:
            continue

        soup = BeautifulSoup(html, "lxml")
        listings = extract_listings_from_json(soup)
        if not listings:
            listings = extract_listings_from_cards(soup)

        print(f"Found {len(listings)} candidate listings on page {page_number}")

        for listing in listings:
            price = listing.get("price")
            if price is None or price < args.min_price or price > args.max_price:
                continue
            if args.multiunit_only and not is_probably_multiunit(listing):
                continue
            if not is_for_sale(listing):
                continue
            if args.zipcode and not matches_zipcode(listing, args.zipcode):
                continue
            if not args.zipcode and not matches_location(listing, args.city, args.state):
                continue
            if listing["url"] in seen_urls:
                continue

            enrich_multiunit_listing(session, listing, args.timeout)
            if listing.get("units") is None:
                listing["units"] = args.default_units

            seen_urls.add(listing["url"])
            cash_flow = analyze_cash_flow(price, listing.get("units"), args)
            analyzed.append(Listing(**listing, **cash_flow))

    analyzed.sort(key=lambda item: item.monthly_cash_flow, reverse=True)
    return analyzed


def write_outputs(listings: list[Listing], output_json: str, output_csv: str) -> None:
    rows = [asdict(listing) for listing in listings]

    with open(output_json, "w", encoding="utf-8") as json_file:
        json.dump(rows, json_file, indent=2)

    with open(output_csv, "w", encoding="utf-8", newline="") as csv_file:
        fieldnames = list(rows[0].keys()) if rows else list(Listing.__dataclass_fields__.keys())
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def scrape_zipcode(zipcode: str, pages: int = 1) -> list[Listing]:
    args = argparse.Namespace(
        search_url=build_zip_search_url(zipcode),
        city="",
        state="",
        zipcode=zipcode,
        pages=pages,
        min_price=MIN_PRICE,
        max_price=MAX_PRICE,
        multiunit_only=False,
        output_json="zillow_cash_flow.json",
        output_csv="zillow_cash_flow.csv",
        timeout=45,
        down_payment_percent=20,
        interest_rate=7.25,
        loan_years=30,
        default_units=1,
        rent_per_unit=2200,
        monthly_rent=None,
        tax_rate_percent=1.2,
        insurance_rate_percent=0.35,
        vacancy_percent=5,
        maintenance_percent=5,
        management_percent=8,
        capex_percent=5,
    )
    listings = scrape_zillow(args)
    write_outputs(listings, args.output_json, args.output_csv)
    return listings


class ZillowDashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        print(format % args)

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/search":
            query = parse_qs(parsed.query)
            zipcode = query.get("zipcode", [""])[0].strip()
            pages_text = query.get("pages", ["1"])[0].strip()

            if not re.fullmatch(r"\d{5}", zipcode):
                self.send_json({"error": "Enter a valid 5-digit ZIP code."}, status=400)
                return

            try:
                pages = max(1, min(int(pages_text), 5))
            except ValueError:
                pages = 1

            try:
                listings = scrape_zipcode(zipcode, pages=pages)
            except Exception as error:
                self.send_json({"error": str(error)}, status=500)
                return

            self.send_json(
                {
                    "zipcode": zipcode,
                    "count": len(listings),
                    "listings": [asdict(listing) for listing in listings],
                }
            )
            return

        if parsed.path == "/":
            self.path = "/index.html"

        return super().do_GET()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape Zillow listings in a target city and estimate cash flow."
    )
    parser.add_argument("--search-url", default=DEFAULT_SEARCH_URL)
    parser.add_argument("--city", default=DEFAULT_CITY)
    parser.add_argument("--state", default=DEFAULT_STATE)
    parser.add_argument("--zipcode", default="")
    parser.add_argument("--pages", type=int, default=3)
    parser.add_argument("--min-price", type=int, default=MIN_PRICE)
    parser.add_argument("--max-price", type=int, default=MAX_PRICE)
    parser.add_argument("--multiunit-only", action="store_true")
    parser.add_argument("--output-json", default="zillow_cash_flow.json")
    parser.add_argument("--output-csv", default="zillow_cash_flow.csv")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=8001)

    parser.add_argument("--down-payment-percent", type=float, default=20)
    parser.add_argument("--interest-rate", type=float, default=7.25)
    parser.add_argument("--loan-years", type=int, default=30)
    parser.add_argument("--default-units", type=int, default=1)
    parser.add_argument("--rent-per-unit", type=float, default=2200)
    parser.add_argument("--monthly-rent", type=float, default=None)

    parser.add_argument("--tax-rate-percent", type=float, default=1.2)
    parser.add_argument("--insurance-rate-percent", type=float, default=0.35)
    parser.add_argument("--vacancy-percent", type=float, default=5)
    parser.add_argument("--maintenance-percent", type=float, default=5)
    parser.add_argument("--management-percent", type=float, default=8)
    parser.add_argument("--capex-percent", type=float, default=5)

    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.serve:
        port = int(os.getenv("PORT", args.port))
        address = (args.host, port)
        print(f"Serving dashboard at http://{address[0]}:{address[1]}/")
        ThreadingHTTPServer(address, ZillowDashboardHandler).serve_forever()
        return

    if args.zipcode:
        args.search_url = build_zip_search_url(args.zipcode)
        args.multiunit_only = False

    listings = scrape_zillow(args)
    write_outputs(listings, args.output_json, args.output_csv)

    print(f"Saved {len(listings)} analyzed listings to {args.output_json} and {args.output_csv}")
    for listing in listings[:10]:
        price = f"${listing.price:,.0f}" if listing.price else "N/A"
        cash_flow = f"${listing.monthly_cash_flow:,.0f}/mo"
        print(f"{cash_flow:>12} | {price:>12} | {listing.address} | {listing.url}")


if __name__ == "__main__":
    main()
