#!/usr/bin/env python3
"""
NUCC Facebook Event Image Downloader (Local Paths)
--------------------------------------------------
Extracts event details from a saved Facebook "Events" page and downloads all
event thumbnails to static/trip/event-images. The resulting JSON references
these local files instead of remote Facebook URLs.
"""

from __future__ import annotations

import json
import re
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

PROJECT_ROOT = Path(__file__).resolve().parent.parent
EVENT_IMAGES_DIR = PROJECT_ROOT / "static" / "trip" / "event-images"
CONTENT_TRIP_DIR = PROJECT_ROOT / "content" / "trip"
OUTPUT_JSON = Path(__file__).resolve().with_name("nucc_events_full.json")


def extract_bg_url(style: str | None) -> str | None:
    """Extract full background-image URL from inline style attribute."""
    if not style:
        return None
    match = re.search(r'background-image:\s*url\(["\']?(https?://[^)"\']+)["\']?\)', style)
    return match.group(1) if match else None


def slugify(text: str) -> str:
    """Sanitize text for use in filenames (underscored)."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^0-9A-Za-z]+", "_", text)
    text = re.sub(r"_+", "_", text)
    return text.strip("_") or "untitled"


def parse_event_date(date_text: str | None) -> datetime | None:
    """Try to parse a datetime from the event's date text."""
    if not date_text:
        return None

    cleaned = date_text.strip()
    cleaned = re.sub(r"^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s*", "", cleaned, flags=re.IGNORECASE)
    for sep in ("–", "-", "to"):
        if sep in cleaned:
            cleaned = cleaned.split(sep)[0].strip()
            break
    cleaned = re.sub(r"(\d{1,2})(st|nd|rd|th)", r"\1", cleaned, flags=re.IGNORECASE)

    if not re.search(r"\b\d{4}\b", cleaned):
        return None

    for fmt in ("%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None


def build_date_prefix(event: dict, slug_map: dict[str, str]) -> str | None:
    parsed = parse_event_date(event.get("date"))
    if parsed:
        return parsed.strftime("%Y%m%d")

    link = event.get("link") or ""
    link_match = re.search(r"/events/([^/?#]+)/?", link)
    if link_match:
        event_id = link_match.group(1)
        slug = slug_map.get(event_id)
        if slug and re.match(r"^\d{6}", slug):
            yy = slug[:2]
            year = int(yy)
            year += 2000 if year < 70 else 1900
            return f"{year:04d}{slug[2:6]}"
    return None


def build_event_slug_map(content_dir: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    if not content_dir.exists():
        return mapping
    event_regex = re.compile(r"https://www\.facebook\.com/events/([^/\"']+)")
    for index_path in content_dir.glob("*/index.md"):
        try:
            text = index_path.read_text(encoding="utf-8")
        except OSError:
            continue
        match = event_regex.search(text)
        if match:
            event_id = match.group(1).split("?")[0]
            mapping[event_id] = index_path.parent.name
    return mapping


def derive_trip_slug(event: dict, slug_map: dict[str, str]) -> str:
    prefix = build_date_prefix(event, slug_map)
    link = event.get("link") or ""
    link_match = re.search(r"/events/([^/?#]+)/?", link)
    slug_from_map = slug_map.get(link_match.group(1)) if link_match else None

    candidate = None
    if slug_from_map:
        candidate = slugify(slug_from_map).lower().replace("-", "_")
        candidate = re.sub(r"_+", "_", candidate).strip("_") or None
        if candidate and re.match(r"^\d{6}_", candidate):
            yy = candidate[:2]
            rest = candidate[6:]
            year = int(yy) + (2000 if int(yy) < 70 else 1900)
            candidate = f"{year:04d}{candidate[2:6]}{rest}"
        if candidate and prefix and not candidate.startswith(prefix):
            candidate = f"{prefix}_{candidate.split('_', 1)[-1]}"
        if candidate and re.match(r"^\d{8}_", candidate):
            return candidate

    title_slug = slugify(event.get("title", "")).lower().replace("-", "_") or "untitled"
    title_slug = re.sub(r"_+", "_", title_slug)
    if prefix:
        if candidate:
            suffix = candidate.split("_", 1)[-1] if "_" in candidate else candidate
            return f"{prefix}_{suffix}" if suffix else f"{prefix}_{title_slug}"
        return f"{prefix}_{title_slug}"
    if candidate:
        return candidate
    return f"00000000_{title_slug}"


def ensure_project_root() -> None:
    cwd = Path.cwd().resolve()
    if cwd != PROJECT_ROOT.resolve():
        print("❌ Run this script from the project root.")
        sys.exit(1)


def main() -> None:
    if len(sys.argv) < 2:
        print("❌ Usage: python3 facebook_events_parser/extract_events_full.py <path_to_html_file>")
        sys.exit(1)

    ensure_project_root()
    html_path = Path(sys.argv[1])
    if not html_path.exists():
        print(f"❌ File not found: {html_path}")
        sys.exit(1)

    print(f"📄 Parsing HTML: {html_path}")
    soup = BeautifulSoup(open(html_path, encoding="utf-8"), "html.parser")

    all_bg_urls = []
    for div in soup.find_all(style=True):
        url = extract_bg_url(div.get("style", ""))
        if url and "scontent" in url:
            all_bg_urls.append(url)
    print(f"📸 Found {len(all_bg_urls)} inline background-image URLs")

    date_pattern = re.compile(
        r"\b(?:\d{1,2}\s*(?:–|-|to)?\s*\d{0,2}\s*[A-Za-z]{3,9}\s*\d{4}|"
        r"[A-Za-z]{3,9}\s*\d{1,2},?\s*\d{4}|"
        r"(?:Fri|Sat|Sun|Mon|Tue|Wed|Thu)[a-z]*,\s*[A-Za-z]{3,9}\s*\d{1,2})\b"
    )
    host_pattern = re.compile(r"Created by\s+([A-Za-z\s]+?)(?:\s+(?:Going|Maybe|Can|Can't).*)?$", re.IGNORECASE)

    events = []
    seen_links = set()
    image_index = 0
    all_a_tags = soup.find_all("a", href=True)
    print(f"🔍 Found {len(all_a_tags)} <a> tags")

    for a in all_a_tags:
        href = a["href"]
        if "facebook.com/events" not in href:
            continue
        title = a.get_text(strip=True)
        if not title:
            continue
        link = href.split("?")[0]
        if link in seen_links:
            continue
        seen_links.add(link)

        ### 🔧 FIX: Prefer image *before* the title instead of parent chain
        image_url = None
        # Look backwards for image before this <a>
        for sib in a.find_all_previous():
            if sib.name == "a":
                break
            style = sib.get("style")
            url = extract_bg_url(style) if style else None
            if url and "scontent" in url:
                image_url = url
                break

        # Fallback: walk up the ancestor chain
        if not image_url:
            for ancestor in a.parents:
                style = ancestor.get("style")
                url = extract_bg_url(style) if style else None
                if url and "scontent" in url:
                    image_url = url
                    break

        # Fallback sequentially if still not found
        if not image_url and image_index < len(all_bg_urls):
            image_url = all_bg_urls[image_index]
            image_index += 1

        context = " ".join(
            p.get_text(" ", strip=True)
            for p in a.parents
            if hasattr(p, "get_text") and p.get_text(strip=True)
        )
        date_match = date_pattern.search(context)
        host_match = host_pattern.search(context)

        event = {
            "title": title,
            "link": link,
            "date": date_match.group(0) if date_match else None,
            "host": host_match.group(1).strip() if host_match else None,
            "image": image_url,
            "description": None,
        }
        events.append(event)
        print(f"🧭 {len(events):03d}: {title[:60]!r}")
        print(f"     ↳ Date: {event['date'] or '❌'} | Host: {event['host'] or '❌'}")
        print(f"     ↳ Image URL: {'✅' if image_url else '❌'}")

    slug_map = build_event_slug_map(CONTENT_TRIP_DIR)
    if slug_map:
        print(f"🗂️  Loaded {len(slug_map)} trip slug reference(s)")
    else:
        print("ℹ️  No trip slug references found; generating slugs automatically")

    EVENT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; NUCC-Scraper/1.0)"}
    downloaded = 0

    for event in events:
        url = event.get("image")
        if not url:
            continue
        trip_slug = derive_trip_slug(event, slug_map)
        filename = f"{trip_slug}.jpg"
        out_path = EVENT_IMAGES_DIR / filename

        if out_path.exists():
            print(f"♻️  Replacing existing image for {trip_slug}")


        try:
            resp = requests.get(url, headers=headers, timeout=20, stream=True)
            resp.raise_for_status()
            with open(out_path, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        fh.write(chunk)
            downloaded += 1
            event["image"] = f"static/trip/event-images/{filename}"
            print(f"⬇️  [{downloaded:03d}] Saved: {event['image']}")
            time.sleep(0.1)
        except requests.RequestException as e:
            print(f"⚠️  Failed {url}: {e}")
            event["image"] = None

    for event in events:
        if event.get("image"):
            continue
        trip_slug = derive_trip_slug(event, slug_map)
        candidate = EVENT_IMAGES_DIR / f"{trip_slug}.jpg"
        if candidate.exists():
            event["image"] = f"static/trip/event-images/{trip_slug}.jpg"

    print(f"\n🎉 Downloaded {downloaded} image(s) to {EVENT_IMAGES_DIR.relative_to(PROJECT_ROOT)}")
    with open(OUTPUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(events, fh, indent=2, ensure_ascii=False)

    print(f"💾 Saved final JSON to: {OUTPUT_JSON.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()

