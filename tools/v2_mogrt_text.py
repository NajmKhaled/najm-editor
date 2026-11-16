"""Make a text-only variant of a Premiere-native MOGRT without changing its style."""
from __future__ import annotations

import argparse
import base64
import gzip
import io
import json
import re
import struct
import zipfile
from html import escape
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('template', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('texts', nargs='+')
    args = parser.parse_args()
    with zipfile.ZipFile(args.template) as source:
        definition = json.loads(source.read('definition.json').decode('utf-8'))
        controls = [control for control in definition['clientControls'] if control.get('type') == 6]
        if len(controls) != len(args.texts):
            raise ValueError(f'Template exposes {len(controls)} text controls, got {len(args.texts)} values')
        project_zip = zipfile.ZipFile(io.BytesIO(source.read('project.prgraphic')))
        project_name = project_zip.namelist()[0]
        project_xml = gzip.decompress(project_zip.read(project_name)).decode('utf-8')
        for control, new_text in zip(controls, args.texts):
            original = control['value']['strDB'][0]['str']
            if not new_text.strip():
                raise ValueError('MOGRT text must be non-empty')
            for row in control['value']['strDB']:
                row['str'] = new_text
            original_node = f'<InstanceName>{escape(original)}</InstanceName>'
            replacement_node = f'<InstanceName>{escape(new_text)}</InstanceName>'
            if original_node not in project_xml:
                raise ValueError('Template project text instance not found: ' + original)
            project_xml = project_xml.replace(original_node, replacement_node, 1)
            original_bytes = original.encode('utf-8')
            new_bytes = new_text.encode('utf-8')
            hits = [0]
            def rewrite(match):
                raw = bytearray(base64.b64decode(''.join(match.group(2).split())))
                start = raw.find(original_bytes)
                if start < 0:
                    return match.group(0)
                if raw.find(original_bytes, start + 1) >= 0:
                    raise ValueError('Duplicate text in Source Text payload')
                hits[0] += 1
                length_at = start - 4
                if length_at < 0 or struct.unpack_from('<I', raw, length_at)[0] != len(original_bytes):
                    raise ValueError('Source Text is not a length-prefixed UTF-8 string')
                pointers = [p for p in range(0, length_at, 4) if p + struct.unpack_from('<I', raw, p)[0] == length_at]
                if len(pointers) != 1:
                    raise ValueError('Source Text string pointer is ambiguous: ' + str(pointers))
                pointer = pointers[0]
                if len(raw) % 4:
                    raise ValueError('Source Text payload is not 4-byte aligned')
                new_at = len(raw)
                struct.pack_into('<I', raw, pointer, new_at - pointer)
                raw.extend(struct.pack('<I', len(new_bytes)))
                raw.extend(new_bytes)
                raw.append(0)
                raw.extend(b'\0' * (-len(raw) % 4))
                struct.pack_into('<I', raw, 0, len(raw) - 12)
                heading = re.sub(r'(BinaryHash="[0-9a-f-]{28})[0-9a-f]{8}(?=")', lambda m: m.group(1) + format(len(raw) + 12, '08x'), match.group(1), count=1)
                return heading + base64.b64encode(raw).decode('ascii') + match.group(3)
            project_xml = re.sub(r'(<StartKeyframeValue[^>]*>)(.*?)(</StartKeyframeValue>)', rewrite, project_xml, flags=re.DOTALL)
            if hits[0] != 1:
                raise ValueError('Expected one Source Text payload, found ' + str(hits[0]))
        project_buffer = io.BytesIO()
        with zipfile.ZipFile(project_buffer, 'w') as target_project:
            for item in project_zip.infolist():
                data = gzip.compress(project_xml.encode('utf-8'), mtime=0) if item.filename == project_name else project_zip.read(item.filename)
                target_project.writestr(item, data)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.output, 'w') as target:
            for item in source.infolist():
                data = (json.dumps(definition, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                        if item.filename == 'definition.json' else
                        project_buffer.getvalue() if item.filename == 'project.prgraphic' else
                        source.read(item.filename))
                target.writestr(item, data)
    with zipfile.ZipFile(args.output) as check:
        if check.testzip() is not None:
            raise ValueError('Generated MOGRT archive failed CRC validation')
        values = [c['value']['strDB'][0]['str'] for c in json.loads(check.read('definition.json'))['clientControls'] if c.get('type') == 6]
        if values != args.texts:
            raise ValueError('Generated MOGRT text readback failed')


if __name__ == '__main__':
    main()
