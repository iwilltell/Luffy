"""
Key, trim and pack the Gemini Luffy frames into WebP atlases.

    python tools/build_frames.py <frames_dir> <out_dir>

<frames_dir> holds frame_001.png .. frame_070.png (1280x720, black plate).
Writes   <out_dir>/luffy-base.webp  (+ .half.webp)   idle, turns, blink, blush, laugh
         <out_dir>/luffy-gust.webp  (+ .half.webp)   wind, hat chase, catch, DON!
         <out_dir>/luffy.json                       atlas rects + placement

Every frame is placed in one shared coordinate space: the source 1280x720 plate
of the front-facing frame. Frames 63-69 come from a zoomed-out shot, so they are
rescaled into that space by matching the straw-hat brim width.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SRC_W, SRC_H = 1280, 720
BG_MAX = 5            # channel max at or below this counts as plate black (hair sits at 9-11)
BIG_POCKET = 2500     # enclosed black pockets larger than this are background too
FEATHER = 40          # px fade where a frame touches the plate's top/left/right edge
STAR = (560, 640, 1120, 1200)   # y0, y1, x0, x1 - the generator watermark sparkle
SCALES = {'': 0.88, '.half': 0.42}

BASE = [12, 3, 4, 5, 6, 23, 22, 17, 19, 15, 16, 26, 27, 28] + list(range(29, 39))
GUST = list(range(39, 70))
ZOOMED = range(63, 70)  # the camera pulls back on these


def load(frames_dir, i):
    im = Image.open(os.path.join(frames_dir, 'frame_%03d.png' % (i + 1))).convert('RGB')
    return np.array(im)


def key(rgb):
    """RGBA with the black plate removed and a 2px ink line kept around him."""
    rgb = rgb.copy()
    y0, y1, x0, x1 = STAR
    rgb[y0:y1, x0:x1] = 0
    m = rgb.max(-1)
    cand = m <= BG_MAX
    lab, n = ndimage.label(cand)
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    keep = np.zeros(n + 1, bool)
    for k in range(1, n + 1):
        if k in border or sizes[k - 1] > BIG_POCKET:
            keep[k] = True
    bg = keep[lab]
    # pixels of the plate within ~2px of him become his outline, then fade
    dist = ndimage.distance_transform_edt(bg)
    alpha = np.where(bg, np.clip(2.6 - dist, 0, 1), 1.0)
    # drop compression specks floating on the plate
    lab2, n2 = ndimage.label(alpha > 0.05)
    if n2:
        sizes2 = ndimage.sum(np.ones_like(lab2), lab2, index=np.arange(1, n2 + 1))
        alpha[np.isin(lab2, np.where(sizes2 < 250)[0] + 1)] = 0
    # soften where the plate's own frame edges would cut a flying hat or a wind streak
    yy, xx = np.mgrid[0:SRC_H, 0:SRC_W]
    edge = np.minimum.reduce([yy, xx, SRC_W - 1 - xx]).astype(float)
    f = np.clip(edge / FEATHER, 0, 1)
    alpha *= f * f * (3 - 2 * f)
    out = np.dstack([rgb, (alpha * 255).round().astype(np.uint8)])
    return out


def brim(rgba):
    """width, centre x and row of the widest straw-coloured row in the top half."""
    r, g, b = [rgba[..., c].astype(int) for c in range(3)]
    straw = (r > 150) & (g > 105) & (b < 125) & (r > g) & (g > b) & (r - b > 70) & (rgba[..., 3] > 200)
    best = (0, 0, 0)
    for y in range(0, SRC_H // 2):
        xs = np.where(straw[y])[0]
        if len(xs) < 20:
            continue
        w = xs.max() - xs.min()
        if w > best[0]:
            best = (w, (xs.max() + xs.min()) / 2, y)
    return best


def main():
    frames_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    keyed = {i: key(load(frames_dir, i)) for i in sorted(set(BASE + GUST))}

    # placement in plate space: (image, dest x, dest y, dest scale)
    placed = {i: (Image.fromarray(keyed[i], 'RGBA'), 0.0, 0.0, 1.0) for i in keyed}
    ref_w, ref_cx, ref_y = brim(keyed[12])
    z_w, z_cx, z_y = np.median([brim(keyed[i]) for i in (64, 65, 66, 67, 68, 69)], axis=0)
    s = ref_w / z_w
    print('brim ref', ref_w, ref_cx, ref_y, '| zoomed', z_w, z_cx, z_y, '-> scale %.3f' % s)
    for i in ZOOMED:
        im = placed[i][0]
        placed[i] = (im, ref_cx - z_cx * s, ref_y - z_y * s, s)

    meta = {'plate': [SRC_W, SRC_H], 'ref': {'brimX': float(ref_cx), 'brimY': float(ref_y), 'brimW': float(ref_w)},
            'sheets': {}, 'frames': {}}

    for sheet_name, ids in (('base', BASE), ('gust', GUST)):
        for suffix, sc in SCALES.items():
            tiles = []
            for i in ids:
                im, dx, dy, ds = placed[i]
                bbox = im.getbbox()
                crop = im.crop(bbox)
                k = sc * ds
                tw, th = max(1, round(crop.width * k)), max(1, round(crop.height * k))
                tile = crop.resize((tw, th), Image.LANCZOS)
                dest = [dx + bbox[0] * ds, dy + bbox[1] * ds, crop.width * ds, crop.height * ds]
                tiles.append((i, tile, dest))
            # shelf pack, tallest first
            W = 4096 if suffix == '' else 2048
            order = sorted(tiles, key=lambda t: -t[1].height)
            x = y = shelf = 0
            rects = {}
            for i, tile, dest in order:
                if x + tile.width > W:
                    x, y, shelf = 0, y + shelf + 2, 0
                rects[i] = (x, y, tile.width, tile.height, dest)
                x += tile.width + 2
                shelf = max(shelf, tile.height)
            H = y + shelf
            atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            for i, tile, _ in tiles:
                rx, ry, _, _, _ = rects[i]
                atlas.paste(tile, (rx, ry))
            path = os.path.join(out_dir, 'luffy-%s%s.webp' % (sheet_name, suffix))
            atlas.save(path, 'WEBP', quality=86, method=6, alpha_quality=90)
            print(path, atlas.size, '%.0f KB' % (os.path.getsize(path) / 1024))
            meta['sheets'].setdefault(sheet_name, {})['file' + suffix.replace('.', '_')] = os.path.basename(path)
            for i, (rx, ry, rw, rh, dest) in rects.items():
                fr = meta['frames'].setdefault(str(i), {'sheet': sheet_name})
                fr['src' + suffix.replace('.', '_')] = [rx, ry, rw, rh]
                fr['dest'] = [round(float(v), 2) for v in dest]

    with open(os.path.join(out_dir, 'luffy.json'), 'w') as fh:
        json.dump(meta, fh, separators=(',', ':'))
    print('frames', len(meta['frames']))


if __name__ == '__main__':
    main()
