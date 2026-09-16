"""Build the public COOK recipe library from an upstream open dataset.

Reads a CC BY-SA 4.0 recipe dataset and writes it into `cook/library/` in the
LIFT recipe wire format, so both LIFT apps and a COACH plan link can resolve a
recipe by id without a server.

    python scripts/build_cook_library.py                 # fetch upstream, rebuild
    python scripts/build_cook_library.py --input f.json  # rebuild from a local copy
    python scripts/build_cook_library.py --check         # verify, write nothing

Output is deterministic: the same input produces byte-identical files, so a
rebuild that changes nothing leaves an empty diff.

Every emitted recipe is validated against `schema/recipe-1.json` before it is
written. The build fails rather than publishing a recipe the apps cannot read.

## Why the shape is what it is

The wire format is a *recipe*. A library entry is a recipe plus the things a
catalogue needs and a single import does not: where it came from, what licence
it carries, which cuisine it belongs to. Rather than widen the wire contract,
an entry nests an untouched wire payload under `recipe` and keeps catalogue
concerns beside it. Nothing upstream is discarded -- per-step timings and the
upstream scaling rules ride in `catalogue`, where a consumer that wants them
can find them and one that does not can ignore them.

## Licence

The upstream data is CC BY-SA 4.0. That is a share-alike licence, so the
library it seeds is CC BY-SA 4.0 too -- see `cook/library/LICENSE.md`. This is
data only; the site's own MIT licence still covers the code. Attribution is
written into every file, and into each recipe's `sourceAuthor`, so a recipe
that is imported into someone's app carries its credit with it.
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

# Pinned rather than "latest": a rebuild should change because this script
# changed, not because a URL started serving something else overnight.
UPSTREAM_URL = "https://theunitools.com/data/unitools-recipes-v1.json"
SOURCE_ID = "unitools"

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "cook" / "library"
RECIPES_DIR = LIBRARY / "recipes"
SCHEMA_PATH = ROOT / "schema" / "recipe-1.json"

LANG = "en"

# Upstream unit -> what goes on the wire. The wire's `unit` is free text "as
# spoken", and these are the spellings `IngredientParser` already knows, so a
# line this script writes parses the same way as one a person typed.
#
# `piece` maps to None on purpose: no unit means a count. The parser has a
# dedicated sentinel for that bucket and prints it bare, because "2 x egg" is
# not how anyone writes a shopping list.
UNIT_MAP = {
    "g": "g",
    "kg": "kg",
    "ml": "ml",
    "l": "l",
    "tbsp": "tbsp",
    "tsp": "tsp",
    "clove": "clove",
    "slice": "slice",
    "pinch": "pinch",
    "sprig": "sprig",
    "piece": None,
    "toTaste": None,
}

# Units that convert to a weight without guessing. Volume and vague units are
# deliberately absent: a tablespoon of oil and a tablespoon of flour are not
# the same mass, and a confident wrong calorie count is worse than an obvious
# gap. Matches `IngredientParser.gramsPerUnit`.
GRAMS_PER_UNIT = {"g": 1.0, "kg": 1000.0}

# Units that take an -s in the line this writes. "2 cloves garlic", not
# "2 clove garlic".
PLURALISE = {"clove", "slice", "sprig"}

SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


# ---------------------------------------------------------------- validation


class SchemaError(Exception):
    pass


def validate(instance, schema, path="recipe"):
    """Validate against the subset of JSON Schema `recipe-1.json` actually uses.

    Reads the published schema rather than restating it, so the two cannot
    drift apart. Raises on the first problem with the path to it -- a build
    that cannot say *which* field of *which* recipe is wrong is not much help
    at 1am.
    """
    if "const" in schema and instance != schema["const"]:
        raise SchemaError(f"{path}: expected {schema['const']!r}, got {instance!r}")

    if "enum" in schema and instance not in schema["enum"]:
        raise SchemaError(f"{path}: {instance!r} not one of {schema['enum']}")

    expected = schema.get("type")
    if expected:
        ok = {
            "object": dict,
            "array": list,
            "string": str,
            "number": (int, float),
            "integer": int,
            "boolean": bool,
        }[expected]
        # bool is a subclass of int in Python; a boolean is not a number here.
        if isinstance(instance, bool) != (expected == "boolean"):
            raise SchemaError(f"{path}: expected {expected}, got {type(instance).__name__}")
        if not isinstance(instance, ok):
            raise SchemaError(f"{path}: expected {expected}, got {type(instance).__name__}")

    if isinstance(instance, str):
        if len(instance) < schema.get("minLength", 0):
            raise SchemaError(f"{path}: shorter than minLength {schema['minLength']}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            raise SchemaError(f"{path}: {instance} below minimum {schema['minimum']}")
        if "exclusiveMinimum" in schema and instance <= schema["exclusiveMinimum"]:
            raise SchemaError(f"{path}: {instance} not above {schema['exclusiveMinimum']}")

    if isinstance(instance, list):
        if len(instance) < schema.get("minItems", 0):
            raise SchemaError(f"{path}: fewer than minItems {schema['minItems']}")
        item_schema = schema.get("items")
        if item_schema:
            for i, item in enumerate(instance):
                validate(item, item_schema, f"{path}[{i}]")

    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                raise SchemaError(f"{path}: missing required field {key!r}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in instance:
                if key not in properties:
                    raise SchemaError(f"{path}: unexpected field {key!r}")
        for key, value in instance.items():
            if key in properties:
                validate(value, properties[key], f"{path}.{key}")


# ------------------------------------------------------------------ mapping


def text(value):
    """English out of upstream's `{"ru": ..., "en": ...}`, whitespace tidied."""
    if value is None:
        return None
    if isinstance(value, str):
        chosen = value
    else:
        chosen = value.get(LANG) or ""
    chosen = " ".join(chosen.split())
    return chosen or None


