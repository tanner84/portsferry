#!/usr/bin/env node

/**
 * Build the four Port's Ferry operational river basins from the live
 * USGS Watershed Boundary Dataset (WBD) 8-digit hydrologic-unit layer.
 *
 * The generated GeoJSON is the deployable artifact. Mapshaper dissolves
 * the selected HUC-8 units into one web-sized polygon per operational basin.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_PATH = join(REPO_ROOT, 'data', 'gis', 'river-basins.geojson');
const SERVICE_ROOT = 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer';
const HUC8_QUERY = `${SERVICE_ROOT}/4/query`;

const CAPE_FEAR_HUCS = new Set([
  '03030002', // Haw
  '03030003', // Deep
  '03030004', // Upper Cape Fear
  '03030005', // Lower Cape Fear
  '03030006', // Black
  '03030007', // Northeast Cape Fear
]);

const BASIN_DEFINITIONS = [
  {
    basin_id: 'cape-fear',
    basin_name: 'Cape Fear',
    color: '#2f6f9f',
    label_lat: 35.18,
    label_lng: -79.18,
    matches: code => CAPE_FEAR_HUCS.has(code),
    scope: 'Cross Creek–Moore’s Creek–Guilford Courthouse comparison area, including the Haw, Deep, upper and lower Cape Fear, Black, and Northeast Cape Fear subbasins.',
    historical_note: 'Modern terrain-based watershed boundary used as a geographic framework; it is not an eighteenth-century administrative boundary.',
  },
  {
    basin_id: 'pee-dee',
    basin_name: 'Pee Dee',
    color: '#2f7f68',
    label_lat: 34.42,
    label_lng: -80.05,
    matches: code => code.startsWith('0304'),
    scope: 'Yadkin–Pee Dee and Winyah Bay system: Wachovia and Salisbury through Cheraws, Lynches, Kingstree, Black Mingo, Snow’s Island, and Georgetown.',
    historical_note: 'Modern terrain-based watershed boundary used as a geographic framework; it is not an eighteenth-century administrative boundary.',
  },
  {
    basin_id: 'santee',
    basin_name: 'Santee',
    color: '#ad7832',
    label_lat: 34.12,
    label_lng: -81.42,
    matches: code => code.startsWith('030501'),
    scope: 'Catawba–Wateree–Santee system: upper Catawba and Broad headwaters through Camden, the Congaree, Nelson’s Ferry, and the lower Santee.',
    historical_note: 'Modern WBD geometry reflects the Santee–Cooper diversion and later impoundments; use it as a modern reference near Lakes Marion and Moultrie and the Cooper corridor pending comparison with Mouzon’s 1775 map.',
  },
  {
    basin_id: 'charleston-harbor-lowcountry',
    basin_name: 'Charleston Harbor / Lowcountry',
    color: '#8b4e72',
    label_lat: 32.95,
    label_lng: -80.08,
    matches: code => code === '03050201',
    scope: 'Charleston Harbor and its Ashley, Cooper, and Wando drainage network.',
    historical_note: 'Modern WBD geometry reflects the Santee–Cooper diversion and later impoundments; use it as a modern reference near Lakes Marion and Moultrie and the Cooper corridor pending comparison with Mouzon’s 1775 map.',
  },
];

function basinForHuc(code) {
  return BASIN_DEFINITIONS.find(definition => definition.matches(code));
}

function bboxForFeatureCollection(collection) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];

  function visit(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      bbox[0] = Math.min(bbox[0], value[0]);
      bbox[1] = Math.min(bbox[1], value[1]);
      bbox[2] = Math.max(bbox[2], value[0]);
      bbox[3] = Math.max(bbox[3], value[1]);
      return;
    }
    value.forEach(visit);
  }

  collection.features.forEach(feature => visit(feature.geometry.coordinates));
  return bbox.map(value => Number(value.toFixed(5)));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'portsferry-gis-builder/1.0' },
  });
  if (!response.ok) throw new Error(`USGS request failed: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`USGS request failed: ${data.error.message}`);
  return data;
}

async function main() {
  const params = new URLSearchParams({
    where: "huc8 LIKE '0303%' OR huc8 LIKE '0304%' OR huc8 LIKE '030501%' OR huc8 = '03050201'",
    outFields: 'huc8,name,areasqkm,states',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    f: 'geojson',
  });

  const [source, serviceMetadata] = await Promise.all([
    fetchJson(`${HUC8_QUERY}?${params}`),
    fetchJson(`${SERVICE_ROOT}?f=pjson`),
  ]);

  const selected = source.features.filter(feature =>
    basinForHuc(String(feature.properties?.huc8 || ''))
  );

  const grouped = new Map();
  for (const definition of BASIN_DEFINITIONS) {
    grouped.set(definition.basin_id, selected.filter(feature =>
      definition.matches(String(feature.properties.huc8))
    ));
  }

  const expectedCounts = new Map([
    ['cape-fear', 6],
    ['santee', 12],
    ['charleston-harbor-lowcountry', 1],
  ]);

  for (const definition of BASIN_DEFINITIONS) {
    const features = grouped.get(definition.basin_id);
    if (!features.length) {
      throw new Error(`No WBD features matched ${definition.basin_name}`);
    }
    const expected = expectedCounts.get(definition.basin_id);
    if (expected && features.length !== expected) {
      throw new Error(
        `${definition.basin_name} matched ${features.length} WBD units; expected ${expected}. ` +
        'Review the source hierarchy before regenerating.'
      );
    }
  }

  const annotated = {
    type: 'FeatureCollection',
    features: selected.map(feature => {
      const code = String(feature.properties.huc8);
      const definition = basinForHuc(code);
      const components = grouped.get(definition.basin_id)
        .slice()
        .sort((a, b) => String(a.properties.huc8).localeCompare(String(b.properties.huc8)));

      return {
        ...feature,
        properties: {
          basin_id: definition.basin_id,
          basin_name: definition.basin_name,
          color: definition.color,
          label_lat: definition.label_lat,
          label_lng: definition.label_lng,
          scope: definition.scope,
          historical_note: definition.historical_note,
          source_hucs: components.map(item => item.properties.huc8).join('|'),
          source_names: components.map(item => item.properties.name).join('|'),
          component_count: components.length,
          areasqkm: Number(feature.properties.areasqkm || 0),
        },
      };
    }),
  };

  const tempDirectory = mkdtempSync(join(tmpdir(), 'portsferry-basins-'));
  const annotatedPath = join(tempDirectory, 'annotated.geojson');
  const dissolvedPath = join(tempDirectory, 'dissolved.geojson');

  try {
    writeFileSync(annotatedPath, JSON.stringify(annotated));

    const mapshaper = spawnSync('npx', [
      '--yes',
      'mapshaper@0.7.61',
      annotatedPath,
      '-dissolve',
      'basin_id',
      'copy-fields=basin_name,color,label_lat,label_lng,scope,historical_note,source_hucs,source_names,component_count',
      'sum-fields=areasqkm',
      '-clean',
      '-simplify',
      'weighted',
      '12%',
      'keep-shapes',
      '-o',
      dissolvedPath,
      'format=geojson',
      'precision=0.0001',
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (mapshaper.status !== 0) {
      throw new Error(`Mapshaper failed:\n${mapshaper.stderr || mapshaper.stdout}`);
    }

    const dissolved = JSON.parse(readFileSync(dissolvedPath, 'utf8'));
    const order = new Map(BASIN_DEFINITIONS.map((definition, index) =>
      [definition.basin_id, index]
    ));

    dissolved.features.sort((a, b) =>
      order.get(a.properties.basin_id) - order.get(b.properties.basin_id)
    );

    for (const feature of dissolved.features) {
      feature.properties.area_sq_km = Number(feature.properties.areasqkm.toFixed(2));
      delete feature.properties.areasqkm;
    }

    const refreshMatch = String(serviceMetadata.copyrightText || '').match(/refreshed\s+([^.]*)/i);
    const output = {
      type: 'FeatureCollection',
      name: 'Ports Ferry operational river basins',
      bbox: bboxForFeatureCollection(dissolved),
      metadata: {
        source_dataset: 'USGS Watershed Boundary Dataset (WBD)',
        source_layer: '8-digit HU (Subbasin)',
        source_service: SERVICE_ROOT,
        source_refreshed: refreshMatch ? refreshMatch[1].trim() : 'See live USGS service metadata',
        generated_utc: new Date().toISOString(),
        generator: 'scripts/build-river-basins.mjs + mapshaper 0.7.61',
        selection_method: 'Selected WBD HUC-8 units are dissolved into four research-defined operational basins; point assignments are computed from these polygons.',
        historical_limit: 'These are modern hydrologic boundaries. Santee and Cooper geometry reflects the twentieth-century Santee–Cooper diversion and impoundments and must be interpreted alongside historical cartography.',
      },
      features: dissolved.features,
    };

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(output)}\n`);

    const summary = output.features.map(feature => ({
      basin: feature.properties.basin_name,
      components: feature.properties.component_count,
      area_sq_km: feature.properties.area_sq_km,
      geometry: feature.geometry.type,
    }));

    console.log(`Wrote ${OUTPUT_PATH}`);
    console.table(summary);
    console.log(`BBox: ${output.bbox.join(', ')}`);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
