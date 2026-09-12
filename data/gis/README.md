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

