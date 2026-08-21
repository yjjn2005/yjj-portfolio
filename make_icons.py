from PIL import Image, ImageDraw
import math, os

def draw(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0,0,0,0))
    d = ImageDraw.Draw(img)
    pad = int(size*0.10) if maskable else 0
    # 배경 그라데이션
    for y in range(size):
        t = y/max(1,size-1)
        r = int(0x11 + (0x7c-0x11)*t*0.85)
        g = int(0x16 + (0x5c-0x16)*t*0.55)
        b = int(0x33 + (0xff-0x33)*t*0.75)
        d.line([(0,y),(size,y)], fill=(r,g,b,255))
    if not maskable:
        m = Image.new("L",(size,size),0)
        ImageDraw.Draw(m).rounded_rectangle([0,0,size-1,size-1], radius=int(size*0.22), fill=255)
        img.putalpha(m)
    # 상승 차트 라인
    inner = size - pad*2
    pts = [(0.14,0.72),(0.32,0.55),(0.46,0.63),(0.62,0.36),(0.78,0.44),(0.88,0.26)]
    xy = [(pad+p[0]*inner, pad+p[1]*inner) for p in pts]
    d.line(xy, fill=(255,255,255,240), width=max(3,int(size*0.055)), joint="curve")
    for p in xy:
        r = max(2,int(size*0.028))
        d.ellipse([p[0]-r,p[1]-r,p[0]+r,p[1]+r], fill=(255,255,255,255))
    # 막대
    for i,(bx,bh) in enumerate([(0.20,0.14),(0.36,0.20),(0.52,0.12),(0.68,0.26)]):
        x = pad+bx*inner; w = inner*0.09; h = inner*bh
        d.rounded_rectangle([x, pad+inner*0.86-h, x+w, pad+inner*0.86],
                            radius=int(size*0.015), fill=(255,255,255,110))
    return img

os.makedirs("docs", exist_ok=True)
draw(192).save("docs/icon-192.png")
draw(512).save("docs/icon-512.png")
draw(512, True).save("docs/icon-maskable.png")
print("icons ok")
