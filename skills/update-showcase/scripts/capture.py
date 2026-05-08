#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "playwright>=1.47",
# ]
# ///
"""Boot the DocVault demo stack, capture a deterministic screenshot per view
defined in views.json, write a reconciliation report, and shut everything
down cleanly. Invoked by the `update-showcase` skill."""

from __future__ import annotations

import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
VIEWS_JSON = SKILL_DIR / "views.json"
REPORT_PATH = SKILL_DIR / "capture-report.json"

BACKEND_PORT = 3006
FRONTEND_PORT = 5174
LOGIN_USER = "admin"
LOGIN_PASS = "demo"
# Stable dummy master key for the demo stack. demo-data contains no
# encrypted payloads, so the value only needs to be a valid 32-byte
# base64 string — don't reuse this anywhere real.
DEMO_MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="


def find_repo_root(start: Path) -> Path:
    for p in (start, *start.parents):
        if (p / "package.json").is_file() and (p / "server" / "index.ts").is_file():
            return p
    raise SystemExit("Could not locate DocVault repo root from skill path.")


REPO_ROOT = find_repo_root(SKILL_DIR)
DEMO_DATA = REPO_ROOT / "demo-data"
SCREENSHOTS = REPO_ROOT / "docs" / "screenshots"
README = REPO_ROOT / "README.md"


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def wait_for_port(port: int, timeout: float = 60.0) -> None:
    """Probe via 'localhost' so IPv4 + IPv6 loopback are both covered —
    Vite on macOS tends to bind only `::1`."""
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("localhost", port), timeout=1.0):
                return
        except (ConnectionError, OSError, socket.timeout):
            time.sleep(0.3)
    raise TimeoutError(f"port {port} not bound after {timeout}s")


def ensure_playwright_chromium() -> None:
    subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