def number(value):
    """A finite number, or None. Ints stay ints so the JSON reads cleanly."""
    if value is None or isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    if value != value or value in (float("inf"), float("-inf")):
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def raw_text(qty, unit, name, to_taste):
    """The line a person would have typed for this ingredient.

    Always populated, because it is what the shopping list falls back to when
    a quantity could not be resolved, and what someone checks a parse against.
    """
    if to_taste:
        return f"{name}, to taste"
    if qty is None:
        return name
    amount = f"{qty:g}"
    if unit is None:
        return f"{amount} {name}"
    printed = unit
    if unit in PLURALISE and qty != 1:
        printed = unit + "s"
    return f"{amount} {printed} {name}"


def convert_ingredient(raw):
    """One upstream ingredient -> (wire ingredient, upstream scaling rule)."""
    name = text(raw.get("name"))
    if not name:
        return None, None

    upstream_unit = raw.get("unit")
    to_taste = upstream_unit == "toTaste"
    unit = UNIT_MAP.get(upstream_unit, upstream_unit if upstream_unit else None)
    qty = number(raw.get("quantity"))
    if to_taste:
        qty = None

    ingredient = {"rawText": raw_text(qty, unit, name, to_taste)}
    ingredient["item"] = name.lower()
    if qty is not None:
        ingredient["qty"] = qty
        if unit:
            ingredient["unit"] = unit
        factor = GRAMS_PER_UNIT.get(unit)
        if factor is not None:
            grams = qty * factor
            ingredient["grams"] = int(grams) if float(grams).is_integer() else grams

    note = text(raw.get("note"))
    if note:
        ingredient["note"] = note

    return ingredient, raw.get("scaling")


def convert_nutrition(raw):
    """Per-serving macros, or None.

    Omitted entirely when any macro is missing. A zero here would enter
    someone's daily total as fact, and upstream computes these from ingredient
    tables rather than measuring them -- hence `estimated: true`, which both
    apps surface before anything is logged.
    """
    if not isinstance(raw, dict):
        return None
    calories = number(raw.get("calories"))
    protein = number(raw.get("protein"))
    carbs = number(raw.get("carbs"))
    fat = number(raw.get("fat"))
    if None in (calories, protein, carbs, fat):
        return None
    if min(calories, protein, carbs, fat) < 0:
        return None
    return {
        "calories": calories,
        "proteinG": protein,
        "carbsG": carbs,
        "fatG": fat,
        "estimated": True,
    }


