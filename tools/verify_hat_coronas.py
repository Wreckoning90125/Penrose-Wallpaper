#!/usr/bin/env python3
"""Verify generated Hat 2-coronas against the local corona notebook.

The Wolfram notebook stores the 188 source 2-coronas in `.local/notebooks`.
This verifier keeps that data as the authority: it parses the notebook,
canonicalizes every source corona under triangular-lattice D6 symmetries, then
checks generated Hat PTG neighborhoods by exact canonical signature.
"""

from __future__ import annotations

import ast
import re
import struct
import subprocess
from collections import Counter, defaultdict
from math import gcd
from statistics import median
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = (
    ROOT
    / ".local"
    / "notebooks"
    / "notebook-sources3"
    / "Demonstration-Hat-Monotile-Coronas-1-0-0-definition.nb"
)
CACHE_DIR = ROOT / ".cache" / "hat-corona-check"
PATCH_FIXTURE = (
    ROOT / ".local" / "tiling" / "hat-spectre" / "validate" / "validate" / "2patches.txt"
)

PointI = tuple[int, int]
PointF = tuple[float, float]
LayeredHat = tuple[int, list[PointI]]
CanonicalHat = tuple[PointI, ...]
CanonicalCorona = tuple[tuple[int, CanonicalHat], ...]
SegmentKey = tuple[PointI, PointI]
AffineI = tuple[int, int, int, int, int, int]

EXPECTED_SOURCE_SIZE_COUNTS = Counter({19: 45, 20: 49, 21: 35, 22: 43, 23: 16})
EXPECTED_SOURCE_LAYER_COUNTS = Counter(
    {
        (1, 6, 12): 45,
        (1, 6, 13): 49,
        (1, 6, 14): 19,
        (1, 7, 13): 16,
        (1, 7, 14): 43,
        (1, 7, 15): 16,
    }
)
HAT_VALIDATE_OUTLINE: tuple[PointI, ...] = (
    (0, 0),
    (-1, -1),
    (0, -2),
    (2, -2),
    (2, -1),
    (4, -2),
    (5, -1),
    (4, 0),
    (3, 0),
    (2, 2),
    (0, 3),
    (0, 2),
    (-1, 2),
)


