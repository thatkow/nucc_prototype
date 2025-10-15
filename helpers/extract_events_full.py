#!/usr/bin/env python3
"""Scrape Facebook event HTML into Markdown files."""

from __future__ import annotations

import argparse
import html
import re
import shutil
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import unquote, urlparse

import urllib.error
import urllib.request

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRAPED_DIR = PROJECT_ROOT / "scraped"
IMAGES_DIR = SCRAPED_DIR / "images"

DAY_INDEX = {
    "Mon": 0,
    "Tue": 1,
    "Wed": 2,
    "Thu": 3,
    "Fri": 4,
    "Sat": 5,
    "Sun": 6,
}

MONTH_INDEX = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; NUCC-Scraper/1.0)",
}


@dataclass
class EventRecord:
    title: str
    host: Optional[str]
    date_line: str
    section: str
    link: Optional[str] = None
    image_url: Optional[str] = None
    event_id: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    time_text: Optional[str] = None
    time_24: Optional[str] = None
    filename_base: Optional[str] = None
    image_path: Optional[Path] = None
    raw_date_info: Optional[dict] = field(default=None, repr=False)


class EventHTMLParser(HTMLParser):
    """Collect event anchors, titles and image URLs."""

    def __init__(self) -> None:
        super().__init__()
        self.current: Optional[dict] = None
        self.events: dict[str, dict] = {}
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        attr = dict(attrs)
        if tag in {"script", "style"}:
            self._skip_depth += 1
        if self._skip_depth:
            return
        if tag == "a":
            href = attr.get("href", "")
            match = re.search(r"/events/([^/?#]+)", href)
            if match:
                event_id = match.group(1)
                if event_id.lower() == "create":
                    return
                self.current = {
                    "id": event_id,
                    "href": f"https://www.facebook.com/events/{event_id}/",
                    "texts": [],
                    "image": None,
                }
        if self.current and tag == "div":
            style = attr.get("style")
            if style and "background-image" in style:
                image_url = extract_bg_url(style)
                if image_url:
                    self.current["image"] = image_url

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._skip_depth:
            self._skip_depth -= 1
        if self._skip_depth:
            return
        if tag == "a" and self.current:
            info = self.events.setdefault(
                self.current["id"],
                {
                    "id": self.current["id"],
                    "href": self.current["href"],
                    "title": None,
                    "image": None,
                },
            )
            text = " ".join("".join(self.current["texts"]).split())
            if text:
                info["title"] = text
            if self.current.get("image"):
                info["image"] = self.current["image"]
            self.current = None

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self.current is not None:
            self.current.setdefault("texts", []).append(data)

    def get_events(self) -> list[dict]:
        return [event for event in self.events.values() if event.get("title")]


def extract_bg_url(style: str | None) -> Optional[str]:
    if not style:
        return None
    match = re.search(r"url\((.+?)\)", style)
    if not match:
        return None
    url = match.group(1).strip("\"' )")
    return html.unescape(url)


def normalize_text(text: str) -> str:
    cleaned = html.unescape(text)
    cleaned = cleaned.replace("\u202f", " ").replace("\xa0", " ")
    return cleaned.strip()


def extract_text_lines(raw_html: str) -> list[str]:
    cleaned = re.sub(r"<script[\s\S]*?</script>", "", raw_html, flags=re.IGNORECASE)
    cleaned = re.sub(r"<style[\s\S]*?</style>", "", cleaned, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "\n", cleaned)
    text = html.unescape(text)
    text = text.replace("\u202f", " ").replace("\xa0", " ")
    lines = [line.strip() for line in text.splitlines()]
    return [line for line in lines if line]


