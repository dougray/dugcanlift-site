#!/usr/bin/env python3
"""
Build lift/foods.json — the bundled USDA ingredient list LIFT web and Coach web
search offline — from a FoodData Central SR Legacy CSV download.

    python3 scripts/build_foods_json.py \
        --fdc /path/to/fdc            # holds food.csv and food_nutrient.csv
        --out lift/foods.json
        [--keep lift/foods.json]      # see "Reproducing the shipped file"
        [--compare lift/foods.json]   # report differences, write nothing

Row shape, per 100 g:

    [name, categoryIndex, kcal, proteinG, fatG, carbsG, fiberG,
     saturatedFatG, sugarG, sodiumMg]

The first seven columns are the original file's. The last three were appended
later, so a reader that destructures seven positions keeps working. They are
null when USDA has no value for the food — which is not zero. The five original
macros never carry null: a missing fibre was written as 0 before this script
existed, and changing that would change what an existing reader computes.

Nutrient ids (FoodData Central `nutrient.csv`):
    1008 Energy (kcal)         1003 Protein            1004 Total lipid (fat)
    1005 Carbohydrate, by diff 1079 Fiber, total       1258 Fatty acids, total saturated
    2000 Sugars, total incl. NLEA (the id lift-ios's Tools/build_reference.py uses)
    1093 Sodium, Na (mg)

Rounding: one decimal for every column but sodium, which is whole milligrams,
using Python's round() on the parsed double. (kcal is one decimal too: SR Legacy
states nearly every energy value whole, but not all — Alaska pollock is 86.6.)

Reproducing the shipped file
----------------------------
The original foods.json had no generator. Built from the SR Legacy CSVs in
lift-ios/data/fdc, this script reproduces its rows, order, categories and 7,790
of 7,793 names exactly; what differs is:

  * three names, which a later USDA release renamed —
      "Milk, human, mature, fluid (For Reference Only)"  (CSV: no suffix)
      "Wheat, khorasan, cooked" / "..., uncooked"        (CSV: "KAMUT khorasan")
  * 354 of 38,965 macro values (in 344 rows; 144 protein, 83 fat, 127
    carbohydrate), every one a value the CSV states to exactly two decimals
    ending in 5, such as 26.85. The shipped file rounded those ties up and down
    about evenly — 26.85 to 26.8 but 10.35 to 10.4 — in a way neither
    half-even, half-up nor rounding the double decides, so its source release
    evidently carried more digits than this CSV.

`--keep` takes the name and first seven columns from an existing foods.json for
every row it can match, so appending columns does not also move 354 numbers
and three names nobody asked to change. Rows are matched by FDC name, with the
three renames above mapped explicitly.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

csv.field_size_limit(sys.maxsize)

MACROS = [1008, 1003, 1004, 1005, 1079]          # kcal, protein, fat, carbs, fibre
EXTRAS = [1258, 2000, 1093]                      # saturated fat g, sugar g, sodium mg
WANTED = set(MACROS + EXTRAS)

SOURCE = "USDA FoodData Central, SR Legacy (public domain)"
BASIS = "per 100 g"
COLUMNS = ["name", "category", "kcal", "proteinG", "fatG", "carbsG", "fiberG",
           "saturatedFatG", "sugarG", "sodiumMg"]

# FDC food_category_id -> name. SR Legacy's food_category.csv is not in every
# download, and the shipped file's category order is the order each category
# first appears in food.csv, which this reproduces.
CATEGORY_NAMES = {
    "1": "Dairy and Egg Products", "2": "Spices and Herbs", "3": "Baby Foods",
    "4": "Fats and Oils", "5": "Poultry Products", "6": "Soups, Sauces, and Gravies",
    "7": "Sausages and Luncheon Meats", "8": "Breakfast Cereals",
    "9": "Fruits and Fruit Juices", "10": "Pork Products",
    "11": "Vegetables and Vegetable Products", "12": "Nut and Seed Products",
    "13": "Beef Products", "14": "Beverages", "15": "Finfish and Shellfish Products",
    "16": "Legumes and Legume Products", "17": "Lamb, Veal, and Game Products",
    "18": "Baked Products", "19": "Sweets", "20": "Cereal Grains and Pasta",
    "21": "Fast Foods", "22": "Meals, Entrees, and Side Dishes", "23": "Snacks",
    "24": "American Indian/Alaska Native Foods", "25": "Restaurant Foods",
}

# Shipped name -> this CSV's name, for the three foods USDA renamed.
RENAMED = {
    "Milk, human, mature, fluid (For Reference Only)": "Milk, human, mature, fluid",
    "Wheat, khorasan, cooked": "Wheat, KAMUT khorasan, cooked",
    "Wheat, khorasan, uncooked": "Wheat, KAMUT khorasan, uncooked",
}


def number(value: float, places: int):
    rounded = round(value, places)
    return int(rounded) if rounded == int(rounded) else rounded


def build(fdc: Path) -> dict:
    foods: dict[str, dict] = {}
    category_order: list[str] = []
    with (fdc / "food.csv").open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["data_type"] != "sr_legacy_food":
                continue
            foods[row["fdc_id"]] = row
            if row["food_category_id"] not in category_order:
                category_order.append(row["food_category_id"])

    amounts: dict[str, dict[int, float]] = {}
    with (fdc / "food_nutrient.csv").open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["fdc_id"] not in foods:
                continue
            nutrient = int(row["nutrient_id"])
            if nutrient in WANTED and row["amount"] != "":
                amounts.setdefault(row["fdc_id"], {})[nutrient] = float(row["amount"])

    index = {cat: i for i, cat in enumerate(category_order)}
    rows = []
    for fdc_id, food in foods.items():
        values = amounts.get(fdc_id, {})
        if 1008 not in values:
            continue
        macros = [number(values.get(n, 0.0), 1) for n in MACROS]
        extras = [None if n not in values else number(values[n], 0 if n == 1093 else 1)
                  for n in EXTRAS]
        rows.append([food["description"], index[food["food_category_id"]], *macros, *extras])
    rows.sort(key=lambda r: r[0])
    return {
        "source": SOURCE,
        "basis": BASIS,
        "categories": [CATEGORY_NAMES[c] for c in category_order],
        "foods": rows,
    }


def keep_shipped(built: dict, shipped: dict) -> dict:
    by_name = {row[0]: row for row in built["foods"]}
    if shipped["categories"] != built["categories"]:
        sys.exit("--keep: category lists differ; refusing to mix indexes")
    rows = []
    for old in shipped["foods"]:
        new = by_name.get(RENAMED.get(old[0], old[0]))
        if new is None:
            sys.exit(f"--keep: no USDA row for {old[0]!r}")
        rows.append(old[:7] + new[7:])
    built = dict(built, foods=rows)
    return built


def serialise(data: dict) -> str:
    out = {"source": data["source"], "basis": data["basis"]}
    if len(data["foods"][0]) > 7:
        out["columns"] = COLUMNS
    out["categories"] = data["categories"]
    out["foods"] = data["foods"]
    return json.dumps(out, separators=(",", ":"), ensure_ascii=False)


def compare(built: dict, shipped: dict) -> None:
    """Rows are matched by name (through RENAMED), so a rename that moves a row
    in the sort does not count every row after it as different."""
    print("categories identical:", built["categories"] == shipped["categories"])
    print("rows:", len(built["foods"]), "vs", len(shipped["foods"]))
    by_name = {row[0]: row for row in built["foods"]}
    order = [RENAMED.get(row[0], row[0]) for row in shipped["foods"]]
    print("same foods once renames are mapped:", sorted(order) == [row[0] for row in built["foods"]],
          "· shipped order is a plain sort by name:", [r[0] for r in shipped["foods"]] == sorted(r[0] for r in shipped["foods"]))
    names = values = rows = 0
    for old in shipped["foods"]:
        new = by_name.get(RENAMED.get(old[0], old[0]))
        if new is None:
            print("  missing from USDA:", repr(old[0]))
            continue
        if new[0] != old[0]:
            names += 1
            print("  renamed:", repr(old[0]), "<-", repr(new[0]))
        changed = sum(1 for i in range(1, 7) if new[i] != old[i])
        values += changed
        rows += bool(changed)
    print(f"names differing: {names} · values differing in columns 2-7: {values} (in {rows} rows)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fdc", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--keep", type=Path)
    parser.add_argument("--compare", type=Path)
    args = parser.parse_args()

    built = build(args.fdc)
    if args.compare:
        compare(built, json.loads(args.compare.read_text()))
        return
    if args.keep:
        built = keep_shipped(built, json.loads(args.keep.read_text()))
    if not args.out:
        sys.exit("--out is required unless --compare is given")
    counts = [sum(1 for r in built["foods"] if r[i] is not None) for i in (7, 8, 9)]
    args.out.write_text(serialise(built))
    print(f"{len(built['foods'])} foods · saturated fat {counts[0]} · sugar {counts[1]} · sodium {counts[2]}")


if __name__ == "__main__":
    main()
