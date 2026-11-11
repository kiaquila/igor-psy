import argparse
import gzip
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
CSS_IMPORT = re.compile(r"""@import\s+(?:"([^"]+)"|'([^']+)')""", re.I)
BASELINE = ROOT / "delivery-baseline.json"
DOWNLOAD_KBPS = 1600
RTT_MS = 150
HANDSHAKE_RTTS = 3
REGRESSION_PERCENT = 3
COMPRESSED = {".html", ".css", ".js", ".mjs", ".svg", ".xml", ".json", ".txt"}


def css_urls(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for pattern in (CSS_URL, CSS_IMPORT):
        for match in pattern.finditer(css):
            yield next(group for group in match.groups() if group is not None)


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.errors = []
        self.links = []
        self.headings = 0
        self.title = []
        self.in_title = False
        self.lang = None
        self.booking = False
        self.resources = []
        self.in_style = False
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
        if tag == "style":
            self.in_style = True
        if attrs.get("style"):
            self.resources.extend((url, True) for url in css_urls(attrs["style"]))
        if "srcset" in attrs or "imagesrcset" in attrs:
            self.errors.append("delivery model needs a candidate selection rule for responsive images")
        if tag == "link" and attrs.get("href"):
            roles = set((attrs.get("rel") or "").lower().split())
            if roles & {"stylesheet", "preload", "modulepreload", "icon", "apple-touch-icon", "manifest"}:
                self.resources.append((attrs["href"], bool(roles & {"stylesheet", "preload"})))
        if tag in {"img", "script", "iframe", "audio", "video", "source", "embed"} and attrs.get("src"):
            eager = attrs.get("loading") != "lazy"
            critical = (tag == "img" and eager) or (
                tag == "script" and "async" not in attrs and "defer" not in attrs
                and attrs.get("type") != "module"
            )
            self.resources.append((attrs["src"], critical))
        if tag == "video" and attrs.get("poster"):
            self.resources.append((attrs["poster"], False))
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
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.in_style:
            self.resources.extend((url, True) for url in css_urls(data))


def local_path(target):
    path = (PUBLIC / unquote(target.path).lstrip("/")).resolve()
    return path / "index.html" if path.is_dir() else path


def route_for(path):
    relative = path.relative_to(PUBLIC).as_posix()
    return "/" + (relative.removesuffix("index.html") if path.name == "index.html" else relative)


def check_link(href, source, pages, errors):
    target = urlsplit(urljoin(ORIGIN + source, href))
    if (target.scheme, target.netloc) != ("https", "igor-psy.ks-design.art"):
        return
    path = local_path(target)
    if not path.is_relative_to(PUBLIC) or not path.is_file():
        errors.append(f"{source}: missing local target {href}")
        return
    if target.fragment and path in pages and unquote(target.fragment) not in pages[path].ids:
        errors.append(f"{source}: missing anchor {href}")


def delivery_estimate(page_path, resources):
    # Breadth-first so a URL discovered along two paths uses its earliest request.
    source = route_for(page_path)
    queue = [(url, source, 2) for url in resources]
    requested = {(page_path, ""): 1}
    for url, referrer, wave in queue:
        if not url or url.startswith(("#", "data:")):
            continue
        target = urlsplit(urljoin(ORIGIN + referrer, url))
        if (target.scheme, target.netloc) != ("https", "igor-psy.ks-design.art"):
            raise ValueError(f"{source}: external asset is outside the delivery model ({url})")
        path = local_path(target)
        key = (path, target.query)
        if key in requested:
            continue
        if not path.is_relative_to(PUBLIC) or not path.is_file():
            raise ValueError(f"{source}: missing delivery asset {url}")
        requested[key] = wave
        if path.suffix.lower() == ".css":
            queue.extend((child, route_for(path), wave + 1)
                         for child in css_urls(path.read_text(encoding="utf-8")))

    sizes = {}
    for path, query in sorted(requested):
        body = path.read_bytes()
        if path.suffix.lower() in COMPRESSED:
            body = gzip.compress(body, compresslevel=6, mtime=0)
        label = path.relative_to(PUBLIC).as_posix()
        sizes[label + ("?" + query if query else "")] = len(body)
    latency = (HANDSHAKE_RTTS + max(requested.values())) * RTT_MS
    return {"ms": latency + round(sum(sizes.values()) * 8 / DOWNLOAD_KBPS), "bytes": sizes}


def check_delivery(pages, update):
    current = {
        "model": {"downloadKbps": DOWNLOAD_KBPS, "rttMs": RTT_MS, "handshakeRtts": HANDSHAKE_RTTS},
        "pages": {
            route_for(path): {
                "firstPaint": delivery_estimate(path, [url for url, critical in page.resources if critical]),
                "fullLoad": delivery_estimate(path, [url for url, _ in page.resources]),
            }
            for path, page in pages.items()
        },
    }
    if update:
        BASELINE.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return []
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    if baseline["model"] != current["model"] or baseline["pages"].keys() != current["pages"].keys():
        return ["Delivery routes or model changed. Review and update delivery-baseline.json."]

    errors = []
    for route, phases in current["pages"].items():
        for phase, actual in phases.items():
            expected = baseline["pages"][route][phase]
            print(f"{route} {phase}: {actual['ms']} ms (baseline {expected['ms']} ms)")
            if actual["ms"] * 100 > expected["ms"] * (100 + REGRESSION_PERCENT):
                errors.append(f"{route} {phase}: exceeds the {REGRESSION_PERCENT}% delivery tolerance")
                for file, size in actual["bytes"].items():
                    growth = size - expected["bytes"].get(file, 0)
                    if growth > 0:
                        errors.append(f"  {file}: +{growth} wire bytes")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--update-delivery-baseline", action="store_true")
    args = parser.parse_args()
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
        source = route_for(path)
        if page.lang != "ru" or page.headings != 1 or not "".join(page.title).strip():
            page.errors.append("expected lang=ru, one h1 and a nonempty title")
        if relative in ENTRY_POINTS.values() and not page.booking:
            page.errors.append("missing Telegram booking link")
        errors.extend(f"{relative}: {error}" for error in page.errors)
        for href in page.links:
            check_link(href, source, pages, errors)

    for path in sorted(PUBLIC.rglob("*.css")):
        for href in css_urls(path.read_text(encoding="utf-8")):
            check_link(href, route_for(path), pages, errors)

    if not errors:
        try:
            errors.extend(check_delivery(pages, args.update_delivery_baseline))
        except (OSError, ValueError, KeyError, TypeError) as error:
            errors.append(f"Delivery check failed: {error}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Site checks passed ({len(pages)} HTML pages).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
