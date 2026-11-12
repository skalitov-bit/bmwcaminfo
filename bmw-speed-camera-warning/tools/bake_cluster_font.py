"""Bake monochrome glyph images for offline KOMBI/HUD rendering; no TTF is packaged.

The generated JSON is committed, so builds do not require Windows or Pillow.
Regeneration: python bake_cluster_font.py (bundled Roboto Condensed, weight 500).
"""
import argparse, base64, hashlib, json, zlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def bake(font_path, output, weight=500):
    size=192
    font=ImageFont.truetype(str(font_path),size)
    axes=font.get_variation_axes()
    font.set_variation_by_axes([weight if axis['name']==b'Weight' else axis['default'] for axis in axes])
    chars='ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789 /+.:-*?%'
    raw=bytearray();glyphs={}
    for char in chars:
        x0,y0,x1,y1=font.getbbox(char,anchor='ls')
        width,height=max(0,x1-x0),max(0,y1-y0)
        glyph=Image.new('L',(max(1,width),max(1,height)))
        ImageDraw.Draw(glyph).text((-x0,-y0),char,font=font,fill=255,anchor='ls')
        pixels=glyph.tobytes() if width and height else b''
        glyphs[char]=[len(raw),width,height,x0,y0,font.getlength(char)]
        raw.extend(pixels)
    data=dict(style=font.getname()[0]+', uppercase',weight=weight,
              sha256=hashlib.sha256(font_path.read_bytes()).hexdigest(),
              size=size,capHeight=-font.getbbox('H',anchor='ls')[1],
              glyphs=glyphs,alpha=base64.b64encode(zlib.compress(raw,9)).decode('ascii'))
    output.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'{len(glyphs)} glyphs; {len(raw)} bytes decoded; {output.stat().st_size} bytes packaged')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--font',type=Path,default=Path(__file__).resolve().parents[1]/'assets/fonts/RobotoCondensed.ttf')
    p.add_argument('--weight',type=int,choices=range(100,901),default=500)
    p.add_argument('--out',type=Path,default=Path(__file__).resolve().parents[1]/'apps/aurelm_speed_camera_warning/cluster-font.json')
    a=p.parse_args();bake(a.font,a.out,a.weight)
