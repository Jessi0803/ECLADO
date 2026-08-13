#!/usr/bin/env python3

import argparse
import json
import math
import shutil
from pathlib import Path

from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--backup-root', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--alpha-threshold', type=int, default=8)
    parser.add_argument('--report', type=Path, required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    results = []
    for source in sorted(args.root.glob('*/首圖.png')):
        with Image.open(source) as opened:
            rgba = opened.convert('RGBA')
        alpha = rgba.getchannel('A')
        alpha_min, alpha_max = alpha.getextrema()
        if alpha_min == 255:
            results.append({
                'product': source.parent.name,
                'source': str(source),
                'status': 'skipped-no-transparency',
                'size': list(rgba.size),
            })
            continue

        mask = alpha.point(lambda value: 255 if value > args.alpha_threshold else 0)
        bbox = mask.getbbox()
        if not bbox:
            results.append({'product': source.parent.name, 'source': str(source), 'status': 'skipped-empty'})
            continue

        content = rgba.crop(bbox)
        content_width, content_height = content.size
        # A 5/6 content ratio leaves at least 1/12 transparent space on both
        # sides of the content's longest axis.
        canvas_side = max(12, math.ceil(max(content_width, content_height) * 6 / 5))
        left = (canvas_side - content_width) // 2
        top = (canvas_side - content_height) // 2
        output = Image.new('RGBA', (canvas_side, canvas_side), (0, 0, 0, 0))
        output.alpha_composite(content, (left, top))

        result = {
            'product': source.parent.name,
            'source': str(source),
            'status': 'ready' if not args.apply else 'normalized',
            'originalSize': list(rgba.size),
            'contentBounds': list(bbox),
            'contentSize': [content_width, content_height],
            'outputSize': [canvas_side, canvas_side],
            'margins': {
                'left': left,
                'right': canvas_side - left - content_width,
                'top': top,
                'bottom': canvas_side - top - content_height,
            },
        }
        if args.apply:
            backup = args.backup_root / source.parent.name / source.name
            backup.parent.mkdir(parents=True, exist_ok=True)
            if backup.exists():
                raise RuntimeError(f'Backup already exists: {backup}')
            shutil.copy2(source, backup)
            temporary = source.with_name('首圖.normalized.tmp.png')
            output.save(temporary, 'PNG', optimize=True)
            temporary.replace(source)
            result['backup'] = str(backup)
        results.append(result)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    summary = {}
    for result in results:
        summary[result['status']] = summary.get(result['status'], 0) + 1
    print(json.dumps({'mode': 'apply' if args.apply else 'dry-run', 'summary': summary, 'report': str(args.report)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
