#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Scan uncommitted changes + new files in demo-data/ and docs/screenshots/
for red-flag patterns that shouldn't land in the public repo.

Categories scanned:
- Generic PII shapes: SSN, US phone, credit card, bank routing number, IBAN-ish.
- Dollar amounts >= $10,000 (demo fixtures use round/small numbers).
- 4-digit strings next to words like "account", "card", "ending in", "xxxx".
- User-specific patterns from an optional gitignored wordlist at
  .claude/skills/update-showcase/personal-patterns.txt (one per line —
  names, account tails, email addresses, etc). Missing file → warn-skip.

Exit 0 = clean; exit 1 = hits found (prints locations).

Intentionally conservative: flags for human review rather than auto-blocks
— a false positive is cheap, a missed real positive lands in a public repo.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
PATTERNS_FILE = SKILL_DIR / "personal-patterns.txt"

# Scan these text-bearing paths that are NOT gitignored (so they'd be committed).
# Screenshots are binary — we check filenames/paths only, not pixels.
SCAN_TEXT_GLOBS = [
    "demo-data/**/*.json",
    "demo-data/**/*.md",
    "README.md",
    "src/**/*.ts",
    "src/**/*.tsx",
    "server/**/*.ts",
]

GENERIC_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("SSN",              re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("US phone",         re.compile(r"\b(?:\+?1[-\s.])?\(?\d{3}\)?[-\s.]\d{3}[-\s.]\d{4}\b")),
    # Credit card: require 4-4-4-4 formatting so we don't flag every long
    # integer in a JSON blob. A pasted bare card number won't have dashes
    # typically, but the tradeoff for signal/noise is worth it.
    ("credit card",      re.compile(r"\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b")),
    ("routing number",   re.compile(r"\brouting\s*(?:#|number)?[:\s]*\d{9}\b", re.I)),
    ("account tail",     re.compile(r"\b(?:ending|acct|account|card)\s*(?:in\s*)?\**\s*\d{4}\b", re.I)),
    ("large $ amount",   re.compile(r"\$\s?\d{2,3}(?:,\d{3}){2,}(?:\.\d+)?")),  # >= $100,000
    ("plausible email",  re.compile(r"[a-z0-9._%+-]+@(?!example\.|demo\.|test\.)[a-z0-9.-]+\.[a-z]{2,}", re.I)),
]

# Demo-mode literals that are allowed to appear (suppress false positives).
ALLOWLIST = {
    "demo@", "admin@", "noreply@", "@anthropic.com",
}

# Skip files larger than this — they're almost certainly generated caches
# (market data, minified bundles, etc.) and will produce mostly noise.
MAX_SCAN_BYTES = 500_000


def load_personal_patterns() -> list[re.Pattern[str]]:
    if not PATTERNS_FILE.exists():
        return []
    patterns: list[re.Pattern[str]] = []
    for line in PATTERNS_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Treat each line as a literal to escape, case-insensitive.
        patterns.append(re.compile(re.escape(line), re.I))
    return patterns


def find_repo_root(start: Path) -> Path:
    for p in (start, *start.parents):
        if (p / "package.json").is_file() and (p / ".git").exists():
            return p
    raise SystemExit("could not locate repo root")


def uncommitted_and_new_files(repo_root: Path) -> list[Path]:
    """git-aware list of files that would land in the next commit."""
    files: set[Path] = set()
    # Untracked (honors .gitignore)
    out = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        cwd=repo_root, check=True, capture_output=True, text=True,
    ).stdout
    for line in out.splitlines():
        files.add(repo_root / line)
    # Tracked + modified
    out = subprocess.run(
        ["git", "diff", "--name-only", "HEAD"],
        cwd=repo_root, check=True, capture_output=True, text=True,
    ).stdout
    for line in out.splitlines():
        files.add(repo_root / line)
    return sorted(f for f in files if f.is_file())


def scan_file(path: Path, generic: list[tuple[str, re.Pattern[str]]],
              personal: list[re.Pattern[str]]) -> list[tuple[int, str, str]]:
    if path.suffix in {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".woff", ".woff2"}:
        return []
    try:
        if path.stat().st_size > MAX_SCAN_BYTES:
            return []
        text = path.read_text(errors="replace")
    except OSError:
        return []
    hits: list[tuple[int, str, str]] = []
    for line_no, line in enumerate(text.splitlines(), 1):
        if any(a in line for a in ALLOWLIST):
            continue
        for label, pat in generic:
            m = pat.search(line)
            if m:
                hits.append((line_no, label, m.group(0)[:80]))
        for pat in personal:
            m = pat.search(line)
            if m:
                hits.append((line_no, "personal-patterns", m.group(0)[:80]))
    return hits


def main() -> None:
    repo_root = find_repo_root(Path(__file__).resolve())
    personal_patterns = load_personal_patterns()
    files = uncommitted_and_new_files(repo_root)

    if not PATTERNS_FILE.exists():
        print(
            f"[check] {PATTERNS_FILE.relative_to(repo_root)} missing — skipping user-specific pattern scan.\n"
            "[check] Create it with one literal per line (names, account tails, real emails) to enable.",
            file=sys.stderr,
        )

    total_hits = 0
    for f in files:
        hits = scan_file(f, GENERIC_PATTERNS, personal_patterns)
        if hits:
            rel = f.relative_to(repo_root)
            total_hits += len(hits)
            print(f"\n{rel}")
            for line_no, label, excerpt in hits:
                print(f"  L{line_no}  [{label}]  {excerpt!r}")

    if total_hits:
        print(f"\n[check] {total_hits} potential personal-data match(es) found. "
              "Review each manually before committing.", file=sys.stderr)
        sys.exit(1)
    print(f"[check] scanned {len(files)} file(s), no red flags.")


if __name__ == "__main__":
    main()
