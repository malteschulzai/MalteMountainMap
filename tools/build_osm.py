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
import json, math, os, re, sys, time, unicodedata
from collections import defaultdict

TL, TA = 0.1, 0.08
KEEP = {"name", "ele", "natural", "tourism", "aerialway", "piste:type", "piste:difficulty",
        "piste:name", "area", "highway", "sac_scale", "tracktype", "railway"}
# coarse names for the overview map: cities, towns and mountain ranges -> v1/labels.json
LIFTS = {"cable_car", "gondola", "chair_lift", "drag_lift", "t-bar", "j-bar", "platter",
         "rope_tow", "magic_carpet", "mixed_lift"}

# own place search -> v1/names/<c>.json, one file per first letter of each word of the name
NAME_T = {"city": "c", "town": "t", "village": "v", "hamlet": "h"}

def norm(s):
    s = unicodedata.normalize("NFD", s.lower().replace("ß", "ss"))
    return "".join(ch for ch in s if not unicodedata.combining(ch))

def words(s):
    return [w for w in re.split(r"[^a-z0-9]+", norm(s)) if w]

def shard(w):
    c = w[0]
    return c if ("a" <= c <= "z" or "0" <= c <= "9") else "_"

def ele_of(t):
    try: return int(round(float(str(t.get("ele", "")).replace(",", ".").split()[0])))
    except Exception: return 0

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
    places, ranges, names = [], {}, []
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
        if nm and g.get("type") == "Point":
            lon, lat = g["coordinates"][:2]
            t = NAME_T.get(p.get("place")) or ("p" if p.get("natural") == "peak" else "s" if p.get("natural") == "saddle"
                 else "u" if p.get("tourism") in ("alpine_hut", "wilderness_hut") else "l" if p.get("aerialway") == "station" else None)
            if t:
                names.append([nm, t, round(lon, 5), round(lat, 5), ele_of(p) if t in "psu" else 0])
        if nm and p.get("place") in ("village", "hamlet"):
            continue
        if nm and p.get("place") in ("city", "town") and g.get("type") == "Point":
            try: pop = int(str(p.get("population", "0")).replace(".", "").replace(",", "").split()[0])
            except Exception: pop = 0
            lon, lat = g["coordinates"][:2]
            places.append([round(lon, 4), round(lat, 4), nm, pop, 1 if p.get("place") == "city" else 2])
            continue
        if nm and p.get("natural") == "mountain_range":
            cs = g.get("coordinates") or []
            c = cs if g.get("type") == "Point" else (cs[len(cs) // 2] if cs else None)
            if c and nm not in ranges:
                ranges[nm] = [round(c[0], 4), round(c[1], 4), nm]
                names.append([nm, "r", round(c[0], 5), round(c[1], 5), 0])
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
    # search index: each entry gets the nearest town (or village) as a hint where it is
    grid = defaultdict(list)
    for e in names:
        if e[1] in "ctv":
            grid[(math.floor(e[2] / 0.2), math.floor(e[3] / 0.2))].append(e)
    def near(e):
        if e[1] in "ctr":
            return ""
        best, bd = "", 1e9
        cl = math.cos(math.radians(e[3]))
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for q in grid.get((math.floor(e[2] / 0.2) + di, math.floor(e[3] / 0.2) + dj), ()):
                    if q is e: continue
                    w = 1.0 if q[1] in "ct" else 2.5     # prefer towns over villages
                    d = math.hypot((q[2] - e[2]) * cl, q[3] - e[3]) * w
                    if d < bd: bd, best = d, q[0]
        return best
    shards, seen = defaultdict(list), set()
    for e in names:
        k = (e[0], e[1], round(e[2], 2), round(e[3], 2))
        if k in seen: continue
        seen.add(k)
        rec = e + [near(e)]
        for c in sorted({shard(w) for w in words(e[0]) if len(w) >= 2 or w.isdigit()}):
            shards[c].append(rec)
    d = os.path.join(out, "v1", "names")
    os.makedirs(d, exist_ok=True)
    for c, v in shards.items():
        with open(os.path.join(d, c + ".json"), "w", encoding="utf-8") as fh:
            json.dump(v, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"names: {len(seen)} entries in {len(shards)} files", flush=True)
    meta = {"v": 1, "built": time.strftime("%Y-%m-%d"), "tile": [TL, TA],
            "tiles": {k: sorted([f"{i}_{j}" for (i, j) in tt.keys()]) for k, tt in tiles.items()},
            "attribution": "© OpenStreetMap contributors (ODbL)"}
    with open(os.path.join(out, "v1", "meta.json"), "w") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    print(f"done: {n_in} read, {n_out} kept, {total/1e6:.1f} MB JSON", flush=True)

if __name__ == "__main__":
    main()
