"""Import the supplied icon's alpha channel without redrawing its silhouette.

The application applies the existing white foreground color at render time.
"""
import argparse,base64,hashlib,json,shutil,zlib
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('source',type=Path)
args=parser.parse_args()
with Image.open(args.source) as image:
    alpha=image.convert('RGBA').getchannel('A')
    box=alpha.getbbox()
    if box is None:raise ValueError('Empty icon')
    alpha=alpha.crop(box)
    payload={'format':'alpha8-zlib-base64','width':alpha.width,'height':alpha.height,
             'sourceFile':args.source.name,'sourceSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
             'alpha':base64.b64encode(zlib.compress(alpha.tobytes(),9)).decode()}
dest=root/'assets/camera-icon-source.png'
dest.parent.mkdir(parents=True,exist_ok=True)
shutil.copyfile(args.source,dest)
(root/'apps/aurelm_speed_camera_warning/camera-icon.json').write_text(json.dumps(payload,separators=(',',':')),encoding='utf-8')
print(json.dumps({'width':alpha.width,'height':alpha.height,'compressedBytes':len(payload['alpha']),'sourceSha256':payload['sourceSha256']}))
