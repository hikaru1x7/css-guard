#!/usr/bin/env python3
"""Read-only PDF layout and raster measurements; never certifies visual quality."""
import argparse
import hashlib
import json
import math
import os
import re
from pathlib import Path
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
# Share the maintained private Pillow environment; leave OS Python unchanged.
for parent in Path(__file__).resolve().parents:
    engine = parent / 'engines/gui'
    if engine.is_dir():
        runtime = engine / '.runtime' / f'python-{sys.version_info.major}.{sys.version_info.minor}'
        packages = runtime / ('Lib/site-packages' if os.name == 'nt' else
                              f'lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages')
        if not packages.is_dir():
            raise RuntimeError('Prepare the shared image runtime with render-guard gui update before measurement.')
        sys.path.insert(0, str(packages))
        break
from PIL import Image, ImageChops, __version__ as pillow_version


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def measure(source, targets, output, label):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', label):
        raise ValueError('Use an alphanumeric measurement label.')
    source, output = Path(source).resolve(), Path(output).resolve()
    if any(part.lower() == 'downloads' for part in output.parts):
        raise ValueError('Use a project evidence directory, not Downloads.')
    if len(targets) < 2 or len({t['name'] for t in targets}) != len(targets):
        raise ValueError('Provide distinct target and comparison names (at least two).')
    before = digest(source)
    info_env = dict(os.environ, LC_ALL='C')
    info = subprocess.check_output(['pdfinfo', str(source)], env=info_env, text=True)
    count = re.search(r'^Pages:\s+(\d+)', info, re.M)
    if count is None:
        raise ValueError('Cannot read PDF page count.')
    page_count = int(count.group(1))
    nonce = uuid.uuid4().hex
    output.mkdir(parents=True, exist_ok=True)
    records, images = [], []
    pages = sorted({int(t['page']) for t in targets})
    if any(p < 1 or p > page_count for p in pages):
        raise ValueError('Page outside the document (pages are 1-based).')
    for page in pages:
        page_info = subprocess.check_output(['pdfinfo', '-f', str(page), '-l', str(page),
                                              '-box', str(source)], env=info_env, text=True)
        rotation = re.search(r'^Page\s+\d+\s+rot:\s+(-?\d+)', page_info, re.M)
        if rotation is None:
            raise ValueError('Cannot read PDF page rotation.')
        rotation = int(rotation.group(1)) % 360
        if rotation not in (0, 90, 180, 270):
            raise ValueError('Unsupported PDF page rotation.')
        data = subprocess.check_output(['pdftotext', '-f', str(page), '-l', str(page),
                                       '-bbox-layout', '-cropbox', str(source), '-'])
        tree = ET.fromstring(data)
        node = next((n for n in tree.iter() if n.tag.endswith('}page') or n.tag == 'page'), None)
        if node is None:
            raise ValueError(f'No PDF page {page}.')
        prefix = output / f'{label}-{nonce}-page-{page}'
        subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-singlefile',
                        '-cropbox', '-r', '144', '-png', str(source), str(prefix)], check=True,
                       stdout=subprocess.DEVNULL)
        png = prefix.with_suffix('.png')
        words = [{k: float(n.attrib[k]) for k in ('xMin', 'yMin', 'xMax', 'yMax')} | {'text': n.text or ''}
                 for n in node.iter() if n.tag.endswith('}word') or n.tag == 'word']
        with Image.open(png) as raw:
            image = raw.convert('RGB')
            # Derive scale from actual raster size and CropBox layout dimensions.
            page_width, page_height = float(node.attrib['width']), float(node.attrib['height'])
            if rotation in (90, 270):
                page_width, page_height = page_height, page_width
            sx, sy = image.width / page_width, image.height / page_height
            for target in (t for t in targets if int(t['page']) == page):
                roi = target.get('roiPt')
                background = target.get('background')
                if not roi or len(roi) != 4 or background is None or len(background) != 3:
                    raise ValueError('Each target requires roiPt=[left,top,right,bottom] and explicit RGB background.')
                if not all(math.isfinite(float(v)) for v in roi):
                    raise ValueError('Nonfinite ROI.')
                if not all(isinstance(v, int) and 0 <= v <= 255 for v in background):
                    raise ValueError('Background channels must be integers from 0 to 255.')
                left, top = math.floor(roi[0] * sx), math.floor(roi[1] * sy)
                right, bottom = math.ceil(roi[2] * sx), math.ceil(roi[3] * sy)
                if not (0 <= left < right <= image.width and 0 <= top < bottom <= image.height):
                    raise ValueError('ROI outside rendered page.')
                crop = image.crop((left, top, right, bottom))
                box = ImageChops.difference(crop, Image.new('RGB', crop.size, tuple(background))).getbbox()
                if box is None:
                    raise ValueError(f'No painted pixels for {target["name"]}.')
                painted = [box[0] + left, box[1] + top, box[2] + left, box[3] + top]
                records.append({'name': target['name'], 'page': page, 'roiPt': roi,
                                'paintedBoxPx': painted,
                                'paintedBoxPt': [painted[0] / sx, painted[1] / sy, painted[2] / sx, painted[3] / sy],
                                'words': [w for w in words if w['xMin'] >= roi[0] and w['yMin'] >= roi[1]
                                          and w['xMax'] <= roi[2] and w['yMax'] <= roi[3]]})
        images.append({'path': str(png), 'sha256': digest(png), 'page': page,
                       'rotation': rotation, 'pageSizePt': [page_width, page_height]})
    if digest(source) != before:
        raise ValueError('PDF changed during measurement.')
    version = subprocess.run(['pdftoppm', '-v'], capture_output=True, text=True, check=True).stderr.splitlines()[0]
    result = {'source': str(source), 'sourceSha256': before, 'renderer': version,
              'version': pillow_version, 'dpi': 144,
              'measurementId': nonce, 'measuredAt': datetime.now(timezone.utc).isoformat(),
              'label': label, 'pageCount': page_count, 'targets': records, 'images': images,
              'scope': 'Painted pixels inside declared ROIs; not an automatic clipping/overlap certificate.'}
    record = output / f'{label}.json'
    record.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--targets', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--label', required=True)
    args = parser.parse_args()
    try:
        print(measure(args.source, json.loads(Path(args.targets).read_text()), args.output, args.label))
    except (ValueError, KeyError, subprocess.SubprocessError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
