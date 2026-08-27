#!/usr/bin/env python3

import argparse
import json
import re
import shutil
import unicodedata
from pathlib import Path

from docx import Document


HEADINGS = ['產品名稱：', '功效副標：', '產品介紹：', '產品特色：', '主要成分：', '適用膚況：', '產品規格：']
ALIASES = {
    '棉花水光管理': '棉花水光套組',
    'CP50安瓶組': 'C.P50安瓶組',
    '金箔貼片': '金箔片',
    '積雪草毛孔安瓶': '急救安瓶-積雪草毛孔',
    '維他命美白安瓶': '急救安瓶-維他命美白',
    '水合複合安瓶': '急救安瓶-水合複合',
    '胜肽再生安瓶': '急救安瓶-胜肽再生',
    '精萃防曬乳': '精萃防曬霜',
}


def norm(value):
    value = unicodedata.normalize('NFKC', value)
    return re.sub(r'[\s.·・_－—-]+', '', value).lower()


def chinese_name(value):
    return re.sub(r'\s*\([^\n]*\)\s*$', '', value).strip()


def split_doc_products(docx_path):
    doc = Document(docx_path)
    lines = []
    for paragraph in doc.paragraphs:
        text = paragraph.text.replace('\r', '')
        if not text.strip():
            lines.append('')
            continue
        parts = text.split('\n')
        if paragraph.style.name == 'MdListItem':
            parts[0] = '• ' + parts[0].lstrip('• ').strip()
        lines.extend(parts)

    starts = [i for i, line in enumerate(lines) if line.startswith('產品名稱：')]
    products = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        block = lines[start:end]
        products.append(parse_doc_block(block))
    return products


def parse_doc_block(lines):
    markers = {}
    for index, line in enumerate(lines):
        for heading in HEADINGS:
            if line.startswith(heading) and heading not in markers:
                markers[heading] = index
    raw_name = lines[0].split('：', 1)[1].strip()
    implicit_spec_start = next((
        index for index, line in enumerate(lines)
        if re.match(r'^\s*(?:\[規格\d+\]|規格名稱：|專業價：|市場價：)', line)
    ), len(lines))

    def inline(heading):
        index = markers.get(heading)
        if index is None:
            return None
        return lines[index][len(heading):].strip() or None

    def section(heading, following):
        index = markers.get(heading)
        if index is None:
            return None
        result = []
        first = lines[index][len(heading):].strip()
        if first:
            result.append(first)
        stops = [markers[h] for h in following if h in markers]
        if heading != '產品規格：' and implicit_spec_start > index:
            stops.append(implicit_spec_start)
        stop = min(stops or [len(lines)])
        result.extend(lines[index + 1:stop])
        while result and not result[0].strip(): result.pop(0)
        while result and not result[-1].strip(): result.pop()
        return result

    name = chinese_name(raw_name)
    description = section('產品介紹：', ['產品特色：', '主要成分：', '適用膚況：', '產品規格：'])
    features = section('產品特色：', ['主要成分：', '適用膚況：', '產品規格：'])
    ingredients = section('主要成分：', ['適用膚況：', '產品規格：'])
    skin = section('適用膚況：', ['產品規格：'])
    explicit_spec = markers.get('產品規格：')
    spec_start = explicit_spec + 1 if explicit_spec is not None else implicit_spec_start
    specs = []
    if spec_start < len(lines):
        for line in lines[spec_start:]:
            stripped = line.strip()
            if re.match(r'^(?:\[規格\d+\]|規格名稱：|專業價：|市場價：)', stripped):
                specs.append(stripped)
    return {
        'wordName': name,
        'subtitle': inline('功效副標：'),
        'description': description,
        'features': features,
        'ingredients': ingredients,
        'skin': skin,
        'specs': specs,
    }


def parse_txt(text, path):
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    positions = {}
    for index, line in enumerate(lines):
        for heading in HEADINGS:
            if line.startswith(heading):
                positions[heading] = index
    missing = [heading for heading in HEADINGS if heading not in positions]
    if missing:
        raise ValueError(f'{path}: missing {", ".join(missing)}')
    name = lines[positions['產品名稱：']][len('產品名稱：'):].strip()
    subtitle = lines[positions['功效副標：']][len('功效副標：'):].strip()

    def section(start_heading, end_heading):
        values = lines[positions[start_heading] + 1:positions[end_heading]]
        while values and not values[0].strip(): values.pop(0)
        while values and not values[-1].strip(): values.pop()
        return values

    fields = {
        'subtitle': subtitle,
        'description': section('產品介紹：', '產品特色：'),
        'features': section('產品特色：', '主要成分：'),
        'ingredients': section('主要成分：', '適用膚況：'),
        'skin': section('適用膚況：', '產品規格：'),
    }
    spec_lines = lines[positions['產品規格：'] + 1:]
    while spec_lines and not spec_lines[0].strip(): spec_lines.pop(0)
    while spec_lines and not spec_lines[-1].strip(): spec_lines.pop()
    return name, fields, spec_lines


