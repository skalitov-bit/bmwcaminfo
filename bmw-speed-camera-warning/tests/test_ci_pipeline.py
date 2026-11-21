import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ci_pipeline', ROOT / 'tools/ci_pipeline.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class PipelineSafety(unittest.TestCase):
    def test_corrupt_cache_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            raw = b'expected input'
            item = {'bytes': len(raw), 'sha256': ci.digest(raw), 'url': 'https://github.com/skalitov-bit/unused'}
            (Path(folder) / item['sha256']).write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                ci.cached(item, Path(folder))

    def test_hydration_cannot_replace_source(self):
        for path in ('../../README.md', '/tmp/app.js', 'apps/aurelm_speed_camera_warning/main.js',
                     'apps/aurelm_speed_camera_warning/app.json', 'C:\\temp\\file'):
            with self.assertRaises(ValueError):
                ci.resource_target(path)
        ci.resource_target('apps/aurelm_speed_camera_warning/hybrid-records-v1.bin')

    def test_input_lock_matches_versions(self):
        lock = json.loads(ci.LOCK.read_text('utf8'))
        app = json.loads((ci.APP / 'app.json').read_text('utf8'))
        voice = json.loads((ROOT / 'native/bmwcaminfo-voice/component.json').read_text('utf8'))
        self.assertEqual(lock['appVersion'], app['version'])
        self.assertEqual(lock['voiceVersion'], voice['version'])
        for item in [lock['source'], lock['voice'], lock['referenceApp']] + lock['resources']:
            self.assertEqual(len(item['sha256']), 64)
            self.assertGreater(item['bytes'], 0)

    def test_workflow_cannot_publish_or_regenerate(self):
        text = (ROOT.parent / '.github/workflows/speed-camera-release.yml').read_text('utf8')
        self.assertIn('contents: read', text)
        for forbidden in ('contents: write', 'gh release', '--clobber', 'edge-tts', 'gTTS',
                          'import_city_roads.py', 'import_mapcam.py', 'import_road_zones.py',
                          'schedule:', 'secrets.'):
            self.assertNotIn(forbidden, text)
        self.assertIn('ci_pipeline.py maps', text)
        self.assertIn('ci_pipeline.py build', text)


if __name__ == '__main__':
    unittest.main()
