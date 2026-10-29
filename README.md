# Malte Mountain Map

Persönliche 3D-Tourenkarte nach dem Vorbild von FATMAP. Testregion: Nordkette bei Innsbruck.

Funktionen: Luftbild (basemap.at) auf 3D-Gelände mit Nachladen schärferer Kacheln beim Heranzoomen, Hangneigung (30/35/40/45°), Höhenlinien, modellierter Winterlayer, Punktabfrage, GPX-Auswertung mit Höhenprofil.

## App und offline

Am Handy in Chrome öffnen und über das Menü installieren. Der Service Worker hält App und Daten vor, über „Offline speichern“ werden Luftbild und Schummerung der Nordkette auf dem Gerät gespeichert.

## Daten

- Vegetation (Wald, Latschen): Oberflächenmodell minus Geländemodell vom Land Tirol (CC BY 4.0), auf 6 m zusammengefasst.
- 3D-Bäume: Baumspitzen (lokale Maxima) aus Oberflächen- minus Geländemodell, Land Tirol (CC BY 4.0).
- Schummerung 50 cm (Gelände und Oberfläche): WMS Land Tirol.
- Gipfel-, Joch- und Bahnnamen: © OpenStreetMap-Mitwirkende (ODbL).
- Luftbild: [basemap.at](https://basemap.at) Orthofoto, CC BY 4.0, direkt als Kacheln geladen.
- Geländemodell: Land Tirol, [Digitales Geländemodell Tirol](https://www.data.gv.at/katalog/dataset/0454f5f3-1d8c-464e-847d-541901eb021a), CC BY 4.0. Laserscan 50 cm, für die App auf 3 m Raster umgerechnet (Web Mercator, Höhen in Dezimetern, zeilenweise Prädiktor, gzip, Base64).

Der Winterlayer ist ein Geländemodell der relativen Schneeverteilung, keine gemessene Schneehöhe. Kein Ersatz für Lawinenlagebericht und eigene Beurteilung.
