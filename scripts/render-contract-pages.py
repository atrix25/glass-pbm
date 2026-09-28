"""Render unaltered source pages for the review UI. Requires PyMuPDF."""
import hashlib
import json
from pathlib import Path
import fitz

root = Path(__file__).resolve().parents[1]
source = json.loads((root / 'data/contract-extraction/wisconsin.json').read_text())
pdf = root / 'public/contracts/wisconsin-etg0013-amendment-1.pdf'
assert hashlib.sha256(pdf.read_bytes()).hexdigest() == source['sha256'], 'Source PDF changed'
output = root / 'public/contracts/wisconsin-etg0013-amendment-1'
output.mkdir(exist_ok=True)
doc = fitz.open(pdf)
for page in source['pages']:
    doc[page['page'] - 1].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(output / f"page-{page['page']}.png")

# Word geometry is tied to this exact PDF. Images remain unaltered.
geometry = {'sha256': source['sha256'], 'pages': []}
for item in source['pages']:
    page = doc[item['page'] - 1]
    geometry['pages'].append({
        'page': item['page'], 'width': page.rect.width, 'height': page.rect.height,
        'words': [{'text': w[4], 'box': [round(n, 3) for n in w[:4]],
                   'line': f'{w[5]}:{w[6]}'} for w in page.get_text('words')]
    })
(root / 'data/contract-extraction/wisconsin-geometry.json').write_text(json.dumps(geometry, separators=(',', ':')) + '\n')
