import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ORIGIN = "https://igor-psy.ks-design.art"
ENTRY_POINTS = {"/": "index.html", "/practice/": "practice/index.html", "/404.html": "404.html"}
CSS_URL = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)""", re.I)


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.ids = set()
        self.errors = []
        self.links = []
        self.headings = 0
        self.title = []
        self.in_title = False
        self.lang = None
        self.booking = False
        self.feed(path.read_text(encoding="utf-8"))
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.lang = attrs.get("lang")
        if tag == "h1":
            self.headings += 1
        if tag == "title":
            self.in_title = True
        if element_id := attrs.get("id"):
            if element_id in self.ids:
                self.errors.append(f"duplicate id #{element_id}")
            self.ids.add(element_id)
        if tag == "img" and attrs.get("alt") is None:
            self.errors.append("image is missing alt")
        for attr in ("href", "src"):
            if isinstance(attrs.get(attr), str):
                self.links.append(attrs[attr])
        if tag == "a":
            link = urlsplit(attrs.get("href") or "")
            if link.netloc.lower() == "t.me":
                booking = link.scheme == "https" and link.path == "/CherkasovPsy"
                message = any(text.strip() for text in parse_qs(link.query).get("text", []))
                if not (booking and message):
                    self.errors.append("Telegram link must open the booking account with a message")
                self.booking |= booking and message

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)


def check_link(href, source, pages, errors):
    target = urlsplit(urljoin(ORIGIN + source, href))
    if (target.scheme, target.netloc) != ("https", "igor-psy.ks-design.art"):
        return
    path = (PUBLIC / unquote(target.path).lstrip("/")).resolve()
    if path.is_dir():
        path /= "index.html"
    if not path.is_relative_to(PUBLIC) or not path.is_file():
        errors.append(f"{source}: missing local target {href}")
        return
    if target.fragment and path in pages and unquote(target.fragment) not in pages[path].ids:
        errors.append(f"{source}: missing anchor {href}")


def main():
    errors = []
    for route, relative_path in ENTRY_POINTS.items():
        if not (PUBLIC / relative_path).is_file():
            errors.append(f"missing entry point {route} ({relative_path})")
    config = json.loads((ROOT / "wrangler.json").read_text(encoding="utf-8"))
    assets = config.get("assets", {})
    if (ROOT / assets.get("directory", "")).resolve() != PUBLIC:
        errors.append("wrangler.json: assets.directory must point to public")
    if assets.get("not_found_handling") != "404-page":
        errors.append("wrangler.json: missing 404-page handling")
    if assets.get("html_handling") != "auto-trailing-slash":
        errors.append("wrangler.json: HTML routes must support trailing slashes")

    pages = {path.resolve(): Page(path) for path in sorted(PUBLIC.rglob("*.html"))}
    for path, page in pages.items():
        relative = path.relative_to(PUBLIC).as_posix()
        source = "/" + (relative.removesuffix("index.html") if path.name == "index.html" else relative)
        if page.lang != "ru" or page.headings != 1 or not "".join(page.title).strip():
            page.errors.append("expected lang=ru, one h1 and a nonempty title")
        if relative in ENTRY_POINTS.values() and not page.booking:
            page.errors.append("missing Telegram booking link")
        errors.extend(f"{relative}: {error}" for error in page.errors)
        for href in page.links:
            check_link(href, source, pages, errors)

    for path in sorted(PUBLIC.rglob("*.css")):
        css = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
        for match in CSS_URL.finditer(css):
            href = next(group for group in match.groups() if group is not None)
            check_link(href, "/" + path.relative_to(PUBLIC).as_posix(), pages, errors)

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Site checks passed ({len(pages)} HTML pages).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