def comparable_specs(lines):
    text = '\n'.join(lines)
    text = unicodedata.normalize('NFKC', text).lower()
    text = text.replace('nt$', '').replace('元', '')
    text = re.sub(r'[×*]', 'x', text)
    text = re.sub(r'[ \t]+', '', text)
    text = text.replace('/', '\n')
    fields = re.findall(r'(規格名稱|專業價|市場價)[:：]?([^\n\[]+)', text)
    fields_result = []
    for key, value in fields:
        value = value.strip()
        if key == '規格名稱':
            value = value.replace('pcs', '件').replace('支', '件').replace('片', '件').replace('／盒', '')
        fields_result.append((key, value))
    records = []
    active = None
    for key, value in fields_result:
        if key == '規格名稱':
            if active: records.append(active)
            active = {'規格名稱': value}
        elif active is not None:
            active[key] = value
    if active: records.append(active)
    return [
        (record.get('規格名稱', ''), record.get('專業價', ''), record.get('市場價', '無'))
        for record in records
    ]


def bullet_lines(lines):
    if len(lines) == 1 and lines[0].strip() == '無':
        return ['無']
    return ['• ' + re.sub(r'^[•✨\-]\s*', '', line).strip() for line in lines if line.strip()]


def render_txt(existing_name, existing, word):
    merged = {
        field: word[field] if word[field] is not None else existing[field]
        for field in ['subtitle', 'description', 'features', 'ingredients', 'skin']
    }
    output = [
        f'產品名稱：{existing_name}',
        f'功效副標：{merged["subtitle"]}',
        '',
        '產品介紹：',
        *merged['description'],
        '',
        '產品特色：',
        *(bullet_lines(merged['features']) if word['features'] is not None else merged['features']),
        '',
        '主要成分：',
        *(bullet_lines(merged['ingredients']) if word['ingredients'] is not None else merged['ingredients']),
        '',
        '適用膚況：',
        *merged['skin'],
        '',
        '產品規格：',
        '',
    ]
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('docx', type=Path)
    parser.add_argument('root', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup-root', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()

    folders = {norm(path.name): path for path in args.root.iterdir() if path.is_dir()}
    alias_norm = {norm(key): value for key, value in ALIASES.items()}
    report = []
    for word in split_doc_products(args.docx):
        key = norm(word['wordName'])
        target_name = alias_norm.get(key, word['wordName'])
        folder = folders.get(norm(target_name))
        if not folder:
            report.append({'wordName': word['wordName'], 'status': 'no-folder-match'})
            continue
        txts = list(folder.glob('*.txt'))
        if len(txts) != 1:
            report.append({'wordName': word['wordName'], 'folder': folder.name, 'status': 'txt-count', 'count': len(txts)})
            continue
        txt = txts[0]
        old_text = txt.read_text(encoding='utf-8')
        existing_name, existing_fields, existing_specs = parse_txt(old_text, txt)
        spec_diff = comparable_specs(existing_specs) != comparable_specs(word['specs'])
        prefix = render_txt(existing_name, existing_fields, word)
        new_text = '\n'.join(prefix + existing_specs).rstrip() + '\n'
        field_updates = [
            field for field in ['subtitle', 'description', 'features', 'ingredients', 'skin']
            if word[field] is not None
        ]
        item = {
            'wordName': word['wordName'], 'folder': folder.name, 'txt': str(txt),
            'status': 'matched', 'changed': new_text != old_text,
            'fieldUpdates': field_updates,
            'specDifferent': spec_diff,
            'txtSpecs': existing_specs, 'wordSpecs': word['specs'],
        }
        if args.apply and new_text != old_text:
            if not args.backup_root:
                raise ValueError('--backup-root is required with --apply')
            backup = args.backup_root / folder.name / txt.name
            backup.parent.mkdir(parents=True, exist_ok=True)
            if backup.exists():
                raise FileExistsError(backup)
            shutil.copy2(txt, backup)
            txt.write_text(new_text, encoding='utf-8')
            item['status'] = 'updated'
            item['backup'] = str(backup)
        report.append(item)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    summary = {}
    for item in report: summary[item['status']] = summary.get(item['status'], 0) + 1
    summary['specDifferent'] = sum(bool(item.get('specDifferent')) for item in report)
    print(json.dumps({'mode': 'apply' if args.apply else 'dry-run', 'summary': summary, 'report': str(args.report)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