def convert(raw, source):
    """One upstream recipe -> one library entry, or None if unusable."""
    slug = raw.get("slug")
    if not slug or not SLUG_RE.fullmatch(slug):
        return None

    name = text(raw.get("name"))
    servings = number(raw.get("baseServings"))
    if not name or not servings or servings <= 0:
        return None

    ingredients = []
    scaling = []
    for item in raw.get("ingredients") or []:
        ingredient, rule = convert_ingredient(item)
        if ingredient:
            ingredients.append(ingredient)
            scaling.append(rule)
    if not ingredients:
        return None

    steps = []
    step_minutes = []
    for step in raw.get("steps") or []:
        body = text(step.get("text") if isinstance(step, dict) else step)
        if not body:
            continue
        steps.append(body)
        step_minutes.append(number(step.get("minutes")) if isinstance(step, dict) else None)
    if not steps:
        return None

    recipe = {
        "schemaVersion": 1,
        "name": name,
        # Attribution travels inside the wire payload, so a recipe imported
        # into someone's app keeps its credit even once it leaves the library.
        "sourceURL": source["url"],
        "sourceAuthor": source["attribution"],
        "servings": servings,
        "ingredients": ingredients,
        "steps": steps,
    }
    for key, upstream in (("prepMinutes", "prepMinutes"), ("cookMinutes", "cookMinutes")):
        minutes = number(raw.get(upstream))
        if isinstance(minutes, int) and minutes >= 0:
            recipe[key] = minutes

    nutrition = convert_nutrition(raw.get("nutritionPerServing"))
    if nutrition:
        recipe["nutritionPerServing"] = nutrition

    catalogue = {
        "country": raw.get("country"),
        "nativeName": text(raw.get("nativeName")),
        "summary": text(raw.get("summary")),
        "category": raw.get("category"),
        "diets": sorted(raw.get("diets") or []),
        "difficulty": raw.get("difficulty"),
        # Kept because upstream measured them and the wire format has nowhere
        # for them. A consumer that wants a timed cook mode has them here.
        "stepMinutes": step_minutes,
        "ingredientScaling": scaling,
    }
    photo = raw.get("photo")
    if isinstance(photo, dict) and photo.get("url"):
        # Recorded, not downloaded and not rendered. The photographs carry
        # their own per-image credit and share-alike terms; republishing them
        # is a separate decision from republishing the text.
        catalogue["photo"] = {
            "url": photo.get("url"),
            "author": photo.get("author"),
            "license": photo.get("license"),
        }
    catalogue = {k: v for k, v in catalogue.items() if v not in (None, [], "")}

    return {
        "schemaVersion": 1,
        "id": f"{SOURCE_ID}-{slug}",
        "source": source,
        "catalogue": catalogue,
        "recipe": recipe,
    }


def index_row(entry):
    """The light row browse and search read, so neither has to fetch 501 files."""
    recipe = entry["recipe"]
    catalogue = entry["catalogue"]
    row = {
        "id": entry["id"],
        "name": recipe["name"],
        "servings": recipe["servings"],
        "source": entry["source"]["id"],
    }
    for key in ("nativeName", "summary", "country", "category", "difficulty", "diets"):
        if key in catalogue:
            row[key] = catalogue[key]
    for key in ("prepMinutes", "cookMinutes"):
        if key in recipe:
            row[key] = recipe[key]
    if "nutritionPerServing" in recipe:
        row["nutritionPerServing"] = recipe["nutritionPerServing"]
    row["ingredientCount"] = len(recipe["ingredients"])
    row["stepCount"] = len(recipe["steps"])
    return row


# -------------------------------------------------------------------- output


