"""Select clear, distinct, time-spread frames into one compact local sheet."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat


def metrics(path):
    with Image.open(path) as source:
        small = source.convert('RGB').resize((64, 64))
    gray = small.convert('L')
    sharp = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).var[0]
    brightness = ImageStat.Stat(gray).mean[0]
    return small, sharp, brightness


def novelty(left, right):
    return sum(ImageStat.Stat(ImageChops.difference(left, right)).mean) / 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('manifest', type=Path)
    ap.add_argument('output', type=Path)
    args = ap.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    candidates = manifest['rows'] if isinstance(manifest, dict) else manifest
    scene_count = manifest.get('sceneChangeCount', 0) if isinstance(manifest, dict) else 0
    duration = manifest.get('duration', 0) if isinstance(manifest, dict) else 0
    evaluated = []
    for row in candidates:
        small, sharp, brightness = metrics(row['path'])
        if 12 < brightness < 246 and sharp > 12:
            evaluated.append((row, small, sharp))
    if not evaluated:
        evaluated = [(row, *metrics(row['path'])[:2]) for row in candidates]
    target = min(len(evaluated), 6 if duration and duration <= 12 else 8)
    if scene_count >= 3 and len(evaluated) >= 10:
        distinct = sum(1 for a, b in zip(evaluated, evaluated[1:]) if novelty(a[1], b[1]) > 13)
        if distinct >= 3:
            target = min(12, len(evaluated))
    chosen = []
    while evaluated and len(chosen) < target:
        best, best_score = None, -1.0
        for entry in evaluated:
            row, small, sharp = entry
            nearest = min((novelty(small, old[1]) for old in chosen), default=60)
            coverage = min((abs(row['time'] - old[0]['time']) for old in chosen), default=100)
            score = min(sharp, 120) * .12 + nearest * 2 + min(coverage, 30)
            if nearest < 5 and len(chosen) >= 4:
                continue
            if score > best_score:
                best, best_score = entry, score
        if best is None:
            break
        chosen.append(best)
        evaluated.remove(best)
    chosen.sort(key=lambda row: row[0]['time'])
    width, cell_h, cols = 1024, 220, 3
    cell_w = width // cols
    row_count = (len(chosen) + cols - 1) // cols
    sheet = Image.new('RGB', (width, row_count * cell_h), '#171717')
    draw = ImageDraw.Draw(sheet)
    for i, (row, _, _) in enumerate(chosen):
        with Image.open(row['path']) as source:
            image = source.convert('RGB')
            image.thumbnail((cell_w - 12, cell_h - 28))
        x = (i % cols) * cell_w + (cell_w - image.width) // 2
        y = (i // cols) * cell_h + 18
        sheet.paste(image, (x, y))
        draw.text(((i % cols) * cell_w + 8, (i // cols) * cell_h + 2), f"{row['time']:.1f}s", fill='white')
        image.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, quality=72, optimize=True)
    sheet.close()
    args.output.with_suffix('.json').write_text(json.dumps({'selected_times': [x[0]['time'] for x in chosen], 'candidate_count': len(candidates), 'scene_change_count': scene_count}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
