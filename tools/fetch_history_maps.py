"""Download historical maps of the scene area from the Land Board's historical WMS.

Writes public/data/history/<era>.jpg, each covering exactly the scene extent so it can be
draped on the terrain with the same UVs as the modern ground texture.
"""

import io
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "history"
WMS = ("https://kaart.maaamet.ee/wms/ajalooline?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS={layer}"
       "&STYLES=&SRS=EPSG:3301&BBOX={bbox}&WIDTH={w}&HEIGHT={h}&FORMAT=image/png")
BBOX = (541300.0, 6588300.0, 543100.0, 6589980.0)

# era id -> (WMS layer, image width); the sheet years come from each layer's *_info metadata
ERAS = {
    "1899": ("yheverstakaart", 2048),
    "1929": ("ew_25T", 2048),
    "1946": ("nltopo_o42_10T", 2560),
    "2000": ("tln2000v", 3600),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    aspect = (BBOX[3] - BBOX[1]) / (BBOX[2] - BBOX[0])
    for era, (layer, w) in ERAS.items():
        h = round(w * aspect)
        url = WMS.format(layer=layer, bbox=",".join(str(v) for v in BBOX), w=w, h=h)
        req = urllib.request.Request(url, headers={"User-Agent": "tallinn-3d-map (open-data research)"})
        with urllib.request.urlopen(req, timeout=180) as r:
            img = Image.open(io.BytesIO(r.read())).convert("RGB")
        path = OUT / f"{era}.jpg"
        img.save(path, quality=84 if era == "2000" else 86, optimize=True, progressive=True)
        print(f"{era}: {layer} {img.size} {path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
