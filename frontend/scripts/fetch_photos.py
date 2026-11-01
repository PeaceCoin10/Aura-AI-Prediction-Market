#!/usr/bin/env python3
"""Curate a small, license-clean photographic library per vertical from Wikimedia Commons.

Downloads 1200px thumbnails (Commons resizes server-side, so no local imaging deps), records the
author/license for each file, and writes `public/art/photos/CREDITS.json` + `CREDITS.md`.

Run: python3 frontend/scripts/fetch_photos.py
"""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "art" / "photos"
API = "https://commons.wikimedia.org/w/api.php"
UA = "aura-market-terminal/1.0 (photo curation for a demo UI; contact: local)"

QUERIES = {
    "crypto": [
        "bitcoin coins physical", "cryptocurrency exchange office", "stock exchange trading floor",
        "server room data center", "gold bullion bars", "financial charts screen trading",
    ],
    "news": [
        "United Nations general assembly hall", "US Capitol building", "parliament building chamber",
        "newspaper printing press", "press conference microphones", "central bank building",
    ],
    "sports": [
        "basketball arena game", "football stadium match", "formula one car race", "tennis grand slam court",
        "olympic stadium athletics", "soccer players match",
    ],
    "esports": [
        "esports tournament stage", "gaming tournament audience", "computer gaming setup tournament",
        "league of legends arena", "counter strike tournament", "game convention stage",
    ],
    "tech": [
        "data center servers", "semiconductor wafer fab", "humanoid robot", "satellite launch rocket",
        "AI research laboratory", "electric vehicle factory",
    ],
}
BAD = re.compile(r"(logo|diagram|chart|graph|map|flag|icon|seal|coat[_ ]of[_ ]arms|poster|cover|screenshot)", re.I)
OK_LIC = re.compile(r"(cc0|cc[ -]by|public domain|pd)", re.I)


def api(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def search(term: str, limit: int = 8) -> list[dict]:
    data = api({
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": f"filetype:bitmap {term}", "gsrnamespace": "6", "gsrlimit": str(limit),
        "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime", "iiurlwidth": "1200",
    })
    out = []
    for page in data.get("query", {}).get("pages", {}).values():
        ii = (page.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata", {})
        lic = (md.get("LicenseShortName", {}) or {}).get("value", "")
        if ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if (ii.get("width") or 0) < 1000:
            continue
        if BAD.search(page.get("title", "")) or not OK_LIC.search(lic):
            continue
        out.append({
            "title": page["title"],
            "thumb": ii.get("thumburl"),
            "page": ii.get("descriptionurl"),
            "license": lic,
            "artist": re.sub(r"<[^>]+>", "", (md.get("Artist", {}) or {}).get("value", "")).strip(),
        })
    return out


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    credits = []
    for vertical, terms in QUERIES.items():
        picked = 0
        seen_titles = set()
        for term in terms:
            if picked >= 8:
                break
            try:
                results = search(term)
            except Exception as exc:  # network hiccup: keep going, never invent a file
                print(f"  ! {vertical} '{term}': {exc}")
                continue
            for item in results:
                if picked >= 8 or item["title"] in seen_titles:
                    continue
                name = f"{vertical}-{picked + 1}.jpg"
                try:
                    req = urllib.request.Request(item["thumb"], headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=60) as r:
                        blob = r.read()
                except Exception as exc:
                    print(f"  ! download {item['title']}: {exc}")
                    continue
                if len(blob) < 20_000 or blob[:2] != b"\xff\xd8":
                    continue
                (OUT / name).write_bytes(blob)
                seen_titles.add(item["title"])
                credits.append({
                    "file": name, "vertical": vertical, "title": item["title"],
                    "artist": item["artist"][:120], "license": item["license"], "page": item["page"],
                })
                picked += 1
        print(f"{vertical}: {picked} photos")
    (OUT / "CREDITS.json").write_text(json.dumps(credits, indent=1, ensure_ascii=False), encoding="utf-8")
    lines = ["# Photo credits", "", "Photographs are Wikimedia Commons thumbnails, used under the license named per file.", ""]
    for c in credits:
        lines.append(f"- `{c['file']}` — {c['title']} · {c['artist'] or 'unknown'} · {c['license']} · {c['page']}")
    (OUT / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"total {len(credits)} photos")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
