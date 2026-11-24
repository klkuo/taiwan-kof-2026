#!/usr/bin/env python3
"""
Batch sprite sheet processor for Taiwan KOF 2026.
- Fast C-speed border flood-fill via scipy.ndimage.label (preserves interior whites & glowing auras)
- 2D connected-component pose extraction (prevents adjacent pose shoes/sparks from leaking into crops)
- Handles both 1-row (6 poses) and 2-row (7 or 8 poses) sheets
- Aligns baselines and packs into a single-row WebGL-safe transparent PNG (<= 4096px wide)
- Generates 256x256 portrait thumbnails and sprites.json metadata
"""

import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, label

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "sprites"

POSE_MAPS = {
    6: ["idle", "run", "punch", "kick", "special", "hit"],
    7: ["idle", "run", "punch", "kick", "dash", "special", "hit"],
    8: ["idle", "run", "punch", "kick", "kick2", "dash", "special", "hit"],
}

CELL_W = 448
CELL_H = 384


def remove_white_bg(img: Image.Image) -> Image.Image:
    """Remove white background using border-connected component flood-fill + clean edge feathering."""
    rgba = np.array(img.convert("RGBA"), dtype=np.float32)
    rgb = rgba[:, :, :3]

    min_c = np.min(rgb, axis=2)
    max_c = np.max(rgb, axis=2)
    sat = max_c - min_c

    is_bg_cand = (min_c > 228) & (sat < 24)
    labeled, _ = label(is_bg_cand)

    border_ids = np.unique(
        np.concatenate([labeled[0, :], labeled[-1, :], labeled[:, 0], labeled[:, -1]])
    )
    border_ids = border_ids[border_ids > 0]
    visited = np.isin(labeled, border_ids)

    alpha = np.where(visited, 0.0, 255.0)

    # Smooth 1px edge feathering without color-channel artifacts
    dilated = binary_dilation(visited, iterations=1)
    edge_band = dilated & (~visited) & (min_c > 195) & (sat < 30)
    edge_alpha = np.clip((242.0 - min_c) / 48.0, 0.0, 1.0)
    alpha = np.where(edge_band, edge_alpha * 255.0, alpha)

    rgba[:, :, :3] = np.where(alpha[:, :, None] == 0, 0, rgb)
    rgba[:, :, 3] = alpha
    return Image.fromarray(rgba.astype(np.uint8), "RGBA")


def find_intervals(mask_1d: np.ndarray, min_gap: int = 4) -> list[tuple[int, int]]:
    """Find contiguous True intervals in a 1D boolean array, bridging gaps <= min_gap."""
    n = len(mask_1d)
    raw = []
    in_seg = False
    start = 0
    for i in range(n):
        if mask_1d[i] and not in_seg:
            start = i
            in_seg = True
        elif not mask_1d[i] and in_seg:
            raw.append((start, i - 1))
            in_seg = False
    if in_seg:
        raw.append((start, n - 1))
    if not raw:
        return []

    merged = [raw[0]]
    for s, e in raw[1:]:
        prev_s, prev_e = merged[-1]
        if s - prev_e <= min_gap:
            merged[-1] = (prev_s, e)
        else:
            merged.append((s, e))
    return merged


def extract_row_poses(band_rgba: np.ndarray, is_single_row: bool) -> list[Image.Image]:
    """Extract individual pose RGBA images from a horizontal row band using 2D connected components."""
    fg = band_rgba[:, :, 3] > 25
    # Dilate slightly (3px) to connect motion lines / sparks to their character, without bridging pose gaps
    fg_dil = binary_dilation(fg, iterations=2)
    comp_map, num_comp = label(fg_dil, structure=np.ones((3, 3)))

    if num_comp == 0:
        return []

    # Measure area and centroid of each 2D component
    comp_info = []
    for cid in range(1, num_comp + 1):
        mask = comp_map == cid
        area = int(np.sum(mask & fg))
        if area < 40:
            continue
        ys, xs = np.where(mask & fg)
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        cx = float(xs.mean())
        comp_info.append({"cid": cid, "area": area, "bbox": (x0, y0, x1, y1), "cx": cx})

    if not comp_info:
        return []

    band_h = band_rgba.shape[0]
    max_area = max(c["area"] for c in comp_info)
    # Main poses must have substantial area AND be tall enough to be a character (>= 48% of row height)
    mains = [
        c for c in comp_info
        if c["area"] >= max_area * 0.18
        and (c["bbox"][2] - c["bbox"][0]) >= 90
        and (c["bbox"][3] - c["bbox"][1]) >= band_h * 0.48
    ]
    if not mains:
        mains = comp_info

    split_groups: list[dict] = []
    for m in mains:
        mask = (comp_map == m["cid"]) & fg
        split_groups.append({"mask": mask, "cx": m["cx"], "bbox": m["bbox"]})

    # Attach small detached fragments (gold ingots, sparks, etc.) to nearest pose group
    main_cids = {m["cid"] for m in mains}
    for c in comp_info:
        if c["cid"] in main_cids:
            continue
        nearest = min(split_groups, key=lambda g: abs(c["cx"] - g["cx"]))
        nearest["mask"] = nearest["mask"] | ((comp_map == c["cid"]) & fg)
        ys, xs = np.where(nearest["mask"])
        nearest["bbox"] = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))

    # Sort left-to-right and extract clean isolated RGBA crops
    split_groups.sort(key=lambda g: g["bbox"][0])
    pose_images = []
    for g in split_groups:
        x0, y0, x1, y1 = g["bbox"]
        sub_rgba = band_rgba[y0 : y1 + 1, x0 : x1 + 1].copy()
        sub_mask = g["mask"][y0 : y1 + 1, x0 : x1 + 1]
        # Dilate mask by 2px so semi-transparent anti-aliased edges of this pose are kept
        keep_mask = binary_dilation(sub_mask, iterations=2)
        sub_rgba[~keep_mask, 3] = 0
        pose_images.append(Image.fromarray(sub_rgba, "RGBA"))

    return pose_images


