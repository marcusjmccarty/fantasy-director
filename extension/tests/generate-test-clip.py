"""Generate original silent test footage; Pillow is a development-only dependency.

Each WebP VP8 keyframe is placed in a small WebM container. No downloaded media.
"""
from pathlib import Path
from io import BytesIO
import struct
from PIL import Image, ImageDraw

def size(n):
    for width in range(1, 9):
        if n < (1 << (7 * width)) - 1:
            return ((1 << (7 * width)) | n).to_bytes(width, 'big')
    raise ValueError('Element too large')

def element(tag, value):
    return bytes.fromhex(tag) + size(len(value)) + value

def integer(tag, value):
    return element(tag, value.to_bytes(max(1, (value.bit_length() + 7) // 8), 'big'))

header = element('1a45dfa3', integer('4286', 1) + integer('42f7', 1) + integer('42f2', 4) + integer('42f3', 8) + element('4282', b'webm') + integer('4287', 2) + integer('4285', 2))
info = element('1549a966', integer('2ad7b1', 1000000) + element('4489', struct.pack('>d', 6000)) + element('4d80', b'Fantasy Director') + element('5741', b'Fantasy Director'))
track = integer('d7', 1) + integer('73c5', 1) + integer('83', 1) + element('86', b'V_VP8')
track += integer('23e383', 100000000) + element('e0', integer('b0', 320) + integer('ba', 180))
tracks = element('1654ae6b', element('ae', track))
blocks = []
for frame in range(60):
    picture = Image.new('RGB', (320, 180), '#101b17')
    draw = ImageDraw.Draw(picture)
    for x in range(20, 301, 28):
        draw.line((x, 35, x, 145), fill='#364d3d')
    x = 20 + round(frame * 270 / 59)
    draw.ellipse((x, 82, x + 12, 98), fill='#d8ed72')
    draw.rectangle((20, 155, x + 10, 158), fill='#d8ed72')
    draw.text((20, 12), 'FICTIONAL REPLAY TEST', fill='#e5eadf')
    out = BytesIO(); picture.save(out, 'WEBP', quality=40)
    riff = out.getvalue(); offset = 12; payload = None
    while offset + 8 <= len(riff):
        name = riff[offset:offset + 4]; length = int.from_bytes(riff[offset + 4:offset + 8], 'little')
        if name == b'VP8 ': payload = riff[offset + 8:offset + 8 + length]; break
        offset += 8 + length + (length % 2)
    assert payload and payload[3:6] == b'\x9d\x01\x2a', 'Expected a VP8 keyframe'
    blocks.append(element('a3', b'\x81' + struct.pack('>h', frame * 100) + b'\x80' + payload))
cluster = element('1f43b675', integer('e7', 0) + b''.join(blocks))
destination = Path(__file__).resolve().parents[1] / 'assets' / 'rehearsal.webm'
destination.parent.mkdir(exist_ok=True)
destination.write_bytes(header + element('18538067', info + tracks + cluster))
print(f'{destination.name}: {destination.stat().st_size} bytes, 60 VP8 keyframes, 6 seconds')