def extract_mathematica_list(text: str, marker: str) -> str:
    marker_index = text.find(marker)
    if marker_index < 0:
        raise SystemExit(f"could not find marker in notebook: {marker}")
    start = text.find("{", marker_index)
    if start < 0:
        raise SystemExit("could not find corona list start")
    depth = 0
    for index in range(start, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
            continue
        if char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    raise SystemExit("could not find corona list end")


def normalize_mathematica_points(source: str) -> str:
    sqrt3_power = r"3\^\s*Rational\[1,\s*2\]"
    normalized = re.sub(rf"\((-?\d+)\)\s*{sqrt3_power}", r"\1", source)
    normalized = re.sub(rf"(?<![\w\]])(-?\d+)\s+{sqrt3_power}", r"\1", normalized)
    normalized = re.sub(rf"-{sqrt3_power}", "-1", normalized)
    normalized = re.sub(sqrt3_power, "1", normalized)
    normalized = re.sub(r"\((-?\d+)\)\s*Sqrt\[3\]", r"\1", normalized)
    normalized = re.sub(r"(?<![\w\]])(-?\d+)\s*Sqrt\[3\]", r"\1", normalized)
    normalized = normalized.replace("-Sqrt[3]", "-1")
    normalized = normalized.replace("Sqrt[3]", "1")
    return normalized.replace("{", "[").replace("}", "]")


def mathematica_coronas_to_python(source: str) -> list[list[list[PointI]]]:
    normalized = normalize_mathematica_points(source)
    raw = ast.literal_eval(normalized)
    coronas: list[list[list[PointI]]] = []
    for corona in raw:
        hats: list[list[PointI]] = []
        for hat in corona:
            hats.append([(int(point[0]), int(point[1])) for point in hat])
        coronas.append(hats)
    return coronas


def mathematica_corona_to_python(source: str) -> list[list[PointI]]:
    normalized = normalize_mathematica_points(source)
    raw = ast.literal_eval(normalized)
    return [[(int(point[0]), int(point[1])) for point in hat] for hat in raw]


def find_matching_delimiter(text: str, start: int, open_char: str, close_char: str) -> int:
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue
        if char == open_char:
            depth += 1
            continue
        if char == close_char:
            depth -= 1
            if depth == 0:
                return index
    raise SystemExit(f"could not find matching {close_char}")


def split_top_level_args(source: str) -> list[str]:
    args: list[str] = []
    start = 0
    square_depth = 0
    brace_depth = 0
    paren_depth = 0
    in_string = False
    escaped = False
    for index, char in enumerate(source):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
            continue
        if char == "[":
            square_depth += 1
        elif char == "]":
            square_depth -= 1
        elif char == "{":
            brace_depth += 1
        elif char == "}":
            brace_depth -= 1
        elif char == "(":
            paren_depth += 1
        elif char == ")":
            paren_depth -= 1
        elif char == "," and square_depth == 0 and brace_depth == 0 and paren_depth == 0:
            args.append(source[start:index].strip())
            start = index + 1
    args.append(source[start:].strip())
    return args


def extract_input_cell_coronas(text: str) -> list[list[list[PointI]]]:
    start = text.find('RowBox[{"coronas",')
    if start < 0:
        raise SystemExit("could not find top-level coronas input cell")
    end = text.find('CellLabel->"In[1]:="', start)
    if end < 0:
        raise SystemExit("could not find end of top-level coronas input cell")
    block = text[start:end]
    coronas: list[list[list[PointI]]] = []
    cursor = 0
    marker = "InterpretationBox["
    while True:
        found = block.find(marker, cursor)
        if found < 0:
            break
        args_start = found + len(marker) - 1
        args_end = find_matching_delimiter(block, args_start, "[", "]")
        args = split_top_level_args(block[args_start + 1 : args_end])
        if len(args) < 2:
            raise SystemExit("iconized corona InterpretationBox has no source payload")
        coronas.append(mathematica_corona_to_python(args[1]))
        cursor = args_end + 1
    if len(coronas) != 188:
        raise SystemExit(f"expected 188 top-cell Hat coronas, found {len(coronas)}")
    return coronas


def rotate60(point: PointI) -> PointI:
    x, y = point
    return ((x - 3 * y) // 2, (x + y) // 2)


def reflect_x(point: PointI) -> PointI:
    x, y = point
    return (x, -y)


def transform_point(point: PointI, rotation: int, reflected: bool) -> PointI:
    result = reflect_x(point) if reflected else point
    for _ in range(rotation):
        result = rotate60(result)
    return result


def least_cyclic_polygon(points: list[PointI]) -> CanonicalHat:
    options: list[CanonicalHat] = []
    count = len(points)
    for oriented in (points, list(reversed(points))):
        for index in range(count):
            options.append(tuple(oriented[index:] + oriented[:index]))
    return min(options)


def canonical_corona(items: list[LayeredHat]) -> CanonicalCorona:
    best: CanonicalCorona | None = None
    for reflected in (False, True):
        for rotation in range(6):
            transformed: list[LayeredHat] = []
            for layer, hat in items:
                transformed.append((
                    layer,
                    [transform_point(point, rotation, reflected) for point in hat],
                ))
            origin = min(point for _layer, hat in transformed for point in hat)
            shifted = [
                (
                    layer,
                    [(point[0] - origin[0], point[1] - origin[1]) for point in hat],
                )
                for layer, hat in transformed
            ]
            signature: CanonicalCorona = tuple(
                sorted((layer, least_cyclic_polygon(hat)) for layer, hat in shifted)
            )
            if best is None or signature < best:
                best = signature
    if best is None:
        raise SystemExit("empty Hat corona cannot be canonicalized")
    return best


def touch_layers_from_lattice_hats(hats: list[list[PointI]], center_index: int) -> dict[int, int]:
    vertices: defaultdict[PointI, list[int]] = defaultdict(list)
    for hat_index, hat in enumerate(hats):
        for point in hat:
            vertices[point].append(hat_index)
    neighbors = [set([hat_index]) for hat_index in range(len(hats))]
    for touching_hats in vertices.values():
        for hat_index in touching_hats:
            neighbors[hat_index].update(touching_hats)
    return two_corona_layers(neighbors, center_index)


def two_corona_layers(neighbors: list[set[int]], center_index: int) -> dict[int, int]:
    layers = {center_index: 0}
    frontier = [center_index]
    for layer in (1, 2):
        next_frontier: list[int] = []
        for tile_index in frontier:
            for neighbor in neighbors[tile_index]:
                if neighbor not in layers:
                    layers[neighbor] = layer
                    next_frontier.append(neighbor)
        frontier = next_frontier
    return layers


def source_catalog_from_coronas(
    coronas: list[list[list[PointI]]],
    label: str,
) -> tuple[dict[CanonicalCorona, int], Counter[int], Counter[tuple[int, int, int]]]:
    if len(coronas) != 188:
        raise SystemExit(f"expected 188 Hat coronas in {label}, found {len(coronas)}")

    signatures: dict[CanonicalCorona, int] = {}
    source_sizes: Counter[int] = Counter()
    source_layers: Counter[tuple[int, int, int]] = Counter()
    for corona_index, corona in enumerate(coronas):
        open_hats: list[list[PointI]] = []
        for hat_index, hat in enumerate(corona):
            if len(hat) != 14 or hat[0] != hat[-1] or len(set(hat[:-1])) != 13:
                raise SystemExit(
                    f"{label} corona {corona_index + 1} hat {hat_index + 1} "
                    "is not a closed 13-vertex Hat"
                )
            open_hats.append(hat[:-1])
        layers = touch_layers_from_lattice_hats(open_hats, 0)
        layer_counts = Counter(layers.values())
        if (
            len(layers) != len(open_hats)
            or layer_counts[0] != 1
            or set(layer_counts) != {0, 1, 2}
        ):
            raise SystemExit(
                f"{label} corona {corona_index + 1} has invalid 2-corona layers: "
                f"{dict(layer_counts)}"
            )
        _neighbors, boundary, tile_segments = lattice_contacts_and_boundary(open_hats)
        if not one_corona_complete(layers, boundary, tile_segments):
            raise SystemExit(
                f"{label} corona {corona_index + 1} has an exposed center/1-corona boundary"
            )
        signature = canonical_corona([(layers[index], open_hats[index]) for index in range(len(open_hats))])
        if signature in signatures:
            raise SystemExit(
                f"{label} Hat corona signatures collide: {signatures[signature] + 1} "
                f"and {corona_index + 1}"
            )
        signatures[signature] = corona_index
        source_sizes[len(open_hats)] += 1
        source_layers[(layer_counts[0], layer_counts[1], layer_counts[2])] += 1

    if source_sizes != EXPECTED_SOURCE_SIZE_COUNTS:
        raise SystemExit(f"{label} unexpected size histogram: {dict(sorted(source_sizes.items()))}")
    if source_layers != EXPECTED_SOURCE_LAYER_COUNTS:
        raise SystemExit(f"{label} unexpected layer histogram: {dict(sorted(source_layers.items()))}")
    return signatures, source_sizes, source_layers


def load_source_coronas() -> tuple[dict[CanonicalCorona, int], Counter[int], Counter[tuple[int, int, int]]]:
    if not NOTEBOOK.exists():
        raise SystemExit(f"missing local Hat corona notebook: {NOTEBOOK}")
    text = NOTEBOOK.read_text(encoding="utf-8")
    saved_source = extract_mathematica_list(text, "$CellContext`coronas =")
    saved_catalog = source_catalog_from_coronas(
        mathematica_coronas_to_python(saved_source),
        "saved notebook initialization",
    )
    top_catalog = source_catalog_from_coronas(
        extract_input_cell_coronas(text),
        "top notebook input cell",
    )
    if set(saved_catalog[0]) != set(top_catalog[0]):
        raise SystemExit("top-cell and saved-initialization Hat corona signatures differ")
    return saved_catalog


def validate_outline_to_lattice(point: PointI) -> PointI:
    x, y = point
    return (2 * x + y, y)


def apply_affine(transform: AffineI, point: PointI) -> PointI:
    a, b, c, d, e, f = transform
    x, y = point
    return (a * x + b * y + c, d * x + e * y + f)


def parse_patch_fixture() -> list[list[LayeredHat]]:
    if not PATCH_FIXTURE.exists():
        raise SystemExit(f"missing local Hat 2-patch fixture: {PATCH_FIXTURE}")
    lines = PATCH_FIXTURE.read_text(encoding="utf-8").splitlines()
    patches: list[list[LayeredHat]] = []
    index = 0
    while index < len(lines):
        if not lines[index].strip():
            index += 1
            continue
        tile_count = int(lines[index])
        index += 1
        patch: list[LayeredHat] = []
        for _tile_index in range(tile_count):
            if index >= len(lines):
                raise SystemExit("Hat 2-patch fixture ended inside a patch")
            values = [int(value) for value in re.findall(r"-?\d+", lines[index])]
            index += 1
            if len(values) != 7:
                raise SystemExit(f"invalid Hat 2-patch fixture row: {lines[index - 1]}")
            layer = values[0]
            transform: AffineI = (values[1], values[2], values[3], values[4], values[5], values[6])
            hat = [
                validate_outline_to_lattice(apply_affine(transform, point))
                for point in HAT_VALIDATE_OUTLINE
            ]
            patch.append((layer, hat))
        patches.append(patch)
    return patches


def verify_patch_fixture(
    source_signatures: dict[CanonicalCorona, int],
) -> tuple[Counter[int], Counter[tuple[int, int, int]]]:
    patches = parse_patch_fixture()
    if len(patches) != 188:
        raise SystemExit(f"expected 188 Hat 2-patch fixtures, found {len(patches)}")
    fixture_signatures: set[CanonicalCorona] = set()
    fixture_sizes: Counter[int] = Counter()
    fixture_layers: Counter[tuple[int, int, int]] = Counter()
    for patch_index, patch in enumerate(patches):
        layer_counts = Counter(layer for layer, _hat in patch)
        if set(layer_counts) != {0, 1, 2} or layer_counts[0] != 1:
            raise SystemExit(
                f"Hat 2-patch fixture {patch_index + 1} has invalid layers: "
                f"{dict(layer_counts)}"
            )
        signature = canonical_corona(patch)
        if signature in fixture_signatures:
            raise SystemExit(f"Hat 2-patch fixture {patch_index + 1} duplicates an earlier patch")
        if signature not in source_signatures:
            raise SystemExit(f"Hat 2-patch fixture {patch_index + 1} is absent from notebook coronas")
        fixture_signatures.add(signature)
        fixture_sizes[len(patch)] += 1
        fixture_layers[(layer_counts[0], layer_counts[1], layer_counts[2])] += 1
    if fixture_signatures != set(source_signatures):
        raise SystemExit("Hat 2-patch fixture signatures do not exactly equal notebook coronas")
    if fixture_sizes != EXPECTED_SOURCE_SIZE_COUNTS:
        raise SystemExit(f"Hat 2-patch fixture unexpected size histogram: {dict(sorted(fixture_sizes.items()))}")
    if fixture_layers != EXPECTED_SOURCE_LAYER_COUNTS:
        raise SystemExit(
            f"Hat 2-patch fixture unexpected layer histogram: {dict(sorted(fixture_layers.items()))}"
        )
    return fixture_sizes, fixture_layers


def generate_hat_ptg(seed: int, generation: int) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = CACHE_DIR / f"hat-seed{seed}-gen{generation}.ptg"
    subprocess.run(
        [
            "python3",
            "tools/generate_web_geometry.py",
            "--live",
            "11",
            str(seed),
            str(generation),
            str(out.relative_to(ROOT)),
        ],
        cwd=ROOT,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return out


def read_ptg(path: Path) -> list[list[PointF]]:
    data = path.read_bytes()
    magic, family, _seed, _generation, tile_count = struct.unpack_from("<4sIIII", data, 0)
    if magic != b"PTG1" or family != 11:
        raise SystemExit(f"{path}: not a Hat PTG")
    offset = 20
    tiles: list[list[PointF]] = []
    for _ in range(tile_count):
        vertex_count = data[offset]
        offset += 2
        if vertex_count != 13:
            raise SystemExit(f"{path}: generated Hat with {vertex_count} vertices")
        tile: list[PointF] = []
        for _vertex in range(vertex_count):
            x, y = struct.unpack_from("<ff", data, offset)
            offset += 8
            tile.append((x, y))
        tiles.append(tile)
    return tiles


def min_edge_length(tiles: list[list[PointF]]) -> float:
    lengths: list[float] = []
    for tile in tiles:
        for index, point in enumerate(tile):
            next_point = tile[(index + 1) % len(tile)]
            dx = point[0] - next_point[0]
            dy = point[1] - next_point[1]
            length = (dx * dx + dy * dy) ** 0.5
            if length > 1e-8:
                lengths.append(length)
    if not lengths:
        raise SystemExit("generated Hat patch has no finite edge length")
    lengths.sort()
    short_count = min(len(lengths), 6 * len(tiles))
    return median(lengths[:short_count])


def canonical_segment(a: PointI, b: PointI) -> SegmentKey:
    return (a, b) if a <= b else (b, a)


def segment_lattice_points(a: PointI, b: PointI, all_points: set[PointI]) -> list[PointI]:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    step_count = gcd(abs(dx), abs(dy))
    if step_count == 0:
        return [a]
    step = (dx // step_count, dy // step_count)
    points: list[PointI] = []
    for index in range(step_count + 1):
        point = (a[0] + step[0] * index, a[1] + step[1] * index)
        if point in all_points:
            points.append(point)
    if len(points) < 2:
        return [a, b]
    return points


def generated_tiles_to_lattice(
    tiles: list[list[PointF]],
    edge_length: float,
) -> tuple[list[list[PointI]], float]:
    origin = min(point for tile in tiles for point in tile)
    sqrt3 = 3.0 ** 0.5
    max_error = 0.0
    result: list[list[PointI]] = []
    for tile in tiles:
        lattice_hat: list[PointI] = []
        for x, y in tile:
            lattice_x = 2.0 * (x - origin[0]) / edge_length
            lattice_y = 2.0 * (y - origin[1]) / (sqrt3 * edge_length)
            rounded_x = round(lattice_x)
            rounded_y = round(lattice_y)
            max_error = max(max_error, abs(lattice_x - rounded_x), abs(lattice_y - rounded_y))
            if (rounded_x - rounded_y) % 2 != 0:
                raise SystemExit(
                    f"generated Hat vertex does not land on triangular parity lattice: "
                    f"({rounded_x}, {rounded_y})"
                )
            lattice_hat.append((rounded_x, rounded_y))
        result.append(lattice_hat)
    return result, max_error


def lattice_contacts_and_boundary(
    lattice_tiles: list[list[PointI]],
) -> tuple[list[set[int]], set[SegmentKey], list[set[SegmentKey]]]:
    all_points = {point for tile in lattice_tiles for point in tile}
    contacts: defaultdict[PointI, set[int]] = defaultdict(set)
    segment_counts: Counter[SegmentKey] = Counter()
    tile_segments = [set() for _tile in lattice_tiles]
    for tile_index, tile in enumerate(lattice_tiles):
        for vertex_index, a in enumerate(tile):
            b = tile[(vertex_index + 1) % len(tile)]
            points_on_edge = segment_lattice_points(a, b, all_points)
            for contact in points_on_edge:
                contacts[contact].add(tile_index)
            for point_index in range(len(points_on_edge) - 1):
                left = points_on_edge[point_index]
                right = points_on_edge[point_index + 1]
                if left == right:
                    continue
                segment = canonical_segment(left, right)
                segment_counts[segment] += 1
                tile_segments[tile_index].add(segment)

    neighbors = [set([tile_index]) for tile_index in range(len(lattice_tiles))]
    for touching_tiles in contacts.values():
        if len(touching_tiles) < 2:
            continue
        for tile_index in touching_tiles:
            neighbors[tile_index].update(touching_tiles)
    boundary = {segment for segment, count in segment_counts.items() if count == 1}
    return neighbors, boundary, tile_segments


def one_corona_complete(
    layers: dict[int, int],
    boundary: set[SegmentKey],
    tile_segments: list[set[SegmentKey]],
) -> bool:
    for tile_index, layer in layers.items():
        if layer > 1:
            continue
        if tile_segments[tile_index] & boundary:
            return False
    return True


def generated_lattice_corona(
    lattice_tiles: list[list[PointI]],
    tiles: list[list[PointF]],
    layers: dict[int, int],
    edge_length: float,
) -> tuple[list[LayeredHat], float]:
    selected_indices = sorted(layers)
    origin = min(point for index in selected_indices for point in lattice_tiles[index])
    max_error = 0.0
    items: list[LayeredHat] = []
    sqrt3 = 3.0 ** 0.5
    float_origin = min(point for index in selected_indices for point in tiles[index])
    for tile_index in selected_indices:
        shifted_hat: list[PointI] = []
        for point, float_point in zip(lattice_tiles[tile_index], tiles[tile_index]):
            x, y = float_point
            lattice_x = 2.0 * (x - float_origin[0]) / edge_length
            lattice_y = 2.0 * (y - float_origin[1]) / (sqrt3 * edge_length)
            max_error = max(max_error, abs(lattice_x - round(lattice_x)), abs(lattice_y - round(lattice_y)))
            shifted_hat.append((point[0] - origin[0], point[1] - origin[1]))
        items.append((layers[tile_index], shifted_hat))
    return items, max_error


def verify_generated_coronas(
    seed: int,
    tiles: list[list[PointF]],
    source_signatures: dict[CanonicalCorona, int],
    allowed_sizes: set[int],
    sample_target: int,
) -> tuple[Counter[int], int, float]:
    edge_length = min_edge_length(tiles)
    lattice_tiles, patch_lattice_error = generated_tiles_to_lattice(tiles, edge_length)
    neighbors, boundary, tile_segments = lattice_contacts_and_boundary(lattice_tiles)
    centers = [
        (
            sum(point[0] for point in tile) / len(tile),
            sum(point[1] for point in tile) / len(tile),
        )
        for tile in tiles
    ]
    tile_order = sorted(
        range(len(tiles)),
        key=lambda tile_index: (
            centers[tile_index][0] * centers[tile_index][0]
            + centers[tile_index][1] * centers[tile_index][1]
        ),
    )

    matched_sizes: Counter[int] = Counter()
    matched_source_indices: set[int] = set()
    max_lattice_error = patch_lattice_error
    checked = 0
    for tile_index in tile_order:
        layers = two_corona_layers(neighbors, tile_index)
        if len(layers) not in allowed_sizes:
            continue
        if not one_corona_complete(layers, boundary, tile_segments):
            continue
        items, lattice_error = generated_lattice_corona(lattice_tiles, tiles, layers, edge_length)
        max_lattice_error = max(max_lattice_error, lattice_error)
        signature = canonical_corona(items)
        source_index = source_signatures.get(signature)
        if source_index is None:
            layer_counts = Counter(layers.values())
            raise SystemExit(
                f"Hat seed {seed}: generated 2-corona at tile {tile_index} "
                f"size {len(layers)} layers {dict(layer_counts)} is not in the 188 source signatures"
            )
        matched_sizes[len(layers)] += 1
        matched_source_indices.add(source_index)
        checked += 1
        if checked >= sample_target and set(matched_sizes) == allowed_sizes:
            break

    if checked < sample_target:
        raise SystemExit(f"Hat seed {seed}: only exact-matched {checked} coronas; target is {sample_target}")
    if set(matched_sizes) != allowed_sizes:
        raise SystemExit(
            f"Hat seed {seed}: exact matches missed size classes {sorted(allowed_sizes - set(matched_sizes))}"
        )
    if max_lattice_error > 0.01:
        raise SystemExit(f"Hat seed {seed}: lattice quantization error too high: {max_lattice_error:.6f}")
    return matched_sizes, len(matched_source_indices), max_lattice_error


def main() -> None:
    source_signatures, source_sizes, source_layers = load_source_coronas()
    allowed_sizes = set(source_sizes)
    fixture_sizes, fixture_layers = verify_patch_fixture(source_signatures)

    generated_counts: dict[int, Counter[int]] = {}
    matched_source_counts: dict[int, int] = {}
    lattice_errors: dict[int, float] = {}
    for seed in (0, 1, 2, 3):
        ptg = generate_hat_ptg(seed, 4)
        sizes, matched_source_count, lattice_error = verify_generated_coronas(
            seed,
            read_ptg(ptg),
            source_signatures,
            allowed_sizes,
            250,
        )
        generated_counts[seed] = sizes
        matched_source_counts[seed] = matched_source_count
        lattice_errors[seed] = lattice_error

    # Keep the printout explicit without treating finite generation-4 coverage
    # as proof that all 188 theoretical 2-coronas occur in these four patches.
    print(
        "hat coronas ok: "
        f"source signatures={len(source_signatures)} "
        f"sizes={dict(sorted(source_sizes.items()))} "
        f"layers={dict(sorted(source_layers.items()))}; "
        f"fixture sizes={dict(sorted(fixture_sizes.items()))} "
        f"fixture_layers={dict(sorted(fixture_layers.items()))}; "
        + "; ".join(
            f"seed{seed} matches={dict(sorted(generated_counts[seed].items()))} "
            f"source_cases={matched_source_counts[seed]} "
            f"lattice_error={lattice_errors[seed]:.6f}"
            for seed in (0, 1, 2, 3)
        )
    )


if __name__ == "__main__":
    main()
