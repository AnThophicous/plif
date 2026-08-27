#!/usr/bin/env python3
# Network check is intentionally explicit and best-effort.
from common import load_json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

sources = load_json("catalogs/sources.json")["sources"]
urls = []
for s in sources:
    for key in ("official_source","documentation","repository"):
        u = s.get(key)
        if u and u not in urls:
            urls.append(u)

bad = 0
for url in urls:
    try:
        req = Request(url, method="HEAD", headers={"User-Agent":"plief-orun-link-check/1.0"})
        with urlopen(req, timeout=8) as r:
            print(r.status, url)
    except HTTPError as e:
        # HEAD can be rejected even if GET works; report, don't auto-delete.
        print("HTTP", e.code, url)
        if e.code >= 500:
            bad += 1
    except (URLError, TimeoutError) as e:
        print("ERR", url, str(e))
        bad += 1

raise SystemExit(1 if bad else 0)
