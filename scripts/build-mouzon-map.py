#!/usr/bin/env python3
"""Build the locally hosted Mouzon 1775 historical map layer.

The source is the complete 11,000 x 7,864 UWM AGSL scan (CONTENTdm item
agdm:2583). A single global affine transform is fit in Web Mercator from
named settlement controls. The output is split into fingerprinted WebP
panels so the Leaflet client can load only panels intersecting the viewport.

Requires Pillow. The downloaded source is written beneath the ignored
``scratch/`` directory unless --source points at an existing scan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw


EARTH_RADIUS_M = 6_378_137.0
SOURCE_RECORD_URL = "https://collections.lib.uwm.edu/digital/collection/agdm/id/2583"
SOURCE_INFO_URL = "https://collections.lib.uwm.edu/iiif/2/agdm:2583/info.json"
SOURCE_IMAGE_URL = (
    "https://collections.lib.uwm.edu/iiif/2/agdm:2583/full/11000,/0/default.jpg"
)
SOURCE_SIZE = (11_000, 7_864)

# Source pixels were measured at the engraved settlement symbol or road
# junction, not at the text label. Target coordinates identify the modern
# town center or surviving historic site. The historical survey contains
# real local displacement, so this layer is intentionally documented as a
# regional research backdrop rather than a parcel-accurate basemap.
CONTROL_POINTS = [
    ("Cross Creek", 6438, 2500, 35.0525759, -78.8782920),
    ("Wilmington", 7397, 4052, 34.2352853, -77.9487284),
    ("Brunswick Town", 7285, 4330, 34.0404, -77.9476),
    ("New Bern", 8490, 2410, 35.1068428, -77.0398762),
    ("Bath", 8924, 1960, 35.4771094, -76.8116045),
    ("Edenton", 9083, 1100, 36.0579380, -76.6077213),
    ("Halifax", 7868, 773, 36.3285, -77.5894),
    ("Hillsborough", 6204, 1051, 36.0753820, -79.0993958),
    ("Salisbury", 4558, 1592, 35.6709727, -80.4742261),
    ("Charlotte", 4070, 2308, 35.2272086, -80.8430827),
    ("Camden", 4395, 3888, 34.2464886, -80.6070391),
    ("Georgetown", 6150, 5220, 33.3768, -79.2945),
    ("Charleston", 5260, 6276, 32.7884363, -79.9399309),
    ("Orangeburg", 4337, 5149, 33.4918203, -80.8556476),
    ("Ninety Six", 2911, 4127, 34.1751267, -82.0240070),
    ("Beaufort", 4511, 6801, 32.4316, -80.6698),
    ("Savannah", 4006, 7389, 32.0790074, -81.0921335),
]

REQUESTED_EXTENT = {
    "west": -83.05,
    "south": 31.90,
    "east": -76.25,
    "north": 36.75,
}
OUTPUT_RESOLUTION_M = 120.0
GRID_COLUMNS = 4
GRID_ROWS = 4


def web_mercator(lng: float, lat: float) -> tuple[float, float]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    x = EARTH_RADIUS_M * math.radians(lng)
    y = EARTH_RADIUS_M * math.log(
        math.tan(math.pi / 4.0 + math.radians(lat) / 2.0)
    )
    return x, y


def inverse_web_mercator(x: float, y: float) -> tuple[float, float]:
    lng = math.degrees(x / EARTH_RADIUS_M)
    lat = math.degrees(2.0 * math.atan(math.exp(y / EARTH_RADIUS_M)) - math.pi / 2.0)
    return lng, lat


def solve_linear(matrix: list[list[float]], values: list[float]) -> list[float]:
    """Solve a small square system with pivoted Gaussian elimination."""

    augmented = [row[:] + [value] for row, value in zip(matrix, values)]
    size = len(values)
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("Control-point normal matrix is singular")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        scale = augmented[column][column]
        augmented[column] = [value / scale for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                value - factor * pivot_value
                for value, pivot_value in zip(augmented[row], augmented[column])
            ]
    return [augmented[row][-1] for row in range(size)]


def affine_fit() -> tuple[list[float], list[float], list[dict], float, float]:
    """Fit target X/Y from [source_x, -source_y, 1]."""

    normal = [[0.0] * 3 for _ in range(3)]
    target_x = [0.0] * 3
    target_y = [0.0] * 3
    projected = []

    for name, source_x, source_y, lat, lng in CONTROL_POINTS:
        features = [float(source_x), float(-source_y), 1.0]
        x, y = web_mercator(lng, lat)
        projected.append((name, source_x, source_y, lat, lng, features, x, y))
        for row in range(3):
            target_x[row] += features[row] * x
            target_y[row] += features[row] * y
            for column in range(3):
                normal[row][column] += features[row] * features[column]

    coefficient_x = solve_linear(normal, target_x)
    coefficient_y = solve_linear(normal, target_y)

    controls = []
    squared_errors = []
    for name, source_x, source_y, lat, lng, features, target_mx, target_my in projected:
        fitted_mx = sum(a * b for a, b in zip(coefficient_x, features))
        fitted_my = sum(a * b for a, b in zip(coefficient_y, features))
        residual_km = math.hypot(fitted_mx - target_mx, fitted_my - target_my) / 1000.0
        squared_errors.append(residual_km * residual_km)
        controls.append(
            {
                "name": name,
                "source_pixel": [source_x, source_y],
                "target_lng_lat": [lng, lat],
                "fitted_residual_km": round(residual_km, 2),
            }
        )

    rms_km = math.sqrt(sum(squared_errors) / len(squared_errors))
    max_km = max(math.sqrt(error) for error in squared_errors)
    return coefficient_x, coefficient_y, controls, rms_km, max_km


def inverse_affine(
    coefficient_x: list[float], coefficient_y: list[float]
) -> tuple[float, float, float, float]:
    # X = cx0*u + cx1*w + cx2; Y = cy0*u + cy1*w + cy2, where w=-v.
    a, b = coefficient_x[0], coefficient_x[1]
    c, d = coefficient_y[0], coefficient_y[1]
    determinant = a * d - b * c
    if abs(determinant) < 1e-12:
        raise ValueError("Fitted affine transform is not invertible")
    return d / determinant, -b / determinant, -c / determinant, a / determinant


def panel_transform(
    offset_x: int,
    offset_y: int,
    minimum_x: float,
    maximum_y: float,
    coefficient_x: list[float],
    coefficient_y: list[float],
    inverse: tuple[float, float, float, float],
) -> tuple[float, float, float, float, float, float]:
    inv00, inv01, inv10, inv11 = inverse
    translated_x = minimum_x + (offset_x + 0.5) * OUTPUT_RESOLUTION_M - coefficient_x[2]
    translated_y = maximum_y - (offset_y + 0.5) * OUTPUT_RESOLUTION_M - coefficient_y[2]

    source_a = inv00 * OUTPUT_RESOLUTION_M
    source_b = -inv01 * OUTPUT_RESOLUTION_M
    source_c = inv00 * translated_x + inv01 * translated_y

    # The fitted second source coordinate is w=-source_y.
    source_d = -inv10 * OUTPUT_RESOLUTION_M
    source_e = inv11 * OUTPUT_RESOLUTION_M
    source_f = -(inv10 * translated_x + inv11 * translated_y)
    return source_a, source_b, source_c, source_d, source_e, source_f


def download_source(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        SOURCE_IMAGE_URL,
        headers={"User-Agent": "PortsFerryGIS/1.0 (historical map derivative)"},
    )
    print(f"Downloading UWM source scan to {path}", flush=True)
    with urllib.request.urlopen(request, timeout=180) as response, path.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def build(source_path: Path, output_dir: Path, manifest_path: Path) -> None:
    if not source_path.exists():
        download_source(source_path)

    source_digest = sha256(source_path)
    source = Image.open(source_path).convert("RGB")
    if source.size != SOURCE_SIZE:
        raise ValueError(f"Expected source size {SOURCE_SIZE}; received {source.size}")

    coefficient_x, coefficient_y, controls, rms_km, max_km = affine_fit()
    inverse = inverse_affine(coefficient_x, coefficient_y)

    minimum_x, minimum_y = web_mercator(
        REQUESTED_EXTENT["west"], REQUESTED_EXTENT["south"]
    )
    maximum_x, maximum_y = web_mercator(
        REQUESTED_EXTENT["east"], REQUESTED_EXTENT["north"]
    )

    width = math.ceil((maximum_x - minimum_x) / OUTPUT_RESOLUTION_M / GRID_COLUMNS) * GRID_COLUMNS
    height = math.ceil((maximum_y - minimum_y) / OUTPUT_RESOLUTION_M / GRID_ROWS) * GRID_ROWS
    panel_width = width // GRID_COLUMNS
    panel_height = height // GRID_ROWS
    rendered_maximum_x = minimum_x + width * OUTPUT_RESOLUTION_M
    rendered_minimum_y = maximum_y - height * OUTPUT_RESOLUTION_M

    # Only the geographic body of the map receives opacity. The engraved
    # title cartouche and the Port Royal/Charlestown inset charts are useful
    # artifacts, but they do not belong in geographic map space.
    alpha = Image.new("L", source.size, 0)
    draw = ImageDraw.Draw(alpha)
    draw.rectangle((225, 340, 10_740, 7_625), fill=255)
    draw.rectangle((225, 340, 2_975, 2_175), fill=0)
    draw.rectangle((7_180, 5_500, 10_740, 7_625), fill=0)

    output_dir.mkdir(parents=True, exist_ok=True)
    for old_panel in output_dir.glob("panel-*.webp"):
        old_panel.unlink()

    panels = []
    for row in range(GRID_ROWS):
        for column in range(GRID_COLUMNS):
            offset_x = column * panel_width
            offset_y = row * panel_height
            transform = panel_transform(
                offset_x,
                offset_y,
                minimum_x,
                maximum_y,
                coefficient_x,
                coefficient_y,
                inverse,
            )
            size = (panel_width, panel_height)
            panel_rgb = source.transform(
                size,
                Image.Transform.AFFINE,
                transform,
                resample=Image.Resampling.BICUBIC,
                fillcolor=(0, 0, 0),
            )
            panel_alpha = alpha.transform(
                size,
                Image.Transform.AFFINE,
                transform,
                resample=Image.Resampling.BILINEAR,
                fillcolor=0,
            )
            panel = panel_rgb.convert("RGBA")
            panel.putalpha(panel_alpha)

            temporary_path = output_dir / f"panel-r{row}-c{column}-pending.webp"
            panel.save(temporary_path, "WEBP", quality=84, method=6)
            digest = sha256(temporary_path)
            filename = f"panel-r{row}-c{column}-{digest[:10]}.webp"
            final_path = output_dir / filename
            temporary_path.rename(final_path)

            panel_minimum_x = minimum_x + offset_x * OUTPUT_RESOLUTION_M
            panel_maximum_x = panel_minimum_x + panel_width * OUTPUT_RESOLUTION_M
            panel_maximum_y = maximum_y - offset_y * OUTPUT_RESOLUTION_M
            panel_minimum_y = panel_maximum_y - panel_height * OUTPUT_RESOLUTION_M
            west, south = inverse_web_mercator(panel_minimum_x, panel_minimum_y)
            east, north = inverse_web_mercator(panel_maximum_x, panel_maximum_y)
            panels.append(
                {
                    "id": f"r{row}-c{column}",
                    "url": f"assets/maps/mouzon-1775/{filename}",
                    "bounds": [
                        [round(south, 7), round(west, 7)],
                        [round(north, 7), round(east, 7)],
                    ],
                    "pixel_size": [panel_width, panel_height],
                    "sha256": digest,
                    "bytes": final_path.stat().st_size,
                }
            )
            print(
                f"Built panel {row + 1}/{GRID_ROWS}, {column + 1}/{GRID_COLUMNS}: {filename}",
                flush=True,
            )

    rendered_west, rendered_south = inverse_web_mercator(minimum_x, rendered_minimum_y)
    rendered_east, rendered_north = inverse_web_mercator(rendered_maximum_x, maximum_y)
    manifest = {
        "schema_version": 1,
        "id": "mouzon-1775",
        "title": "An Accurate Map of North and South Carolina, 1775",
        "creator": "Henry Mouzon and others",
        "publisher": "Robert Sayer and John Bennett",
        "repository": "American Geographical Society Library, UWM Libraries",
        "source": {
            "record_url": SOURCE_RECORD_URL,
            "iiif_info_url": SOURCE_INFO_URL,
            "iiif_image_url": SOURCE_IMAGE_URL,
            "digital_item_id": "agdm:2583",
            "original_scale": "1:530,000",
            "source_pixel_size": list(SOURCE_SIZE),
            "source_sha256": source_digest,
        },
        "georeferencing": {
            "method": "single global affine transformation fit in EPSG:3857",
            "control_point_count": len(controls),
            "fitted_rms_km": round(rms_km, 2),
            "maximum_fitted_residual_km": round(max_km, 2),
            "affine_coefficients": {
                "mercator_x_from_source_x_neg_y_1": [round(value, 9) for value in coefficient_x],
                "mercator_y_from_source_x_neg_y_1": [round(value, 9) for value in coefficient_y],
            },
            "controls": controls,
            "use_limit": (
                "Regional historical context only. Settlement, shoreline, road, and river positions "
                "may differ by tens of kilometres; use modern GIS layers for close measurement."
            ),
        },
        "rendering": {
            "projection": "EPSG:3857",
            "resolution_metres_per_pixel": OUTPUT_RESOLUTION_M,
            "requested_extent_wsen": [
                REQUESTED_EXTENT["west"],
                REQUESTED_EXTENT["south"],
                REQUESTED_EXTENT["east"],
                REQUESTED_EXTENT["north"],
            ],
            "rendered_extent_wsen": [
                round(rendered_west, 7),
                round(rendered_south, 7),
                round(rendered_east, 7),
                round(rendered_north, 7),
            ],
            "pixel_size": [width, height],
            "grid": [GRID_COLUMNS, GRID_ROWS],
            "excluded_non_geographic_content": [
                "title cartouche",
                "Port Royal harbor inset",
                "Charlestown harbor inset",
            ],
        },
        "panels": panels,
        "generated_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(panels)} panels ({width} x {height} px); fitted RMS {rms_km:.2f} km",
        flush=True,
    )
    print(f"Manifest: {manifest_path}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("scratch/mouzon-1775-11000.jpg"),
        help="Local UWM source scan; downloaded when absent",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("assets/maps/mouzon-1775"),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/gis/mouzon-1775.json"),
    )
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    build(arguments.source, arguments.output_dir, arguments.manifest)
