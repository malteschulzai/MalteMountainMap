# Firstline Map

© 2026 Malte Hangler-Schulz. Alle Rechte vorbehalten, siehe [LICENSE](LICENSE). Kopieren oder Weiterverwenden des Codes nur mit schriftlicher Erlaubnis.

Persönliche 3D-Tourenkarte für die Alpen nach dem Vorbild von FATMAP: Skitouren und Bergtouren planen, Hangneigung, Lawinenlage, Hangsuche, offline nutzbar.

Über die Suche oder `?at=lon,lat` wird ein Bereich von 10 × 7,5 km mit dem besten frei verfügbaren Gelände des jeweiligen Landes geladen (Tirol, Schweiz, Frankreich, sonst Terrarium). Nahe der Kamera kommen 1-m-Detailkacheln dazu.

Funktionen: Luftbild (basemap.at) auf 3D-Gelände mit Nachladen schärferer Kacheln beim Heranzoomen, Hangneigung (30/35/40/45°), Höhenlinien, modellierter Winterlayer, Punktabfrage, GPX-Auswertung mit Höhenprofil.

## App und offline

Am Handy in Chrome öffnen und über das Menü installieren. Der Service Worker hält App und Daten vor, über „Offline speichern“ werden Luftbild und Schummerung der Nordkette auf dem Gerät gespeichert.

## Daten

- Vegetation (Wald, Latschen): Oberflächenmodell minus Geländemodell vom Land Tirol (CC BY 4.0), auf 6 m zusammengefasst.
- 3D-Bäume: Baumspitzen (lokale Maxima) aus Oberflächen- minus Geländemodell, Land Tirol (CC BY 4.0).
- Schummerung 50 cm (Gelände und Oberfläche): WMS Land Tirol.
- Gipfel, Hütten, Pisten, Lifte und Wege mit SAC-Skala: © OpenStreetMap-Mitwirkende (ODbL), zur Laufzeit über Overpass.
- Umgebung außerhalb des geladenen Bereichs: Mapzen Terrain Tiles (AWS Open Data).
- Ortssuche: Nominatim (OpenStreetMap).
- Luftbild: [basemap.at](https://basemap.at) Orthofoto, CC BY 4.0, direkt als Kacheln geladen.
- Geländemodell: Land Tirol, [Digitales Geländemodell Tirol](https://www.data.gv.at/katalog/dataset/0454f5f3-1d8c-464e-847d-541901eb021a), CC BY 4.0. Laserscan 50 cm, für die App auf 3 m Raster umgerechnet (Web Mercator, Höhen in Dezimetern, zeilenweise Prädiktor, gzip, Base64).

Der Winterlayer ist ein Geländemodell der relativen Schneeverteilung, keine gemessene Schneehöhe. Kein Ersatz für Lawinenlagebericht und eigene Beurteilung.
