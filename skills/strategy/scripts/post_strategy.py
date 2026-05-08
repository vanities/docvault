#!/usr/bin/env python3
"""Post a strategy entry to the DocVault API.

Usage:
    uv run post_strategy.py --title "..." --body "..." --signals '{"key":"val"}' [--base-url URL]

The --signals argument accepts a JSON string. The --body can be multiline
(pass via heredoc or file). --portfolio is optional JSON.
"""

import argparse
import json
import sys
import urllib.request
import urllib.error


def main():
    parser = argparse.ArgumentParser(description="Post a strategy to DocVault")
    parser.add_argument("--title", required=True, help="Strategy headline")
    parser.add_argument("--body", required=True, help="Full markdown analysis")
    parser.add_argument("--signals", default="{}", help="JSON string of signal values")
    parser.add_argument("--portfolio", default=None, help="Optional JSON portfolio context")
    parser.add_argument("--author", default="Claude Code", help="Author name")
    parser.add_argument("--base-url", default="http://localhost:3005", help="API base URL")
    args = parser.parse_args()

    payload = {
        "title": args.title,
        "body": args.body,
        "signals": json.loads(args.signals),
        "author": args.author,
    }
    if args.portfolio:
        payload["portfolio"] = json.loads(args.portfolio)

    data = json.dumps(payload).encode("utf-8")
    url = f"{args.base_url.rstrip('/')}/api/strategy"
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            entry = result.get("entry", {})
            print(f"Saved: {entry.get('title')}")
            print(f"ID: {entry.get('id')}")
            print(f"Date: {entry.get('createdAt')}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"ERROR {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
