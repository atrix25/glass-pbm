"""Import OCR observations from ocr-contract-pages.swift. Original PDF is never edited.
Run with PYTHONPATH pointing to PyMuPDF and pass the OCR PNG directory.
Render PDF pages at 2x into that directory first, then run the Swift OCR utility.
"""
import hashlib,json,shutil,sys
from pathlib import Path
import fitz
root=Path(__file__).resolve().parents[1]
ocr=Path(sys.argv[1])
meta=json.loads((root/'public/contracts/tennessee/source.json').read_text())
pdf=root/'public/contracts/tennessee/caremark-31786-00151-redacted.pdf'
assert hashlib.sha256(pdf.read_bytes()).hexdigest()==meta['sha256']
doc=fitz.open(pdf)
selected=[13,14,15,16,17,18,19,20,25,29,31,33,34,35,38,39,40,72,73,74]
source={'id':'tennessee-caremark-31786-00151','title':'Tennessee / Caremark · 2020–2025 contract','url':meta['sourceUrl'],'localUrl':'/contracts/tennessee/caremark-31786-00151-redacted.pdf','sha256':meta['sha256'],'totalPages':len(doc),'scope':'Selected pages from the signed historical base contract: definitions, claims, network, formulary, clinical requirements and financial reconciliation. Public redacted copy. OCR text is not a certified transcription; compare it with the original page image. Financial values and incorporated drug lists may be unavailable. The unsigned proposed amendment on PDF pages 1–10 is excluded. Later amendments and full-contract completeness have not been verified.','pages':[]}
geometry={'sha256':meta['sha256'],'method':'Apple Vision accurate OCR; original line bounding boxes','pages':[]}
out=root/'public/contracts/tennessee/pages';out.mkdir(exist_ok=True)
for n in selected:
 page=doc[n-1];w,h=page.rect.width,page.rect.height
 lines=json.loads((ocr/f'page-{n}.png.json').read_text())
 source['pages'].append({'page':n,'text':'\n'.join(l['text'] for l in lines)})
 words=[]
 for i,line in enumerate(lines):
  box=[round(v*(w if j%2==0 else h),3) for j,v in enumerate(line['box'])]
  # Line boxes deliberately show the surrounding source line, not guessed word positions.
  words.extend({'text':token,'box':box,'line':str(i)} for token in line['text'].split())
 geometry['pages'].append({'page':n,'width':w,'height':h,'words':words})
 shutil.copyfile(ocr/f'page-{n}.png',out/f'page-{n}.png')
(root/'data/contract-extraction/tennessee.json').write_text(json.dumps(source,indent=2)+'\n')
(root/'data/contract-extraction/tennessee-geometry.json').write_text(json.dumps(geometry,separators=(',',':'))+'\n')
print(f'Imported {len(selected)} source pages; proposed amendment excluded.')
