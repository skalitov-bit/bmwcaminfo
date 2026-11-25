"""Build monochrome HUD road-sign masks from editable vector contours.

White artwork / transparent interior, following the user's road-sign references.
Supersampling preserves rounded contours in both the PNG and GPU atlas paths.
"""
from pathlib import Path
import base64, hashlib, json, re, zlib
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
S=4

def contour(d):
    tokens=re.findall(r'[MLCZ]|-?\d+(?:\.\d+)?',d)
    points=[];i=0;last=(0,0)
    while i<len(tokens):
        op=tokens[i];i+=1
        if op in ('M','L'):
            last=(float(tokens[i]),float(tokens[i+1]));i+=2;points.append(last)
        elif op=='C':
            x0,y0=last;x1,y1,x2,y2,x3,y3=map(float,tokens[i:i+6]);i+=6
            for step in range(1,65):
                t=step/64;u=1-t
                points.append((u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3))
            last=(x3,y3)
        elif op!='Z':raise ValueError(op)
    return [(round(x*S),round(y*S)) for x,y in points]

school=[
 (255,'M 150 8 C 161 8 168 16 174 27 L 291 235 C 303 257 293 273 271 273 L 29 273 C 7 273 -3 257 9 235 L 126 27 C 132 16 139 8 150 8 Z'),
 (0,'M 150 24 C 155 24 159 30 163 37 L 279 242 C 284 251 280 258 270 258 L 30 258 C 20 258 16 251 21 242 L 137 37 C 141 30 145 24 150 24 Z'),
 # Older child: tilted head, running torso/arms and two separate legs.
 (255,'M 169 108 C 178 94 181 84 174 80 C 163 75 152 86 150 97 C 148 108 159 118 169 108 Z'),
 (255,'M 174 114 L 192 114 L 199 125 L 185 125 L 198 149 C 202 157 199 164 192 168 L 170 181 L 170 218 C 170 227 157 227 157 218 L 157 178 C 157 173 160 170 164 167 L 183 155 L 165 128 C 163 124 168 117 174 114 Z'),
 (255,'M 164 132 L 155 149 L 140 140 C 131 134 124 145 132 151 L 154 165 C 159 168 163 166 166 160 L 174 146 Z'),
 (255,'M 192 170 L 203 190 L 220 180 L 226 191 L 202 206 C 197 209 192 208 189 202 L 179 181 Z'),
 # Younger child.
 (255,'M 122 135 C 129 123 127 115 120 113 C 110 110 100 121 100 131 C 100 141 114 147 122 135 Z'),
 (255,'M 140 109 C 145 101 155 107 151 115 L 137 143 L 148 163 C 151 170 149 175 143 179 L 124 190 L 110 220 C 106 229 93 223 98 214 L 113 181 C 114 178 117 176 120 174 L 132 166 L 120 145 C 118 141 120 137 123 132 Z'),
 (255,'M 111 151 L 99 158 L 92 145 C 88 137 77 143 81 151 L 91 171 C 94 177 98 178 104 175 L 116 168 Z'),
 (255,'M 144 183 L 154 199 L 164 199 L 164 212 L 149 212 C 145 212 142 210 140 206 L 132 192 Z')
]
bump=[
 (255,'M 28 8 L 272 8 C 285 8 292 15 292 28 L 292 272 C 292 285 285 292 272 292 L 28 292 C 15 292 8 285 8 272 L 8 28 C 8 15 15 8 28 8 Z'),
 (0,'M 28 17 L 272 17 C 280 17 283 20 283 28 L 283 272 C 283 280 280 283 272 283 L 28 283 C 20 283 17 280 17 272 L 17 28 C 17 20 20 17 28 17 Z'),
 (255,'M 143 40 C 147 33 153 33 157 40 L 261 225 C 265 233 263 239 254 239 L 46 239 C 37 239 35 233 39 225 L 143 40 Z'),
 (0,'M 150 52 L 249 229 L 51 229 Z'),
 (255,'M 66 208 L 87 208 C 106 208 113 181 150 181 C 187 181 194 208 213 208 L 234 208 L 234 217 L 66 217 Z')
]

for name,size,paths in [('school',(300,280),school),('bump',(300,300),bump)]:
    im=Image.new('L',(size[0]*S,size[1]*S));draw=ImageDraw.Draw(im)
    for color,d in paths:draw.polygon(contour(d),fill=color)
    im=im.resize(size,Image.Resampling.LANCZOS)
    raw=im.tobytes()
    payload={'width':size[0],'height':size[1],'sha256':hashlib.sha256(raw).hexdigest(),'alpha':base64.b64encode(zlib.compress(raw,9)).decode()}
    (ROOT/'apps/aurelm_speed_camera_warning'/f'{name}-icon.json').write_text(json.dumps(payload),encoding='utf-8')
    # Vector source uses a mask so interior holes stay transparent.
    shapes=''.join(f'<path fill="{ "white" if c else "black" }" d="{d}"/>' for c,d in paths)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size[0]} {size[1]}"><defs><mask id="shape">{shapes}</mask></defs><path fill="white" mask="url(#shape)" d="M 0 0 L {size[0]} 0 L {size[0]} {size[1]} L 0 {size[1]} Z"/></svg>'
    (ROOT/'assets'/f'{name}-sign.svg').write_text(svg,encoding='utf-8')
    print(name,size,len(zlib.compress(raw,9)))