def is_date_line(line: str) -> bool:
    return bool(re.match(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),", line))


def parse_section(
    lines: list[str],
    start_index: int,
    stop_tokens: set[str],
    section_name: str,
) -> list[EventRecord]:
    events: list[EventRecord] = []
    i = start_index
    while i < len(lines):
        if lines[i] in stop_tokens:
            break
        if not is_date_line(lines[i]):
            i += 1
            continue
        date_line = lines[i]
        i += 1
        while i < len(lines) and lines[i] in {"", "&nbsp;"}:
            i += 1
        if i >= len(lines):
            break
        title = lines[i]
        i += 1
        while i < len(lines) and lines[i] != "Created by":
            if is_date_line(lines[i]) or lines[i] in stop_tokens:
                break
            i += 1
        if i >= len(lines) or lines[i] != "Created by":
            continue
        i += 1
        host: Optional[str] = None
        while i < len(lines):
            candidate = lines[i]
            i += 1
            if candidate and candidate not in {"Going", "Maybe", "Can't Go", "Invite"}:
                host = candidate
                break
        events.append(EventRecord(title=title, host=host, date_line=date_line, section=section_name))
    return events


def normalize_title(title: str) -> str:
    return " ".join(title.split()).lower()


def parse_date_details(date_line: str) -> Optional[dict]:
    normalized = date_line.replace("\u202f", " ").replace("–", "-")
    match = re.match(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(.+)$", normalized)
    if not match:
        return None
    day_name, remainder = match.groups()
    time_text = None
    if " at " in remainder:
        remainder, time_text = remainder.split(" at ", 1)
        time_text = time_text.strip()
    remainder = remainder.strip()
    end_part = None
    for sep in [" - ", " -", "- ", " to "]:
        if sep in remainder:
            start_part, end_part = remainder.split(sep, 1)
            remainder = start_part.strip()
            end_part = end_part.strip()
            break
    start_month, start_day = split_month_day(remainder)
    end_month = None
    end_day = None
    if end_part:
        try:
            end_month, end_day = split_month_day(end_part)
        except ValueError:
            end_month = start_month
            end_day = parse_day_number(end_part)
    return {
        "day_name": day_name,
        "start_month": start_month,
        "start_day": start_day,
        "end_month": end_month,
        "end_day": end_day,
        "time_text": time_text,
    }


def split_month_day(text: str) -> tuple[str, int]:
    parts = text.split()
    if len(parts) < 2:
        raise ValueError(f"Cannot parse month/day from {text!r}")
    month = parts[0][:3].title()
    day = parse_day_number(" ".join(parts[1:]))
    return month, day


def parse_day_number(text: str) -> int:
    digits = re.sub(r"[^0-9]", "", text)
    if not digits:
        raise ValueError(f"No day number in {text!r}")
    return int(digits)


def infer_year(details: list[dict]) -> int:
    if not details:
        return datetime.now().year
    candidates: list[int] = []
    for year in range(2015, 2036):
        ok = True
        for info in details:
            month = MONTH_INDEX.get(info["start_month"])
            if not month:
                continue
            try:
                if date(year, month, info["start_day"]).weekday() != DAY_INDEX[info["day_name"]]:
                    ok = False
                    break
            except ValueError:
                ok = False
                break
        if ok:
            candidates.append(year)
    if not candidates:
        return datetime.now().year
    current_year = datetime.now().year
    return min(candidates, key=lambda y: abs(y - current_year))


def apply_date_info(event: EventRecord, info: dict, year: int) -> None:
    month = MONTH_INDEX.get(info["start_month"])
    if not month:
        return
    try:
        start = date(year, month, info["start_day"])
    except ValueError:
        return
    event.start_date = start
    event.end_date = start
    end_month_name = info.get("end_month")
    end_day = info.get("end_day")
    if end_day:
        end_month = MONTH_INDEX.get((end_month_name or info["start_month"]))
        end_year = year
        if end_month is None:
            end_month = month
        if end_month < month:
            end_year += 1
        try:
            event.end_date = date(end_year, end_month, end_day)
        except ValueError:
            event.end_date = start
    event.time_text = info.get("time_text")
    event.time_24 = parse_time_text(event.time_text) if event.time_text else None


def parse_time_text(time_text: Optional[str]) -> Optional[str]:
    if not time_text:
        return None
    match = re.match(r"(\d{1,2})(?::(\d{2}))?\s*(AM|PM)", time_text, re.IGNORECASE)
    if not match:
        return None
    hour = int(match.group(1)) % 12
    minute = int(match.group(2) or 0)
    meridiem = match.group(3).upper()
    if meridiem == "PM":
        hour += 12
    return f"{hour:02d}:{minute:02d}"


def slugify(text: str) -> str:
    text_norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text_norm = re.sub(r"[^0-9A-Za-z]+", "_", text_norm)
    return text_norm.strip("_") or "untitled"


def image_filename_from_url(url: str, fallback: str) -> str:
    parsed = urlparse(url)
    name = Path(parsed.path).name
    if not name:
        return f"{fallback}.jpg"
    return unquote(name)


def download_image(url: str, destination: Path) -> bool:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        request = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(request, timeout=30) as response, open(destination, "wb") as fh:
            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                fh.write(chunk)
        return True
    except urllib.error.URLError as exc:
        print(f"⚠️  Failed to download image {url}: {exc}")
        return False


def build_when_text(event: EventRecord) -> str:
    if not event.start_date:
        return event.date_line
    start_text = event.start_date.strftime("%A %d %B %Y")
    if event.end_date and event.end_date != event.start_date:
        end_text = event.end_date.strftime("%A %d %B %Y")
        when = f"{start_text} – {end_text}"
    else:
        when = start_text
    if event.time_text:
        when = f"{when} at {event.time_text}"
    return when


def escape_yaml(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def write_markdown(event: EventRecord) -> None:
    if not event.filename_base:
        return
    output_path = SCRAPED_DIR / f"{event.filename_base}.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = ["---"]
    lines.append(f"title: \"{escape_yaml(event.title)}\"")
    if event.start_date:
        lines.append(f"date: {event.start_date.isoformat()}")
    if event.end_date and event.end_date != event.start_date:
        lines.append(f"end: {event.end_date.isoformat()}")
    if event.time_24:
        lines.append(f"time: \"{event.time_24}\"")
    if event.host:
        lines.append(f"author: \"{escape_yaml(event.host)}\"")
    image_reference = None
    if event.image_path and event.image_path.exists():
        image_reference = event.image_path.relative_to(SCRAPED_DIR).as_posix()
    elif event.image_url:
        image_reference = event.image_url
    if image_reference:
        lines.append(f"image: \"{escape_yaml(image_reference)}\"")
    if event.link:
        lines.append(f"link: \"{escape_yaml(event.link)}\"")
    lines.append(f"section: \"{escape_yaml(event.section)}\"")
    lines.append("---\n")
    body_lines = [f"**When:** {build_when_text(event)}"]
    if event.host:
        body_lines.append(f"**Hosted by:** {event.host}")
    if event.link:
        body_lines.append(f"**Facebook event:** [{event.link}]({event.link})")
    body_lines.append("")
    body_lines.append("_Scraped automatically from the NUCC Facebook events page._")
    body_lines.append("")
    body_lines.append(f"Original date text: `{event.date_line}`")
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines + body_lines) + "\n")


def prepare_output_dir() -> None:
    if SCRAPED_DIR.exists():
        shutil.rmtree(SCRAPED_DIR)
    SCRAPED_DIR.mkdir(parents=True, exist_ok=True)


def parse_events_from_html(html_text: str) -> list[EventRecord]:
    lines = [normalize_text(line) for line in extract_text_lines(html_text)]
    lines = [line for line in lines if line]
    events: list[EventRecord] = []
    try:
        upcoming_index = lines.index("Upcoming events")
    except ValueError:
        upcoming_index = -1
    if upcoming_index != -1:
        events.extend(parse_section(lines, upcoming_index + 1, {"See more", "Past events"}, "upcoming"))
    try:
        past_index = lines.index("Past events")
    except ValueError:
        past_index = -1
    if past_index != -1:
        events.extend(parse_section(lines, past_index + 1, {"See more"}, "past"))
    return events


def enrich_events(events: list[EventRecord], anchor_events: Iterable[dict]) -> None:
    mapping = {normalize_title(item["title"]): item for item in anchor_events}
    for event in events:
        anchor = mapping.get(normalize_title(event.title))
        if not anchor:
            print(f"⚠️  No anchor data found for {event.title}")
            continue
        event.link = anchor.get("href")
        event.image_url = anchor.get("image")
        event.event_id = anchor.get("id")


def assign_dates(events: list[EventRecord]) -> None:
    details = []
    for event in events:
        info = parse_date_details(event.date_line)
        if info:
            event.raw_date_info = info
            details.append(info)
        else:
            print(f"⚠️  Unable to parse date for {event.title}: {event.date_line}")
    year = infer_year(details)
    for event in events:
        if event.raw_date_info:
            apply_date_info(event, event.raw_date_info, year)


def assign_filenames_and_images(events: list[EventRecord]) -> None:
    for event in events:
        prefix = "000000"
        if event.start_date:
            prefix = event.start_date.strftime("%y%m%d")
        slug = slugify(event.title)
        event.filename_base = f"{prefix}_{slug}"
        if event.image_url:
            filename = image_filename_from_url(event.image_url, slug)
            event.image_path = IMAGES_DIR / event.filename_base / filename


def generate_outputs(events: list[EventRecord]) -> None:
    for event in events:
        if event.image_url and event.image_path:
            if download_image(event.image_url, event.image_path):
                print(f"⬇️  Saved image for {event.title} -> {event.image_path.relative_to(SCRAPED_DIR)}")
        write_markdown(event)
        if event.filename_base:
            print(f"📝 Wrote {event.filename_base}.md")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Scrape a saved Facebook events HTML file into Markdown")
    parser.add_argument("html", type=Path, help="Path to the saved HTML file")
    args = parser.parse_args(argv)

    html_path: Path = args.html
    if not html_path.is_file():
        print(f"❌ File not found: {html_path}")
        return 1

    html_text = html_path.read_text(encoding="utf-8")
    events = parse_events_from_html(html_text)
    if not events:
        print("❌ No events found in the supplied HTML file.")
        return 1

    parser = EventHTMLParser()
    parser.feed(html_text)
    anchor_events = parser.get_events()
    enrich_events(events, anchor_events)
    assign_dates(events)
    assign_filenames_and_images(events)
    prepare_output_dir()
    generate_outputs(events)
    print(f"\n🎉 Generated {len(events)} markdown file(s) in {SCRAPED_DIR.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
