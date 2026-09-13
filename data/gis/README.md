# River basin GIS layer

`river-basins.geojson` is a deployable, simplified derivative of the U.S.
Geological Survey Watershed Boundary Dataset (WBD) 8-digit hydrologic-unit
layer. It contains four research-defined operational basin polygons:

| Operational basin | WBD components |
|---|---|
| Cape Fear | `03030002`–`03030007` (Haw through Northeast Cape Fear; the separate New River unit `03030001` is excluded) |
| Pee Dee | All `0304` HUC-8 units, covering the Yadkin–Pee Dee and Winyah Bay system |
| Santee | All `030501` HUC-8 units, covering Catawba–Wateree–Santee |
| Charleston Harbor / Lowcountry | Cooper HUC-8 `03050201`, which contains the Ashley, Cooper, and Wando drainage network |

Regenerate the file from the live USGS service with:

```bash
npm run gis:basins
```

The generation script dissolves the selected units into four outer boundaries,
topology-simplifies them for web delivery, records the exact component codes and
source refresh date, and embeds the historical-use caveat in the output.

These are modern hydrologic boundaries. In particular, the Santee and Cooper
geometry reflects the Santee–Cooper diversion and later impoundments. It is a
modern reference layer, not a claim that the drainage network looked identical
in the 1780s; the Mouzon 1775 map is the historical comparison source.

## Mouzon 1775 historical map

`mouzon-1775.json` is the deployable provenance and alignment manifest for the
default historical base map. It references 16 content-fingerprinted WebP panels
under `assets/maps/mouzon-1775/`. The source is the complete UWM American
Geographical Society Library scan, CONTENTdm item `agdm:2583` (11,000 × 7,864
pixels), rather than a third-party MapWarper derivative.

The panels use a single global affine fit in Web Mercator from 17 named
settlement controls. The manifest records each source pixel, modern target,
residual, source hash, panel hash, and generated extent. This measured fit is
appropriate for regional historical comparison only; it is not evidence that
an eighteenth-century road, shoreline, river, or settlement occupied a modern
GIS coordinate exactly. The title cartouche and the two harbor inset charts are
masked because they are not part of the geographic map plane.

Regenerate the manifest and panels with:

```bash
python3 -m pip install Pillow
npm run gis:mouzon
```
