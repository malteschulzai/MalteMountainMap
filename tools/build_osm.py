#!/usr/bin/env python3
"""Cut OpenStreetMap data of the Alps into small JSON files for Firstline Map.

Input: GeoJSON sequence from `osmium export` (stdin), ways as lines, nodes as points.
Output: <out>/v1/<kind>/<I>_<J>.json for tiles of 0.1 x 0.08 degrees (4 x 4 of the app's
cache tiles), kind "main" (peaks, saddles, huts, lift stations, pistes, ski tours, lifts,
SAC-rated paths) and "tracks" (forest roads, paths without SAC rating). Every way is written
to every tile its bounding box touches, so each file is complete for its own area.

Compact format, expanded in the app into Overpass-like elements:
  {"n": [[id, lon*1e5, lat*1e5, {tags}], ...],
   "w": [[id, {tags}, [lon0*1e5, lat0*1e5, dlon, dlat, ...]], ...]}
Data: (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys, time
from collections import defaultdict

TL, TA = 0.1, 0.08
KEEP = {"name", "ele", "natural", "tourism", "aerialway", "piste:type", "piste:difficulty",
        "piste:name", "area", "highway", "sac_scale", "tracktype", "railway"}
# coarse names for the overview map: cities, towns and mountain ranges -> v1/labels.json
LIFTS = {"cable_car", "gondola", "chair_lift", "drag_lift", "t-bar", "j-bar", "platter",
         "rope_tow", "magic_carpet", "mixed_lift"}

def kind_of(t, is_node):
    if is_node:
        if not t.get("name"):
            return None
        if t.get("natural") in ("peak", "saddle") or t.get("tourism") in ("alpine_hut", "wilderness_hut") \
                or t.get("aerialway") == "station":
            return "main"
        return None
    if t.get("piste:type") in ("downhill", "skitour") or t.get("aerialway") in LIFTS or t.get("railway") == "funicular":
        return "main"
    hw = t.get("highway")
    if hw in ("path", "footway", "bridleway", "steps") and t.get("sac_scale"):
        return "main"
    if hw == "track" or (hw == "path" and not t.get("sac_scale")):
        return "tracks"
    return None

def main():
    out = sys.argv[1]
    tiles = {"main": defaultdict(lambda: {"n": [], "w": []}), "tracks": defaultdict(lambda: {"n": [], "w": []})}
    n_in = n_out = 0
    places, ranges = [], {}
    t0 = time.time()
    for line in sys.stdin:
        line = line.strip().lstrip("\x1e")
        if not line:
            continue
        n_in += 1
        f = json.loads(line)
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        typ = p.get("@type") or ("node" if g.get("type") == "Point" else "way")
        oid = p.get("@id")
        nm = p.get("name:de") or p.get("name")
        if nm and p.get("place") in ("city", "town") and g.get("type") == "Point":
            try: pop = int(str(p.get("population", "0")).replace(".", "").replace(",", "").split()[0])
            except Exception: pop = 0
            lon, lat = g["coordinates"][:2]
            places.append([round(lon, 4), round(lat, 4), nm, pop, 1 if p.get("place") == "city" else 2])
            continue
        if nm and p.get("natural") == "mountain_range":
            cs = g.get("coordinates") or []
            c = cs if g.get("type") == "Point" else (cs[len(cs) // 2] if cs else None)
            if c and nm not in ranges: ranges[nm] = [round(c[0], 4), round(c[1], 4), nm]
            continue
        tags = {k: v for k, v in p.items() if k in KEEP}
        k = kind_of(tags, typ == "node")
        if not k:
            continue
        if g.get("type") == "Point":
            lon, lat = g["coordinates"][:2]
            key = (math.floor(lon / TL), math.floor(lat / TA))
            tiles[k][key]["n"].append([oid, round(lon * 1e5), round(lat * 1e5), tags])
            n_out += 1
        elif g.get("type") == "LineString":
            cs = g["coordinates"]
            if len(cs) < 2:
                continue
            q = [(round(c[0] * 1e5), round(c[1] * 1e5)) for c in cs]
            flat = [q[0][0], q[0][1]]
            for a, b in zip(q, q[1:]):
                flat += [b[0] - a[0], b[1] - a[1]]
            lons = [c[0] for c in cs]; lats = [c[1] for c in cs]
            rec = [oid, tags, flat]
            for i in range(math.floor(min(lons) / TL), math.floor(max(lons) / TL) + 1):
                for j in range(math.floor(min(lats) / TA), math.floor(max(lats) / TA) + 1):
                    tiles[k][(i, j)]["w"].append(rec)
            n_out += 1
        if n_in % 500000 == 0:
            print(f"{n_in} features read, {n_out} kept, {time.time()-t0:.0f} s", flush=True)
    total = 0
    for k, tt in tiles.items():
        d = os.path.join(out, "v1", k)
        os.makedirs(d, exist_ok=True)
        for (i, j), v in tt.items():
            s = json.dumps(v, separators=(",", ":"), ensure_ascii=False)
            with open(os.path.join(d, f"{i}_{j}.json"), "w", encoding="utf-8") as fh:
                fh.write(s)
            total += len(s)
        print(f"{k}: {len(tt)} tiles", flush=True)
    with open(os.path.join(out, "v1", "labels.json"), "w", encoding="utf-8") as fh:
        json.dump({"places": places, "ranges": list(ranges.values())}, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"labels: {len(places)} places, {len(ranges)} ranges", flush=True)
    meta = {"v": 1, "built": time.strftime("%Y-%m-%d"), "tile": [TL, TA],
            "tiles": {k: sorted([f"{i}_{j}" for (i, j) in tt.keys()]) for k, tt in tiles.items()},
            "attribution": "© OpenStreetMap contributors (ODbL)"}
    with open(os.path.join(out, "v1", "meta.json"), "w") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    print(f"done: {n_in} read, {n_out} kept, {total/1e6:.1f} MB JSON", flush=True)

if __name__ == "__main__":
    main()
