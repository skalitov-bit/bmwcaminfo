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
    chars='ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789 /+.:-*?%!>м'
    raw=bytearray();glyphs={}
    for char in chars:
        x0,y0,x1,y1=font.getbbox(char,anchor='ls')
        width,height=max(0,x1-x0),max(0,y1-y0)
        glyph=Image.new('L',(max(1,width),max(1,height)))
        ImageDraw.Draw(glyph).text((-x0,-y0),char,font=font,fill=255,anchor='ls')
        pixels=glyph.tobytes() if width and height else b''
        glyphs[char]=[len(raw),width,height,x0,y0,font.getlength(char)]
        raw.extend(pixels)
    # Code-native satellite icon, baked into the same offline atlas as text.
    icon=Image.new('L',(192,160));draw=ImageDraw.Draw(icon)
    draw.rectangle((77,55,115,101),fill=255)
    draw.line((58,78,134,78),fill=255,width=9)
    for left in (12,132):
        draw.rectangle((left,52,left+48,104),outline=255,width=9)
        draw.line((left+24,54,left+24,102),fill=255,width=6)
        draw.line((left+2,78,left+46,78),fill=255,width=6)
    draw.line((96,55,96,34),fill=255,width=6)
    draw.arc((78,13,114,49),0,180,fill=255,width=6)
    draw.arc((116,12,158,54),195,270,fill=255,width=5)
    draw.arc((116,2,168,54),195,270,fill=255,width=5)
    icon=icon.rotate(-25,resample=Image.Resampling.BICUBIC,expand=True)
    icon=icon.crop(icon.getbbox())
    cap=-font.getbbox('H',anchor='ls')[1]
    factor=cap*2/icon.width
    icon=icon.resize((round(icon.width*factor),round(icon.height*factor)),Image.Resampling.LANCZOS)
    iw,ih=icon.size;glyphs['🛰']=[len(raw),iw,ih,0,-ih,iw+18];raw.extend(icon.tobytes())
    data=dict(style=font.getname()[0]+', uppercase and metre glyph',weight=weight,
              sha256=hashlib.sha256(font_path.read_bytes()).hexdigest(),
              glyphSha256=hashlib.sha256(raw).hexdigest(),
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
