import yaml
import json
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; dugcanlift-price-tracker/1.0; +https://www.dugcanlift.com)"
}

def extract_price(text):
    match = re.search(r"[\d,]+\.\d{2}", text)
    if match:
        return float(match.group().replace(",", ""))
    return None

def scrape_product(product):
    try:
        resp = requests.get(product["url"], headers=HEADERS, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        # Primary method: Shopify/Open Graph meta tag (stable across theme redesigns)
        price = None
        meta_tag = soup.find("meta", property="product:price:amount")
        if meta_tag and meta_tag.get("content"):
            price = float(meta_tag["content"])

        # Fallback: try a CSS selector if provided and meta tag missing
        if price is None and product.get("price_selector"):
            el = soup.select_one(product["price_selector"])
            if el:
                price = extract_price(el.get_text())

        if price is None:
            return {**product, "price": None, "error": "price not found (no meta tag, no selector match)"}

        cost_per_serving = round(price / product["servings"], 3) if product.get("servings") else None
        return {
            **product,
            "price": price,
            "cost_per_serving": cost_per_serving,
            "error": None,
        }
    except Exception as e:
        return {**product, "price": None, "error": str(e)}

def main():
    with open("scripts/products.yml") as f:
        products = yaml.safe_load(f)

    results = []
    for p in products:
        print(f"Scraping: {p['name']} ({p['brand']})")
        results.append(scrape_product(p))
        time.sleep(2)  # be polite, don't hammer their servers

    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "products": results,
    }

    with open("_data/supplement_prices.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote {len(results)} products to _data/supplement_prices.json")

if __name__ == "__main__":
    main()