def segment_poses(rgba_img: Image.Image) -> list[Image.Image]:
    """Detect rows and extract isolated RGBA pose images."""
    arr = np.array(rgba_img)
    fg = arr[:, :, 3] > 25
    row_counts = np.sum(fg, axis=1)
    row_bands = [b for b in find_intervals(row_counts > 10, min_gap=18) if (b[1] - b[0]) > 150]

    is_single_row = len(row_bands) == 1
    poses = []
    for ry0, ry1 in row_bands:
        band_rgba = arr[ry0 : ry1 + 1, :]
        poses.extend(extract_row_poses(band_rgba, is_single_row=is_single_row))
    return poses


def process_character(path: Path) -> dict:
    char_id = path.stem
    print(f"Processing {char_id} ({path.name})...")
    src = Image.open(path)
    clean = remove_white_bg(src)
    pose_crops = segment_poses(clean)
    count = len(pose_crops)

    if count not in POSE_MAPS:
        print(f"  WARNING: {char_id} detected {count} poses, expected 6/7/8. Mapping sequentially.")
        pose_names = [f"pose_{i}" for i in range(count)]
    else:
        pose_names = POSE_MAPS[count]

    idle_h = pose_crops[0].height
    target_idle_h = CELL_H * 0.72
    base_scale = target_idle_h / max(idle_h, 1)

    sheet_w = CELL_W * count
    sheet = Image.new("RGBA", (sheet_w, CELL_H), (0, 0, 0, 0))
    frames_meta = {}

    for i, crop in enumerate(pose_crops):
        cw, ch = crop.size
        scale = min(base_scale, (CELL_W - 16) / cw, (CELL_H - 16) / ch)
        nw = max(1, int(round(cw * scale)))
        nh = max(1, int(round(ch * scale)))
        resized = crop.resize((nw, nh), Image.Resampling.LANCZOS)

        dx = i * CELL_W + (CELL_W - nw) // 2
        dy = CELL_H - 12 - nh
        sheet.paste(resized, (dx, dy), resized)

        pose_name = pose_names[i]
        frames_meta[pose_name] = {
            "index": i,
            "x": i * CELL_W,
            "y": 0,
            "w": CELL_W,
            "h": CELL_H,
            "contentW": nw,
            "contentH": nh,
        }

    sheet_path = OUT_DIR / f"{char_id}.png"
    sheet.save(sheet_path, "PNG", optimize=True)

    idle_crop_full = pose_crops[0]
    iw, ih = idle_crop_full.size
    idle_bust = idle_crop_full.crop((0, 0, iw, int(ih * 0.68)))
    bw, bh = idle_bust.size
    p_scale = min(228 / bw, 228 / bh)
    pw, ph = int(bw * p_scale), int(bh * p_scale)
    portrait = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    p_resized = idle_bust.resize((pw, ph), Image.Resampling.LANCZOS)
    portrait.paste(p_resized, ((256 - pw) // 2, 256 - ph), p_resized)
    portrait.save(OUT_DIR / f"{char_id}_portrait.png", "PNG", optimize=True)

    print(f"  -> {count} poses {pose_names} | sheet {sheet_w}x{CELL_H} saved.")
    return {
        "id": char_id,
        "sheet": f"sprites/{char_id}.png",
        "portrait": f"sprites/{char_id}_portrait.png",
        "sheetWidth": sheet_w,
        "sheetHeight": CELL_H,
        "cellWidth": CELL_W,
        "cellHeight": CELL_H,
        "frameCount": count,
        "frames": frames_meta,
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(
        [p for p in ASSETS_DIR.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"}],
        key=lambda p: p.stem,
    )
    manifest = {}
    for f in files:
        manifest[f.stem] = process_character(f)

    manifest_path = OUT_DIR / "sprites.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone! Processed {len(manifest)} characters -> {manifest_path}")


if __name__ == "__main__":
    main()