def write_json(path, payload):
    """Write pretty, stable, newline-terminated JSON. Returns True if changed."""
    body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == body:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return True


def load_upstream(source_path):
    if source_path:
        return json.loads(Path(source_path).read_text(encoding="utf-8"))
    request = urllib.request.Request(
        UPSTREAM_URL,
        headers={"User-Agent": "dugcanlift-cook-library/1.0 (+https://www.dugcanlift.com)"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="local copy of the upstream JSON (default: fetch)")
    parser.add_argument(
        "--check",
        action="store_true",
        help="build and validate in memory, write nothing, fail if output would change",
    )
    args = parser.parse_args()

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    upstream = load_upstream(args.input)

    raw_recipes = upstream.get("recipes")
    if not isinstance(raw_recipes, list) or not raw_recipes:
        print("upstream payload has no recipes", file=sys.stderr)
        return 1

    source = {
        "id": SOURCE_ID,
        "name": upstream.get("name") or "UniTools World Recipes",
        "version": upstream.get("version"),
        "url": upstream.get("landingPage") or upstream.get("homepage") or UPSTREAM_URL,
        "license": upstream.get("license") or "CC BY-SA 4.0",
        "licenseURL": upstream.get("licenseUrl")
        or "https://creativecommons.org/licenses/by-sa/4.0/",
        "attribution": upstream.get("attribution") or "UniTools — theunitools.com",
        "generatedAt": upstream.get("generatedAt"),
    }
    source = {k: v for k, v in source.items() if v}

    entries = []
    skipped = []
    for raw in raw_recipes:
        entry = convert(raw, source)
        if entry is None:
            skipped.append(raw.get("slug") or "<no slug>")
            continue
        try:
            validate(entry["recipe"], schema, f"{entry['id']}")
        except SchemaError as error:
            print(f"schema: {error}", file=sys.stderr)
            return 1
        entries.append(entry)

    if not entries:
        print("no recipes survived conversion", file=sys.stderr)
        return 1

    entries.sort(key=lambda e: e["id"])
    ids = [e["id"] for e in entries]
    if len(set(ids)) != len(ids):
        print("duplicate recipe ids in output", file=sys.stderr)
        return 1

    index = {
        "schemaVersion": 1,
        "name": "DUGCANLIFT COOK library",
        "url": "https://www.dugcanlift.com/cook/library/",
        "license": "CC BY-SA 4.0",
        "licenseURL": "https://creativecommons.org/licenses/by-sa/4.0/",
        "recipeFormat": "https://www.dugcanlift.com/schema/recipe-1.json",
        "recipePath": "recipes/{id}.json",
        "sources": [source],
        "count": len(entries),
        "recipes": [index_row(e) for e in entries],
    }

    if args.check:
        stale = [
            e["id"]
            for e in entries
            if not (RECIPES_DIR / f"{e['id']}.json").exists()
            or json.loads((RECIPES_DIR / f"{e['id']}.json").read_text(encoding="utf-8")) != e
        ]
        if stale or not (LIBRARY / "index.json").exists():
            print(f"out of date: {len(stale)} recipe file(s) would change", file=sys.stderr)
            return 1
        print(f"up to date: {len(entries)} recipes")
        return 0

    changed = 0
    for entry in entries:
        if write_json(RECIPES_DIR / f"{entry['id']}.json", entry):
            changed += 1
    if write_json(LIBRARY / "index.json", index):
        changed += 1

    # A recipe pulled upstream should leave rather than linger as a file
    # nothing indexes.
    expected = {f"{e['id']}.json" for e in entries}
    removed = 0
    if RECIPES_DIR.exists():
        for path in RECIPES_DIR.glob("*.json"):
            if path.name not in expected:
                path.unlink()
                removed += 1

    with_macros = sum(1 for e in entries if "nutritionPerServing" in e["recipe"])
    print(f"{len(entries)} recipes, {with_macros} with per-serving macros")
    print(f"{changed} file(s) written, {removed} removed")
    if skipped:
        print(f"skipped {len(skipped)}: {', '.join(skipped[:5])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
