"""Fetch first-use years for scene buildings from the Estonian Building Register (EHR).

Writes data/raw/hist/ehr_years.json: {ehr_code: year or null}. Responses are cached per
building in data/raw/hist/ehr/ so the script can be resumed.
"""

import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pyogrio

ROOT = Path(__file__).resolve().parent.parent
HIST = ROOT / "data" / "raw" / "hist"
CACHE = HIST / "ehr"
API = "https://livekluster.ehr.ee/api/building/v2/buildingData?ehr_code={}"
BBOX = (541300.0, 6588300.0, 543100.0, 6589980.0)


def fetch(code):
    f = CACHE / f"{code}.json"
    if not f.exists():
        req = urllib.request.Request(API.format(code), headers={"User-Agent": "tallinn-3d-map (open-data research)"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    f.write_bytes(r.read())
                break
            except Exception:
                time.sleep(2 + attempt * 3)
        time.sleep(0.15)
    try:
        d = json.loads(f.read_text())["ehitis"]
    except Exception:
        return code, None
    years = [d.get("ehitiseAndmed", {}).get("esmaneKasutus")]
    for k in (d.get("ehitiseKehand") or {}).get("kehand") or []:
        years.append(k.get("esmane_kasutus"))
    years = [int(str(y)[:4]) for y in years if y and str(y)[:4].isdigit() and int(str(y)[:4]) > 1000]
    return code, min(years) if years else None


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    _, _, _, fields = pyogrio.raw.read(ROOT / "data/raw/gdb/hooned_lod2-Tallinn.gdb", bbox=BBOX, columns=["ehr_gid"])
    codes = sorted({c for c in fields[0] if c})
    print(f"{len(codes)} buildings with EHR codes")
    out = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        for k, (code, year) in enumerate(ex.map(fetch, codes)):
            out[code] = year
            if k % 200 == 0:
                print(k, flush=True)
    (HIST / "ehr_years.json").write_text(json.dumps(out))
    known = [y for y in out.values() if y]
    print(f"done: {len(known)}/{len(out)} with a year")


if __name__ == "__main__":
    main()
