"""Exercise real PDF pixels plus evidence failures without Office/test-library dependencies."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

def module(name):
    spec = importlib.util.spec_from_file_location(name, (ROOT / 'skill/scripts' if (ROOT / 'skill').exists() else ROOT / 'skills/design-guard/scripts') / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

MEASURE = module('measure-pdf')
VERIFY = module('verify-documents')


def pdf(path, x=50, rotation=0, crop=False):
    stream = f'BT /F1 12 Tf {x} 240 Td (TARGET) Tj ET BT /F1 12 Tf 50 180 Td (REFERENCE) Tj ET 50 80 30 20 re f'.encode()
    box = '/CropBox [10 20 290 280]' if crop else ''
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] {box} /Rotate {rotation} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'.encode(),
               b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    data = b'%PDF-1.4\n'; offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data)); data += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
    start = len(data)
    data += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{v:010d} 00000 n \n'.encode() for v in offsets)
    data += f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
    path.write_bytes(data)


def targets():
    return [dict(name=n, page=1, roiPt=roi, background=[255,255,255]) for n, roi in
            [('target',[35,40,150,80]), ('comparison',[35,100,150,140]), ('shape',[35,190,110,240])]]


class Documents(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='design-guard-documents-')
        self.root = Path(self.temp.name)
        self.source = self.root / 'fixture.pdf'
        pdf(self.source)

    def tearDown(self):
        self.temp.cleanup()

    def record(self, label, t=None):
        return json.loads(MEASURE.measure(self.source, t or targets(), self.root / 'evidence', label).read_text())

    def test_real_movement_preserves_comparison_and_source(self):
        before_hash = MEASURE.digest(self.source)
        before = self.record('before')
        self.assertEqual(before_hash, MEASURE.digest(self.source))
        pdf(self.source, x=68)
        after = self.record('after')
        self.assertAlmostEqual(after['targets'][0]['paintedBoxPt'][0] - before['targets'][0]['paintedBoxPt'][0], 18)
        self.assertEqual(before['targets'][1], after['targets'][1])
        self.assertEqual(after['targets'][2]['words'], [])
        self.assertEqual(after['targets'][2]['paintedBoxPt'], [50,200,80,220])
        self.assertTrue(VERIFY.verify(before, after, self.source, ['comparison'])['evidenceChecksPassed'])
        self.assertFalse(VERIFY.verify(before, after, self.source, ['comparison'])['pixelGlyphBoundsVerified'])
        with self.assertRaisesRegex(ValueError, 'Fresh'):
            VERIFY.verify(after, after, self.source, ['comparison'])
        stale = copy.deepcopy(after); stale['measuredAt'] = before['measuredAt']
        with self.assertRaisesRegex(ValueError, 'newer'):
            VERIFY.verify(before, stale, self.source, ['comparison'])
        changed = copy.deepcopy(after); changed['targets'][1]['paintedBoxPt'][0] += 1
        with self.assertRaisesRegex(ValueError, 'moved'):
            VERIFY.verify(before, changed, self.source, ['comparison'])
        current = self.source.read_bytes(); self.source.write_bytes(current + b'\n')
        with self.assertRaisesRegex(ValueError, 'current source'):
            VERIFY.verify(before, after, self.source, ['comparison'])
        self.source.write_bytes(current)
        Path(after['images'][0]['path']).write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'image'):
            VERIFY.verify(before, after, self.source, ['comparison'])

    def test_crop_and_rotation_use_rendered_coordinates(self):
        pdf(self.source, rotation=90, crop=True)
        t = [dict(name=n, page=1, roiPt=roi, background=[255,255,255]) for n,roi in
             [('target',[210,30,240,100]), ('comparison',[150,30,180,130]), ('shape',[55,30,85,85])]]
        record = self.record('rotated',t)
        self.assertEqual(record['images'][0]['pageSizePt'], [260,280])
        self.assertEqual(record['targets'][0]['words'][0]['text'],'TARGET')
        self.assertEqual(record['targets'][2]['paintedBoxPt'],[60,40,80,70])
        for target in record['targets'][:2]:
            box, word = target['paintedBoxPt'], target['words'][0]
            self.assertLess(abs(box[0]-word['xMin']),3)
            self.assertLess(abs(box[1]-word['yMin']),3)

    def test_invalid_or_empty_measurement_is_not_success(self):
        for roi in ([0,0,10,10], [-1,0,30,30], [0,0,500,500]):
            t = targets();t[0]['roiPt']=roi
            with self.assertRaises(ValueError):
                self.record('invalid',t)
            self.assertFalse((self.root/'evidence/invalid.json').exists())
        t=targets();t[0]['page']=2
        with self.assertRaisesRegex(ValueError,'outside'):
            self.record('invalid',t)


if __name__ == '__main__':
    unittest.main()
