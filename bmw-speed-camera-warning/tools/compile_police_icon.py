"""Compile the approved monochrome artwork to the runtime coverage-mask format."""
from pathlib import Path
import base64
import json
import zlib
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'assets/dps-approved.png'
coverage = Image.open(source).convert('L')
bounds = coverage.point(lambda value: 255 if value > 128 else 0).getbbox()
if not bounds:
    raise ValueError('Empty police icon')
coverage = coverage.crop(bounds)
payload = {
    'width': coverage.width,
    'height': coverage.height,
    'alpha': base64.b64encode(zlib.compress(coverage.tobytes(), 9)).decode('ascii'),
}
target = root / 'apps/aurelm_speed_camera_warning/police-icon.json'
target.write_text(json.dumps(payload), encoding='utf-8')
print(target)