@contextmanager
def spawn_servers():
    for port, label in ((BACKEND_PORT, "backend"), (FRONTEND_PORT, "frontend")):
        if port_in_use(port):
            raise SystemExit(
                f"Port {port} ({label}) already in use. Stop the existing process and retry."
            )

    env = {
        **os.environ,
        "DOCVAULT_DATA_DIR": str(DEMO_DATA),
        "DOCVAULT_PORT": str(BACKEND_PORT),
        "DOCVAULT_USERNAME": LOGIN_USER,
        "DOCVAULT_PASSWORD": LOGIN_PASS,
        "DOCVAULT_MASTER_KEY": os.environ.get("DOCVAULT_MASTER_KEY", DEMO_MASTER_KEY),
    }

    backend_log = SKILL_DIR / "backend.log"
    frontend_log = SKILL_DIR / "frontend.log"
    backend_fp = backend_log.open("wb")
    frontend_fp = frontend_log.open("wb")

    backend = subprocess.Popen(
        ["bun", "run", "server/index.ts"],
        cwd=REPO_ROOT,
        env=env,
        stdout=backend_fp,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    frontend = subprocess.Popen(
        ["vp", "dev", "--config", "vite.demo.config.ts", "--port", str(FRONTEND_PORT)],
        cwd=REPO_ROOT,
        env=env,
        stdout=frontend_fp,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

    def tail(log: Path, n: int = 40) -> str:
        try:
            lines = log.read_text(errors="replace").splitlines()
            return "\n".join(lines[-n:])
        except Exception:
            return "(log unavailable)"

    try:
        print(f"[capture] waiting for backend :{BACKEND_PORT} ...")
        try:
            wait_for_port(BACKEND_PORT)
        except TimeoutError:
            print(f"[capture] backend boot failed. Last 40 lines of {backend_log}:\n{tail(backend_log)}", file=sys.stderr)
            raise
        print(f"[capture] waiting for frontend :{FRONTEND_PORT} ...")
        try:
            wait_for_port(FRONTEND_PORT)
        except TimeoutError:
            print(f"[capture] frontend boot failed. Last 40 lines of {frontend_log}:\n{tail(frontend_log)}", file=sys.stderr)
            raise
        yield
    finally:
        for proc, label in ((frontend, "frontend"), (backend, "backend")):
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            else:
                try:
                    proc.wait(timeout=6)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                print(f"[capture] stopped {label}")
        backend_fp.close()
        frontend_fp.close()


def try_login(page) -> None:
    """If the login screen is showing, fill username + password and submit.
    Wait for the form to detach so we don't screenshot a half-transitioned state."""
    user_sel = 'input[autocomplete="username"]'
    pass_sel = 'input[autocomplete="current-password"]'
    try:
        user_field = page.locator(user_sel).first
        if not user_field.count():
            return
        if not user_field.is_visible(timeout=1500):
            return
        user_field.fill(LOGIN_USER)
        page.locator(pass_sel).first.fill(LOGIN_PASS)
        page.get_by_role("button", name="Sign In").click()
        page.locator(user_sel).first.wait_for(state="detached", timeout=10_000)
        page.wait_for_load_state("networkidle")
        print("[capture] logged in")
    except Exception as e:
        print(f"[capture] login step failed: {e}", file=sys.stderr)


def run_action(page, action: dict) -> None:
    t = action["type"]
    if t == "click_text":
        page.get_by_text(action["text"], exact=action.get("exact", False)).first.click()
    elif t == "click_role":
        page.get_by_role(action["role"], name=action["name"], exact=action.get("exact", True)).click()
    elif t == "click_selector":
        page.locator(action["selector"]).first.click()
    elif t == "set_local_storage":
        # Accept either a pre-stringified value or a JSON-able object/array
        # for readability when seeding nested structures (e.g. chat threads).
        v = action.get("value")
        if not isinstance(v, str):
            v = json.dumps(v)
        page.evaluate(
            "({k, v}) => window.localStorage.setItem(k, v)",
            {"k": action["key"], "v": v},
        )
    elif t == "wait_ms":
        page.wait_for_timeout(int(action["ms"]))
    elif t == "wait_for_selector":
        page.wait_for_selector(action["selector"], timeout=int(action.get("timeout_ms", 5000)))
    elif t == "goto_slug":
        page.goto(f"http://localhost:{FRONTEND_PORT}/#{action['slug']}", wait_until="networkidle")
    elif t == "reload":
        page.reload(wait_until="networkidle")
    else:
        raise ValueError(f"unknown pre_action type: {t}")


def capture() -> dict:
    from playwright.sync_api import sync_playwright

    cfg = json.loads(VIEWS_JSON.read_text())
    views = cfg["views"]
    defaults = cfg.get("defaults", {})
    session_setup = cfg.get("session_setup", [])
    viewport = defaults.get("viewport", {"width": 1440, "height": 900})
    dsf = defaults.get("device_scale_factor", 2)
    settle_ms = int(defaults.get("wait_ms_after_nav", 900))
    post_pre_ms = int(defaults.get("wait_ms_after_pre_actions", 400))

    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "captured": [],
        "errors": [],
        "viewport": viewport,
        "device_scale_factor": dsf,
    }

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=viewport, device_scale_factor=dsf)
        page = ctx.new_page()

        page.goto(f"http://localhost:{FRONTEND_PORT}/", wait_until="networkidle")
        try_login(page)

        for action in session_setup:
            try:
                run_action(page, action)
            except Exception as e:
                print(f"[capture] session_setup {action} failed: {e}", file=sys.stderr)
        page.wait_for_timeout(settle_ms)

        for v in views:
            slug, fname = v["slug"], v["file"]
            url = f"http://localhost:{FRONTEND_PORT}/#{slug}"
            try:
                try:
                    page.goto(url, wait_until="networkidle")
                except Exception as nav_err:
                    if "interrupted by another navigation" in str(nav_err):
                        page.wait_for_timeout(500)
                        page.goto(url, wait_until="networkidle")
                    else:
                        raise
                page.wait_for_timeout(settle_ms)
                for action in v.get("pre_actions", []) or []:
                    run_action(page, action)
                if v.get("pre_actions"):
                    page.wait_for_timeout(post_pre_ms)

                out = SCREENSHOTS / fname
                page.screenshot(path=str(out), full_page=bool(v.get("full_page", False)))
                report["captured"].append(
                    {"file": fname, "slug": slug, "section": v.get("section")}
                )
                print(f"[capture]   {fname}")
            except Exception as e:
                report["errors"].append({"file": fname, "slug": slug, "error": str(e)})
                print(f"[capture] FAILED {fname}: {e}", file=sys.stderr)

        browser.close()

    readme_text = README.read_text() if README.exists() else ""
    in_readme = set(re.findall(r"docs/screenshots/([\w.-]+\.png)", readme_text))
    captured_files = {c["file"] for c in report["captured"]}
    report["not_in_readme"] = sorted(captured_files - in_readme)
    report["in_readme_not_captured"] = sorted(in_readme - captured_files)
    return report


def regenerate_demo_health() -> None:
    """Refresh the Demo Person fixture so it matches the current v7 schema."""
    gen = SKILL_DIR / "scripts" / "generate_demo_health.py"
    target = DEMO_DATA / ".docvault-health.json"
    res = subprocess.run(
        [sys.executable, str(gen), "--output", str(target)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if res.returncode != 0:
        print(f"[capture] demo-health regeneration failed:\n{res.stdout.decode(errors='replace')}", file=sys.stderr)
        raise SystemExit(res.returncode)
    print(f"[capture] {res.stdout.decode(errors='replace').strip()}")


def main() -> None:
    if not DEMO_DATA.exists():
        raise SystemExit(f"demo-data not found at {DEMO_DATA}")
    ensure_playwright_chromium()
    regenerate_demo_health()
    with spawn_servers():
        report = capture()

    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\n[capture] report → {REPORT_PATH}")
    print(f"[capture] captured:             {len(report['captured'])}")
    print(f"[capture] not in README:        {len(report['not_in_readme'])} "
          f"{report['not_in_readme']}")
    print(f"[capture] in README, uncaptured:{len(report['in_readme_not_captured'])} "
          f"{report['in_readme_not_captured']}")
    print(f"[capture] errors:               {len(report['errors'])}")
    if report["errors"]:
        sys.exit(2)


if __name__ == "__main__":
    main()
