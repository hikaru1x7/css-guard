#!/usr/bin/env python3
"""Check current document evidence and unchanged comparisons, not visual quality."""
import argparse
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys


def local_path(value):
    if os.name != 'nt' and re.match(r'^[A-Za-z]:[\\/]', value):
        return Path('/mnt') / value[0].lower() / value[3:].replace('\\', '/')
    return Path(value)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(before, after, source, comparisons, tolerance=0, allow_page_count=False):
    if not comparisons or not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError('Declare comparison names and a finite nonnegative tolerance.')
    if not before.get('measurementId') or before['measurementId'] == after.get('measurementId'):
        raise ValueError('Fresh after measurement required.')
    times = [datetime.fromisoformat(r['measuredAt']) for r in (before, after)]
    if any(t.tzinfo is None for t in times) or times[1] <= times[0]:
        raise ValueError('After evidence must be newer than before evidence.')
    if any(local_path(r['source']).resolve() != Path(source).resolve() for r in (before, after)):
        raise ValueError('Evidence belongs to another source file.')
    if after['sourceSha256'] != digest(source):
        raise ValueError('After evidence does not match the current source.')
    if (before['renderer'], before.get('version'), before.get('dpi')) != (after['renderer'], after.get('version'), after.get('dpi')):
        raise ValueError('Renderer/version/DPI changed during comparison.')
    if not allow_page_count and before.get('pageCount') != after.get('pageCount'):
        raise ValueError('Page/slide count changed; review the affected pages.')
    for record in (before, after):
        if not record.get('images'):
            raise ValueError('Native/rendered images required.')
        for image in record['images']:
            if digest(local_path(image['path'])) != image['sha256']:
                raise ValueError('Missing or modified evidence image.')
    old = {t['name']: t for t in before['targets']}
    new = {t['name']: t for t in after['targets']}
    if len(old) != len(before['targets']) or len(new) != len(after['targets']) or old.keys() != new.keys():
        raise ValueError('Target/comparison identity changed.')
    for name in comparisons:
        if name not in old:
            raise ValueError(f'Missing comparison: {name}')
        a, b = old[name], new[name]
        for key in ('page', 'slide', 'text', 'font', 'fontSizePt', 'rotation', 'words', 'roiPt'):
            if a.get(key) != b.get(key):
                raise ValueError(f'Comparison changed: {name}/{key}')
        boxes = [k for k in ('screenBoxPx', 'frameBoxPt', 'textBoxPt', 'paintedBoxPt') if a.get(k) is not None]
        if not boxes:
            raise ValueError(f'No measured comparison bounds: {name}')
        for key in boxes:
            if b.get(key) is None or len(a[key]) != len(b[key]) or any(
                not math.isfinite(float(x)) or not math.isfinite(float(y)) or abs(float(x) - float(y)) > tolerance
                for x, y in zip(a[key], b[key])
            ):
                raise ValueError(f'Comparison moved: {name}/{key}')
    return {'evidenceChecksPassed': True, 'comparisons': comparisons,
            'visualReviewRequired': True, 'pixelGlyphBoundsVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', required=True)
    parser.add_argument('--after', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--comparison', action='append', required=True)
    parser.add_argument('--max-drift', type=float, default=0, help='Explicit tolerance in each recorded box unit; normally zero.')
    parser.add_argument('--allow-page-count-change', action='store_true')
    args = parser.parse_args()
    try:
        read = lambda p: json.loads(Path(p).read_text(encoding='utf-8-sig'))
        print(json.dumps(verify(read(args.before), read(args.after), args.source,
                                args.comparison, args.max_drift, args.allow_page_count_change)))
    except (KeyError, TypeError, ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
