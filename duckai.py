#!/usr/bin/env python
"""
duckai - ask duck.ai (DuckDuckGo's free AI chat) a question from the command line.

Every invocation opens a brand-new, isolated browser context (no cookies/storage
reused between runs), so each call is a fresh duck.ai session.

Usage:
    python duckai.py "say a poem"

Why a browser instead of a plain HTTP client:
DuckDuckGo has no public/official API for duck.ai. Reverse-engineered HTTP
clients (e.g. the archived `duckai` PyPI package, and gpt4free's now-removed
DDG provider) rely on a `/duckchat/v1/status` "vqd" token, but DuckDuckGo now
gates that endpoint behind a JS-based anti-bot challenge that changes often,
which is why those clients broke. Driving a real browser sidesteps the
challenge entirely since the browser executes the page's JS itself.

Note: headless Chromium/Firefox are both detected and silently blocked (the
page hangs forever, or returns an "Oops... temporarily unavailable" error).
This script therefore runs a real, visible browser window by default; pass
--headless to try headless anyway (kept for completeness, not recommended).
"""
import argparse
import html as html_lib
import re
import sys
import time

from playwright.sync_api import sync_playwright

DUCK_AI_URL = "https://duck.ai"


def ask(prompt: str, headless: bool = False, timeout_s: float = 60.0) -> str:
    """Open a fresh duck.ai session, send `prompt`, and return the reply text."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, channel="chrome")
        # A brand-new context per call = no shared cookies/localStorage = new session.
        context = browser.new_context()
        page = context.new_page()
        try:
            page.goto(DUCK_AI_URL, wait_until="domcontentloaded")

            box = page.get_by_placeholder("Ask anything privately")
            box.click()
            box.fill(prompt)
            box.press("Enter")

            # First message of a session triggers a one-time ToS/privacy consent dialog.
            try:
                page.get_by_role("button", name="Continue").click(timeout=6000)
            except Exception:
                pass

            return _wait_for_reply(page, timeout_s)
        finally:
            context.close()
            browser.close()


def _wait_for_reply(page, timeout_s: float) -> str:
    end = time.monotonic() + timeout_s
    last_text = ""
    resp = page.locator('[data-testid="user-message"]').last.locator("xpath=following-sibling::*[1]")
    while time.monotonic() < end:
        if resp.count():
            text = resp.inner_text()
            if "Oops..." in text:
                raise RuntimeError(f"duck.ai returned an error: {text.strip()}")
            if "2nd opinion" in text:
                return _clean_reply(_html_to_text(resp.evaluate(_BODY_HTML_JS)))
            last_text = text
        page.wait_for_timeout(500)
    raise TimeoutError(f"No complete reply after {timeout_s}s. Last seen:\n{last_text}")


# The reply element also holds a screen-reader "Duck.ai said" heading, a
# header with the model name ("GPT-5.6 Luna") / "Generating response" status,
# and the action buttons ("2nd opinion", ...). Strip those, keep the message.
_BODY_HTML_JS = """el => {
    const c = el.cloneNode(true);
    c.querySelectorAll('h3, [id^="heading-"], [data-message-actions]').forEach(n => n.remove());
    return c.innerHTML;
}"""


_LI_OPEN =re.compile(r"<li[^>]*>", re.IGNORECASE)
_LI_CLOSE = re.compile(r"</li\s*>", re.IGNORECASE)
_BR_TAG = re.compile(r"<br\s*/?>", re.IGNORECASE)
_BLOCK_CLOSE = re.compile(r"</(p|div|h[1-6]|blockquote|ul|ol)\s*>", re.IGNORECASE)
_ANY_TAG = re.compile(r"<[^>]+>")
_BLANK_RUN = re.compile(r"\n{3,}")
_STATUS_LINE = re.compile(r"^generating response\W*$", re.IGNORECASE)


def _html_to_text(fragment_html: str) -> str:
    """Convert a reply's inner HTML to plain text, keeping "- " list markers.

    duck.ai renders markdown "- item" lines as real <ul><li> elements, and the
    bullet is a CSS list-style marker rather than text - inner_text() drops it
    entirely. Rebuild it explicitly instead of scraping rendered text.
    """
    text = _LI_OPEN.sub("\n- ", fragment_html)
    text = _LI_CLOSE.sub("", text)
    text = _BR_TAG.sub("\n", text)
    text = _BLOCK_CLOSE.sub("\n\n", text)
    text = _ANY_TAG.sub("", text)
    text = html_lib.unescape(text)
    text = _BLANK_RUN.sub("\n\n", text)
    return text.strip()


def _clean_reply(text: str) -> str:
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if paragraphs and paragraphs[-1] == "2nd opinion":
        paragraphs = paragraphs[:-1]
    # The transient "Generating response" status can linger in the DOM, even
    # repeated, alongside the model-name header - drop every occurrence.
    paragraphs = [p for p in paragraphs if not _STATUS_LINE.match(p)]
    return "\n\n".join(paragraphs).strip()


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="Ask duck.ai a question (fresh session per call).")
    parser.add_argument("prompt", help="the message to send")
    parser.add_argument("--headless", action="store_true",
                         help="run headless (currently gets blocked by duck.ai's bot detection; not recommended)")
    parser.add_argument("--timeout", type=float, default=60.0, help="seconds to wait for a reply")
    args = parser.parse_args()

    try:
        reply = ask(args.prompt, headless=args.headless, timeout_s=args.timeout)
    except (RuntimeError, TimeoutError) as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    print(reply)


if __name__ == "__main__":
    main()
