"""Check that a Premiere graphic changed pixels in its expected screen region."""
import argparse
import json
from PIL import Image, ImageChops


def main():
    p = argparse.ArgumentParser()
    p.add_argument('before')
    p.add_argument('after')
    p.add_argument('region', choices=('caption', 'title'))
    args = p.parse_args()
    a = Image.open(args.before).convert('RGB')
    b = Image.open(args.after).convert('RGB')
    if a.size != b.size:
        raise ValueError('Premiere frames differ in dimensions')
    w, h = a.size
    region = (int(w * .05), int(h * (.56 if args.region == 'caption' else .20)),
              int(w * .95), int(h * (.75 if args.region == 'caption' else .43)))
    delta = ImageChops.difference(a.crop(region), b.crop(region))
    changed = sum(max(pixel) >= 55 for pixel in delta.get_flattened_data())
    result = {'region': args.region, 'changedPixels': changed, 'pass': changed >= 80}
    print(json.dumps(result))
    if not result['pass']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
