"""Decode the submitted image and cut normalized evidence windows."""
import base64
import io
import json
import math
import sys

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 20_000_000
request = json.load(sys.stdin)
image_bytes = base64.b64decode(request["image"].split(",", 1)[1], validate=True)
with Image.open(io.BytesIO(image_bytes)) as original:
    if original.width * original.height > Image.MAX_IMAGE_PIXELS:
        raise ValueError("Image dimensions exceed crop limit")
    image = ImageOps.exif_transpose(original).convert("RGB")

width, height = image.size
output = {}
for part in request["parts"]:
    region = part["region"]
    left = min(width - 1, math.floor(region["x"] * width))
    top = min(height - 1, math.floor(region["y"] * height))
    right = min(width, max(left + 1, math.ceil((region["x"] + region["w"]) * width)))
    bottom = min(height, max(top + 1, math.ceil((region["y"] + region["h"]) * height)))
    crop = image.crop((left, top, right, bottom))
    crop.thumbnail((512, 512), Image.Resampling.LANCZOS)
    encoded = io.BytesIO()
    crop.save(encoded, format="JPEG", quality=88)
    output[part["id"]] = "data:image/jpeg;base64," + base64.b64encode(encoded.getvalue()).decode("ascii")
json.dump(output, sys.stdout)
