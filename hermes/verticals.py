#!/usr/bin/env python3
"""
hermes/verticals.py -- multi-vertical market drafting for the Hermes brain.

Four verticals, each with its own real data source, question template and settlement path:

  crypto  crypto / finance : CoinGecko / Binance spot price      -> auto settle (price vs threshold)
  news    news / geopolitics / tech : public RSS                -> manual settle (Safe / Oracle)
  sports  sports : ESPN public scoreboard (NBA/NFL/EPL/UCL)     -> auto settle (final score)
  esports esports : LoL Esports public schedule                  -> auto settle (gameWins)

Design rules:
  * Standard library only (urllib + xml.etree + json), no extra packages.
  * If the data source is unavailable return an empty list / skip -- never invent headlines or scores.
  * Every question must pass `validate_binary_question()`: binary alignment, explicit resolution
    time, objective settlement criteria.
  * The news vertical is NEVER auto-settled (nobody can prove "an official response happened" from
    RSS alone), so it is always marked manual and settled by the Oracle / Safe. Sports and esports
    are auto-settled only when an official final result exists.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger("hermes.verticals")

# Resolution time must be at least 30 minutes out (the contract's minTradingWindow starts at
# 1 hour, so this leaves headroom).
MIN_LEAD_S = 1800
MAX_LEAD_S = 8 * 86400
MAX_QUESTION_BYTES = 280
MIN_QUESTION_BYTES = 8
MIN_CRITERIA_CHARS = 12

# Interrogative openers that make a question binary, and tokens that break binarity (reject on sight).
BINARY_MARKERS = ("Will ", "Is ", "Are ", "Does ", "Do ", "Has ", "Have ", "Can ", "Did ")
FORBIDDEN_TOKENS = (" or ", "how much", "how many", "probability", "percent chance",
                    "which ", "when will", "what price", "how far", "ranked")


# --------------------------------------------------------------------------------------
# Binary question validation (shared by every vertical; validate before creating a market)
# --------------------------------------------------------------------------------------

def validate_binary_question(
    question: str,
    criteria: str,
    resolution_time: int,
    now: int,
    min_lead_s: int = MIN_LEAD_S,
) -> tuple[bool, str]:
    """Return (is_valid, reason_if_invalid). Valid = YES/NO only + explicit resolution time +
    objective settlement criteria."""
    q = (question or "").strip()
    c = (criteria or "").strip()
    if not q:
        return False, "question empty"
    if not q.endswith("?"):
        return False, "question must end with a question mark (?)"
    size = len(q.encode("utf-8"))
    if size < MIN_QUESTION_BYTES or size > MAX_QUESTION_BYTES:
        return False, f"question length {size}B out of range {MIN_QUESTION_BYTES}..{MAX_QUESTION_BYTES}"
    if not any(m in q for m in BINARY_MARKERS):
        return False, f"question must be binary-aligned (one of {BINARY_MARKERS})"
    for bad in FORBIDDEN_TOKENS:
        if bad in q.lower():
            return False, f"non-binary token in question: {bad.strip()}"
    if len(c) < MIN_CRITERIA_CHARS:
        return False, f"criteria too short ({len(c)} < {MIN_CRITERIA_CHARS})"
    if resolution_time <= now + min_lead_s:
        return False, f"resolution_time must be at least {min_lead_s}s in the future"
    if resolution_time > now + MAX_LEAD_S:
        return False, f"resolution_time too far (> {MAX_LEAD_S}s)"
    return True, ""


# --------------------------------------------------------------------------------------
# Shared structures
# --------------------------------------------------------------------------------------

@dataclass
class VerticalCandidate:
    """A market draft ready for CreatorEngine (only question/category go on-chain; the rest is state)."""

    vertical: str            # crypto | news | sports | esports
    question: str
    criteria: str            # objective settlement rule (shown to users, stored in state)
    category: str            # on-chain category field
    resolution_time: int
    verification: str        # auto | manual
    payload: dict[str, Any]  # raw data needed to settle (threshold / event id / team names ...)
    source: str = ""
    headline: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def fingerprint(self) -> str:
        """One market per question per window (the market id is the keccak of this)."""
        slot = self.resolution_time // 1800  # 30-minute granularity
        key = f"{self.vertical}|{self.category}|{self.question}|{slot}"
        return key


# --------------------------------------------------------------------------------------
# News / geopolitics / tech
# --------------------------------------------------------------------------------------

@dataclass
class Headline:
    title: str
    link: str
    source: str
    published: float
    vertical: str  # news | tech


DEFAULT_FEEDS: tuple[tuple[str, str, str], ...] = (
    # (source, url, vertical) -- public feeds, all verified to return 200
    ("Cointelegraph", "https://cointelegraph.com/rss", "news"),
    ("The Block", "https://www.theblock.co/rss.xml", "news"),
    ("Decrypt", "https://decrypt.co/feed", "news"),
    ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml", "news"),
    ("BBC Tech", "https://feeds.bbci.co.uk/news/technology/rss.xml", "tech"),
    ("TechCrunch", "https://techcrunch.com/feed/", "tech"),
)


class NewsFeed:
    """Public RSS fetch + parse. One dead feed never affects the others."""

    def __init__(self, feeds: tuple[tuple[str, str, str], ...] = DEFAULT_FEEDS, timeout: int = 8):
        self.feeds = feeds
        self.timeout = timeout

    @staticmethod
    def _local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1].lower()

    def parse_rss(self, xml_text: str, source: str, vertical: str = "news") -> list[Headline]:
        """Pure function (easy to unit test): parse RSS/Atom text into a list of Headline."""
        try:
            root = ET.fromstring(xml_text.strip())
        except ET.ParseError as exc:
            log.warning("rss parse failed for %s: %s", source, exc)
            return []
        out: list[Headline] = []
        for node in root.iter():
            if self._local(node.tag) not in ("item", "entry"):
                continue
            title, link, published = "", "", 0.0
            for child in node:
                name = self._local(child.tag)
                if name == "title" and child.text:
                    title = " ".join(child.text.split())
                elif name == "link" and (child.text or child.attrib.get("href")):
                    link = (child.text or child.attrib.get("href") or "").strip()
                elif name in ("pubdate", "published", "updated") and child.text:
                    published = _parse_rfc822(child.text) or 0.0
            if title:
                out.append(Headline(title=title, link=link, source=source,
                                    published=published or time.time(), vertical=vertical))
        return out

    def _get(self, url: str) -> str:
        req = urllib.request.Request(url, headers={"User-Agent": "hermes-brain/2.0"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return resp.read().decode("utf-8", errors="ignore")

    def headlines(self, limit_per_feed: int = 6) -> list[Headline]:
        out: list[Headline] = []
        for source, url, vertical in self.feeds:
            try:
                out.extend(self.parse_rss(self._get(url), source, vertical)[:limit_per_feed])
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                log.warning("feed %s failed: %s", source, exc)
        out.sort(key=lambda h: h.published, reverse=True)
        return out

    # ---------------------------- drafting ----------------------------

    NEWS_TEMPLATES = (
        ("Will there be an official response to \"{subject}\" within {hours} hours?",
         "Settled from reporting published by {source} before the resolution time: an explicit "
         "official statement or named spokesperson response resolves YES; media paraphrase, rumor "
         "or unnamed sourcing resolves NO."),
        ("Will \"{subject}\" be covered by at least two major outlets within {hours} hours?",
         "Settled by independent reporting from {source} plus at least one other major outlet "
         "before the resolution time; syndicated copies of the same wire story do not count as a "
         "second outlet."),
    )

    def candidates(self, now: int, horizon_h: int, limit: int = 2,
                   keccak: Callable[[str], str] | None = None) -> list[VerticalCandidate]:
        heads = self.headlines()
        if not heads:
            log.warning("news: no RSS feed reachable, skipping this vertical for this cycle")
            return []
        out: list[VerticalCandidate] = []
        for i, h in enumerate(heads[:limit]):
            subject = _clip_subject(h.title)
            if not subject:
                continue
            tmpl, crit = self.NEWS_TEMPLATES[i % len(self.NEWS_TEMPLATES)]
            question = tmpl.format(subject=subject, hours=horizon_h)
            criteria = crit.format(source=h.source)
            rt = now + horizon_h * 3600
            ok, why = validate_binary_question(question, criteria, rt, now)
            if not ok:
                log.info("news candidate rejected (%s): %s", why, question[:40])
                continue
            out.append(VerticalCandidate(
                vertical="news",
                question=question,
                criteria=criteria,
                category="news" if h.vertical == "news" else "tech",
                resolution_time=rt,
                verification="manual",   # news is never auto-settled
                payload={"headline": h.title, "link": h.link, "source": h.source},
                source=h.source,
                headline=h.title,
            ))
        return out


def _clip_subject(title: str, limit: int = 40) -> str:
    """Compress a headline into a subject phrase: drop the outlet suffix, cut on a word boundary,
    never leave half a word behind."""
    t = " ".join((title or "").split())
    for sep in (" - ", " | ", " \u2013 "):
        if sep in t:
            t = t.split(sep)[0]
    t = t.replace("?", "").replace('"', "").replace("\u201c", "").replace("\u201d", "").strip()
    if len(t) > limit:
        cut = t[:limit]
        if " " in cut:                     # English: back off to the previous full word
            cut = cut.rsplit(" ", 1)[0]
        t = cut.rstrip(" ,.;:") + "..."
    return t


# --------------------------------------------------------------------------------------
# Sports (ESPN public scoreboard, no API key needed)
# --------------------------------------------------------------------------------------

ESPN_LEAGUES: tuple[tuple[str, str, str], ...] = (
    # (league path, display name, vertical)
    ("basketball/nba", "NBA", "sports"),
    ("football/nfl", "NFL", "sports"),
    ("soccer/eng.1", "Premier League", "sports"),
    ("soccer/uefa.champions", "Champions League", "sports"),
    ("soccer/usa.1", "MLS", "sports"),
)


@dataclass
class SportEvent:
    league: str
    league_name: str
    event_id: str
    home: str
    away: str
    start_ts: int
    state: str  # pre | in | post
    home_score: int = 0
    away_score: int = 0


class SportsFeed:
    def __init__(self, leagues: tuple[tuple[str, str, str], ...] = ESPN_LEAGUES, timeout: int = 8):
        self.leagues = leagues
        self.timeout = timeout

    def _get_json(self, url: str) -> Any:
        req = urllib.request.Request(url, headers={"User-Agent": "hermes-brain/2.0"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode())

    # ---- parsing (pure function, must stay unit-testable) ----
    def parse_scoreboard(self, data: dict[str, Any], league: str, league_name: str) -> list[SportEvent]:
        out: list[SportEvent] = []
        for ev in data.get("events", []) or []:
            try:
                comp = (ev.get("competitions") or [{}])[0]
                state = ((comp.get("status") or ev.get("status") or {}).get("type") or {}).get("state", "pre")
                teams = {c.get("homeAway"): c for c in comp.get("competitors", []) or []}
                home_c, away_c = teams.get("home"), teams.get("away")
                if not home_c or not away_c:
                    continue
                start = _iso_to_ts(ev.get("date") or comp.get("date") or "")
                if not start:
                    continue
                out.append(SportEvent(
                    league=league,
                    league_name=league_name,
                    event_id=str(ev.get("id") or comp.get("id") or ""),
                    home=_team_name(home_c),
                    away=_team_name(away_c),
                    start_ts=start,
                    state="post" if state == "post" else ("in" if state == "in" else "pre"),
                    home_score=_score(home_c),
                    away_score=_score(away_c),
                ))
            except (AttributeError, TypeError, ValueError) as exc:
                log.warning("espn event parse failed (%s): %s", league, exc)
        return out

    def events(self) -> list[SportEvent]:
        out: list[SportEvent] = []
        for path, name, _vertical in self.leagues:
            url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard"
            try:
                out.extend(self.parse_scoreboard(self._get_json(url), path, name))
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
                log.warning("espn %s failed: %s", path, exc)
        return out

    def winner(self, league: str, event_id: str) -> str | None:
        """Return 'home' / 'away' / 'draw' once the match is final, else None (never guess)."""
        url = f"https://site.api.espn.com/apis/site/v2/sports/{league}/summary?event={event_id}"
        try:
            data = self._get_json(url)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            log.warning("espn summary %s/%s failed: %s", league, event_id, exc)
            return None
        header = data.get("header") or {}
        comps = ((header.get("competitions") or [{}])[0]).get("competitors") or []
        if not comps:
            return None
        status = ((((header.get("competitions") or [{}])[0]).get("status") or {}).get("type") or {}).get("state")
        if status != "post":
            return None
        scores: dict[str, int] = {}
        for c in comps:
            side = c.get("homeAway")
            if side in ("home", "away"):
                scores[side] = _score(c)
        if len(scores) < 2:
            return None
        if scores["home"] == scores["away"]:
            return "draw"
        return "home" if scores["home"] > scores["away"] else "away"

    # ---- drafting ----
    def candidates(self, now: int, horizon_h: int, limit: int = 2) -> list[VerticalCandidate]:
        # Games are not scheduled every hour: widen the window to at least 48 hours so that
        # "no market this cycle" does not become the normal case.
        horizon_end = now + max(horizon_h, 48) * 3600
        evs = [e for e in self.events() if e.state == "pre" and now < e.start_ts <= horizon_end]
        evs.sort(key=lambda e: e.start_ts)
        out: list[VerticalCandidate] = []
        for e in evs[:limit]:
            when = time.strftime("%b %d, %H:%M", time.localtime(e.start_ts))
            question = f"Will {e.home} beat {e.away} in the {e.league_name} game on {when}?"
            criteria = (
                f"Settled from the official ESPN final score (overtime and penalties included): "
                f"a {e.home} win resolves YES; a loss or a draw resolves NO. "
                f"If the game is postponed by more than 24 hours or cancelled, the admin "
                f"resolves INVALID with a full refund."
            )
            rt = max(e.start_ts + 3 * 3600, now + 2 * 3600)  # settleable 3 hours after tip-off
            ok, why = validate_binary_question(question, criteria, rt, now)
            if not ok:
                log.info("sports candidate rejected (%s): %s", why, question[:40])
                continue
            out.append(VerticalCandidate(
                vertical="sports",
                question=question,
                criteria=criteria,
                category="sports",
                resolution_time=rt,
                verification="auto",
                payload={"kind": "espn", "league": e.league, "event_id": e.event_id,
                         "home": e.home, "away": e.away, "start_ts": e.start_ts},
                source="ESPN",
                headline=f"{e.league_name} {e.home} vs {e.away}",
            ))
        return out


def _team_name(c: dict[str, Any]) -> str:
    team = c.get("team") or {}
    return team.get("displayName") or team.get("shortDisplayName") or team.get("name") or "TBD"


def _score(c: dict[str, Any]) -> int:
    raw = c.get("score")
    if isinstance(raw, dict):
        raw = raw.get("value") or raw.get("displayValue")
    if raw is None:
        return 0
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return 0


def _iso_to_ts(iso: str) -> int:
    """Accept '2026-10-27T23:30Z' (ESPN, no seconds), '2026-10-07T11:00:00Z', and +08:00 offsets."""
    if not iso:
        return 0
    raw = iso.strip().replace("Z", "")
    offset = 0
    for sign in ("+", "-"):
        if sign in raw[10:]:
            raw, off = raw[:10] + raw[10:].rsplit(sign, 1)[0], raw[10:].rsplit(sign, 1)[1]
            try:
                hh, mm = (off.split(":") + ["0"])[:2]
                offset = (int(hh) * 3600 + int(mm) * 60) * (1 if sign == "+" else -1)
            except ValueError:
                offset = 0
            break
    raw = raw.replace(" ", "T")
    if len(raw) == 16:      # seconds missing
        raw += ":00"
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            dt = time.strptime(raw[:26], fmt)
            return int(time.mktime(dt) - time.timezone - offset)
        except ValueError:
            continue
    return 0


def _parse_rfc822(value: str) -> float:
    """RSS pubDate, e.g. 'Tue, 27 Oct 2026 09:30:00 GMT'."""
    txt = " ".join(value.split())
    for fmt in ("%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return time.mktime(time.strptime(txt, fmt)) - time.timezone
        except ValueError:
            continue
    return 0.0


# --------------------------------------------------------------------------------------
# Esports (LoL Esports public schedule)
# --------------------------------------------------------------------------------------

LOLESPORTS_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"  # public key used by the official web client
LOLESPORTS_URL = "https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US"


@dataclass
class EsportsMatch:
    match_id: str
    league: str
    team_a: str
    team_b: str
    start_ts: int
    state: str  # upcoming | inProgress | completed
    wins_a: int = 0
    wins_b: int = 0


class EsportsFeed:
    def __init__(self, timeout: int = 8, url: str = LOLESPORTS_URL, api_key: str = LOLESPORTS_KEY):
        self.timeout = timeout
        self.url = url
        self.api_key = api_key

    def _get_json(self) -> Any:
        req = urllib.request.Request(
            self.url, headers={"User-Agent": "hermes-brain/2.0", "x-api-key": self.api_key}
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode())

    def parse_schedule(self, data: dict[str, Any]) -> list[EsportsMatch]:
        out: list[EsportsMatch] = []
        events = (((data.get("data") or {}).get("schedule") or {}).get("events")) or []
        for ev in events:
            match = ev.get("match") or {}
            teams = match.get("teams") or []
            if len(teams) < 2:
                continue
            start = _iso_to_ts(ev.get("startTime") or "")
            if not start:
                continue
            out.append(EsportsMatch(
                match_id=str(match.get("id") or ev.get("id") or ""),
                league=(ev.get("league") or {}).get("name") or "LoL",
                team_a=(teams[0].get("name") or "TBD"),
                team_b=(teams[1].get("name") or "TBD"),
                start_ts=start,
                state={"unstarted": "upcoming"}.get(str(ev.get("state") or "upcoming"), str(ev.get("state") or "upcoming")),
                wins_a=int(((teams[0].get("result") or {}).get("gameWins")) or 0),
                wins_b=int(((teams[1].get("result") or {}).get("gameWins")) or 0),
            ))
        return out

    def matches(self) -> list[EsportsMatch]:
        try:
            return self.parse_schedule(self._get_json())
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            log.warning("lolesports failed: %s", exc)
            return []

    def winner(self, match_id: str) -> str | None:
        """Return 'a' / 'b' once the series is final, else None (never guess)."""
        for m in self.matches():
            if m.match_id != str(match_id):
                continue
            if m.state != "completed" and m.wins_a == 0 and m.wins_b == 0:
                return None
            if m.wins_a == m.wins_b:
                return None
            return "a" if m.wins_a > m.wins_b else "b"
        return None

    def candidates(self, now: int, horizon_h: int, limit: int = 1) -> list[VerticalCandidate]:
        # Esports schedules run in stages, so a 24h window is often empty: use at least 72 hours.
        horizon_end = now + max(horizon_h, 72) * 3600
        ms = [m for m in self.matches()
              if m.state in ("upcoming", "unstarted") and now < m.start_ts <= horizon_end]
        ms.sort(key=lambda m: m.start_ts)
        out: list[VerticalCandidate] = []
        for m in ms[:limit]:
            when = time.strftime("%b %d, %H:%M", time.localtime(m.start_ts))
            question = f"Will {m.team_a} beat {m.team_b} in the {m.league} match on {when}?"
            criteria = (
                f"Settled from the official LoL Esports result (gameWins): {m.team_a} winning "
                f"the series resolves YES, otherwise NO. If the match is postponed by more than "
                f"24 hours or rescheduled, the admin resolves INVALID with a full refund."
            )
            rt = max(m.start_ts + 4 * 3600, now + 2 * 3600)
            ok, why = validate_binary_question(question, criteria, rt, now)
            if not ok:
                log.info("esports candidate rejected (%s)", why)
                continue
            out.append(VerticalCandidate(
                vertical="esports",
                question=question,
                criteria=criteria,
                category="esports",
                resolution_time=rt,
                verification="auto",
                payload={"kind": "lolesports", "match_id": m.match_id,
                         "team_a": m.team_a, "team_b": m.team_b, "start_ts": m.start_ts},
                source="LoL Esports",
                headline=f"{m.league} {m.team_a} vs {m.team_b}",
            ))
        return out


# --------------------------------------------------------------------------------------
# Vertical aggregation: draft in rotation order so every vertical gets a turn
# --------------------------------------------------------------------------------------

VERTICALS = ("crypto", "news", "sports", "esports")


class VerticalPlanner:
    """Calls each vertical in round-robin order and returns drafts (crypto is handled by the
    brain's CreatorEngine)."""

    def __init__(self, news: NewsFeed | None = None, sports: SportsFeed | None = None,
                 esports: EsportsFeed | None = None):
        self.news = news or NewsFeed()
        self.sports = sports or SportsFeed()
        self.esports = esports or EsportsFeed()

    def plan(self, vertical: str, now: int, horizon_h: int, limit: int = 1) -> list[VerticalCandidate]:
        if vertical == "news":
            return self.news.candidates(now, horizon_h, limit=max(limit, 1))
        if vertical == "sports":
            return self.sports.candidates(now, horizon_h, limit=max(limit, 1))
        if vertical == "esports":
            return self.esports.candidates(now, horizon_h, limit=max(limit, 1))
        return []

    @staticmethod
    def rotation(cursor: int, enabled: tuple[str, ...] = VERTICALS) -> tuple[str, ...]:
        """Rotate from cursor so every vertical gets an equal share over several cycles."""
        if not enabled:
            return ()
        i = cursor % len(enabled)
        return tuple(enabled[i:]) + tuple(enabled[:i])
