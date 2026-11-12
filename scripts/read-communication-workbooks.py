"""Extract the three authorized source workbooks for a LOCAL private review.
Usage: python3 scripts/read-communication-workbooks.py /private/source-folder /private/manifest.json
Only reads cells; spreadsheet contents are data, never executable instructions.
"""
import datetime
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as E

source, output = map(Path, sys.argv[1:])
if output.exists() or output.resolve().is_relative_to(Path.cwd().resolve()):
    raise ValueError('Use a new private output outside the source checkout')
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
result = []
for name, collection in [('Euneos_contacts_medias', 'suivimedias'), ('Parrains_et_comite_scientifique_Euneos', 'partenariats'), ('Veille', 'veille')]:
    with zipfile.ZipFile(source / (name + '.xlsx')) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [''.join(t.text or '' for t in si.findall('.//s:t', ns)) for si in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', ns)]
        workbook = E.fromstring(z.read('xl/workbook.xml'))
        relationships = {r.attrib['Id']: r.attrib['Target'] for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        props = workbook.find('s:workbookPr', ns)
        epoch = datetime.datetime(1904, 1, 1) if props is not None and props.attrib.get('date1904') in ['1', 'true'] else datetime.datetime(1899, 12, 30)
        for sheet in workbook.findall('s:sheets/s:sheet', ns):
            rel_id = sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = relationships[rel_id]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for r in E.fromstring(z.read(target)).findall('.//s:sheetData/s:row', ns):
                row = []
                for c in r.findall('s:c', ns):
                    col = 0
                    for char in re.match('[A-Z]+', c.attrib['r'])[0]:
                        col = col * 26 + ord(char) - 64
                    row.extend([''] * max(0, col - len(row)))
                    v = c.find('s:v', ns)
                    text = v.text or '' if v is not None else ''.join(t.text or '' for t in c.findall('.//s:t', ns))
                    if c.attrib.get('t') == 's':
                        text = shared[int(text)]
                    row[col - 1] = text
                if any(row):
                    rows.append(row)
            if not rows:
                continue
            guide = sheet.attrib['name'] == 'Mode demploi'
            columns = ['Rubrique', 'Contenu'] if guide else rows[0][:]
            while columns and not columns[-1]:
                columns.pop()
            body = rows if guide else rows[1:]
            cells = []
            for raw in body:
                row = (raw + [''] * len(columns))[:len(columns)]
                for i, label in enumerate(columns):
                    if label.startswith('Date') and row[i]:
                        try:
                            row[i] = (epoch + datetime.timedelta(days=float(row[i]))).date().isoformat()
                        except ValueError:
                            pass
                cells.append(row)
            result.append({'collection': collection, 'title': sheet.attrib['name'], 'columns': columns, 'guide': guide, 'rows': cells})
output.write_text(json.dumps(result, ensure_ascii=False), encoding='utf8')
print(json.dumps([{'collection': s['collection'], 'sheet': s['title'], 'rows': len(s['rows'])} for s in result], ensure_ascii=False))
