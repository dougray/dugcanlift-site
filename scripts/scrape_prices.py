import yaml
import json
import os
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


def page_summary(resp):
    """Short description of a fetched page for error messages, so a run log
    can tell a bot-challenge page apart from a real product page."""
    title = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", resp.text, re.S | re.I)
    if m:
        title = " ".join(m.group(1).split())[:80]
    return f"HTTP {resp.status_code}, {len(resp.content)} bytes, title={title!r}"


def shopify_variants(product):
    """Return the variant list from a Shopify store's /products/<handle>.json
    endpoint, or None if the store doesn't expose it."""
    json_url = product["url"].rstrip("/") + ".json"
    resp = requests.get(json_url, headers=HEADERS, timeout=15)
    if resp.status_code != 200:
        return None
    try:
        return resp.json()["product"]["variants"]
    except (ValueError, KeyError, TypeError):
        return None


def result(product, price):
    cost_per_serving = round(price / product["servings"], 3) if product.get("servings") else None
    return {
        **{k: v for k, v in product.items() if k not in ("variant_match", "platform", "price_selector")},
        "price": price,
        "cost_per_serving": cost_per_serving,
        "error": None,
    }


def scrape_product(product):
    try:
        resp = requests.get(product["url"], headers=HEADERS, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        # Primary method: Shopify/Open Graph meta tags (stable across theme redesigns).
        # Different stores use different property names for the same thing.
        price = None
        for prop in ["product:price:amount", "og:price:amount"]:
            meta_tag = soup.find("meta", property=prop)
            if meta_tag and meta_tag.get("content"):
                price = float(meta_tag["content"])
                break

        # Fallback: a CSS selector if the product declares one.
        if price is None and product.get("price_selector"):
            el = soup.select_one(product["price_selector"])
            if el:
                price = extract_price(el.get_text())

        # Fallback: Shopify stores whose theme omits the meta tag still expose
        # the product JSON. Take the first variant, matching how the meta tag
        # would have reported it.
        if price is None:
            variants = shopify_variants(product)
            if variants:
                price = float(variants[0]["price"])

        if price is None:
            return {**product, "price": None,
                    "error": f"price not found (no meta tag, no selector match; {page_summary(resp)})"}

        return result(product, price)
    except Exception as e:
        return {**product, "price": None, "error": str(e)}


def scrape_shopify_variant(product):
    """For multi-variant Shopify products: fetch the .json endpoint and
    pick a specific variant by matching text in its title."""
    try:
        variants = shopify_variants(product)
        if not variants:
            return {**product, "price": None, "error": "Shopify product JSON unavailable"}

        target = product.get("variant_match", "").lower()
        chosen = next((v for v in variants if target in v["title"].lower()), None)
        if chosen is None:
            titles = [v["title"] for v in variants]
            return {**product, "price": None,
                    "error": f"no variant matches {target!r}; available: {titles}"}

        return result(product, float(chosen["price"]))
    except Exception as e:
        return {**product, "price": None, "error": str(e)}


def main():
    with open("scripts/products.yml") as f:
        products = yaml.safe_load(f)

    results = []
    for p in products:
        print(f"Scraping: {p['name']} ({p['brand']})", flush=True)
        if p.get("platform") == "shopify_variant":
            r = scrape_shopify_variant(p)
        else:
            r = scrape_product(p)
        if r["error"]:
            print(f"  FAILED: {r['error']}", flush=True)
        else:
            print(f"  ${r['price']}", flush=True)
        results.append(r)
        time.sleep(2)  # be polite, don't hammer their servers

    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "products": results,
    }

    with open("_data/supplement_prices.json", "w") as f:
        json.dump(output, f, indent=2)

    unpriced = [r for r in results if r["error"]]
    print(f"Wrote {len(results)} products to _data/supplement_prices.json ({len(unpriced)} without a price)", flush=True)

    # Hand the tally to the workflow so it can alert when a vendor's markup
    # changes, instead of the row silently reading "price unavailable".
    if os.environ.get("GITHUB_OUTPUT"):
        names = "; ".join(f"{r['brand']} {r['name']}" for r in unpriced)
        with open(os.environ["GITHUB_OUTPUT"], "a") as out:
            out.write(f"total={len(results)}\n")
            out.write(f"unpriced={len(unpriced)}\n")
            out.write(f"unpriced_names={names}\n")


if __name__ == "__main__":
    main()
