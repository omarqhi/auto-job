import sys, zipfile, re
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
z = zipfile.ZipFile(sys.argv[1])
root = ET.fromstring(z.read('word/document.xml'))
body = root.find(W + 'body')

def para_text(p):
    out = []
    for el in p.iter():
        if el.tag == W + 't' and el.text: out.append(el.text)
        elif el.tag == W + 'tab': out.append('\t')
        elif el.tag == W + 'br': out.append('\n')
    return ''.join(out)

def para_meta(p):
    ppr = p.find(W + 'pPr')
    style = ''
    bullet = False
    if ppr is not None:
        s = ppr.find(W + 'pStyle')
        if s is not None: style = s.get(W + 'val', '')
        bullet = ppr.find(W + 'numPr') is not None
    bold = any(r.find(W + 'rPr/' + W + 'b') is not None for r in p.findall(W + 'r'))
    return style, bullet, bold

for el in body:
    if el.tag == W + 'p':
        t = para_text(el)
        style, bullet, bold = para_meta(el)
        if not t.strip(): print(''); continue
        print(f'[{style or "-"}{"|bullet" if bullet else ""}{"|bold" if bold else ""}] {t}')
    elif el.tag == W + 'tbl':
        for row in el.iter(W + 'tr'):
            cells = [' / '.join(para_text(p) for p in c.iter(W + 'p') if para_text(p).strip()) for c in row.findall(W + 'tc')]
            print('[TABLE] ' + ' || '.join(cells))
