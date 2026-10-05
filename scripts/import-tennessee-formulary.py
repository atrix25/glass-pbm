"""Extract published table cells and row geometry. No expected answers or invented data."""
from pathlib import Path
import hashlib,json,re
import pdfplumber
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'public/reference/tennessee/2026-10/formulary.pdf'
rows=[]
with pdfplumber.open(path) as pdf:
 assert 'Effective October 1, 2026' in pdf.pages[0].extract_text()
 for number in [22,64,124]:
  page=pdf.pages[number-1]
  for table in page.find_tables():
   for index,(cells,geometry) in enumerate(zip(table.extract(),table.rows)):
    if len(cells)!=4: continue  # Footer/legend tables are not drug records.
    if cells[1]=='Drug Name' or cells[1] is None: continue
    raw=cells[1] or ''
    assert 'Brand drug' in raw or 'Generic drug' in raw, raw
    label='Brand drug' if 'Brand drug' in raw else 'Generic drug'
    name=re.sub(r'\s+',' ',raw.replace(label,'')).strip()
    boxes=[c for c in geometry.cells if c]
    x0=min(b[0] for b in boxes); y0=min(b[1] for b in boxes);x1=max(b[2] for b in boxes);y1=max(b[3] for b in boxes)
    rows.append(dict(id=f'p{number}-r{index}',page=number,name=name,cells=dict(drug=raw,tier=cells[2],limits=cells[3] or ''),width=page.width,height=page.height,box=dict(x=x0,y=y0,width=x1-x0,height=y1-y0)))
  page.to_image(resolution=144).save(path.parent/f'page-{number}.png')
 metadata=dict(id='tn-formulary-2026-10',title='Tennessee prescribing guide',effectiveDate='2026-10-01',retrievedOn='2026-10-05',url='https://www.caremark.com/portal/asset/state_tn_formulary.pdf',localUrl='/reference/tennessee/2026-10/formulary.pdf',sha256=hashlib.sha256(path.read_bytes()).hexdigest(),totalPages=len(pdf.pages),selectedPages=[22,64,124],rows=rows)
 for number in [1,19,20,21]:
  pdf.pages[number-1].to_image(resolution=144).save(path.parent/f'page-{number}.png')
 metadata['supportingText']=[dict(page=n,text=pdf.pages[n-1].extract_text()) for n in [1,19,20,21]]
(ROOT/'data/formulary-checks/tennessee.json').write_text(json.dumps(metadata,indent=2)+'\n')
old=ROOT/'public/reference/tennessee/2025-10/drug-list.pdf'
with pdfplumber.open(old) as pdf:
 assert 'October 2025' in pdf.pages[0].extract_text()
 prior=dict(title='Tennessee preferred drug list',effectiveDate='2025-10',retrievedOn='2026-10-05',url='https://www.tn.gov/content/dam/tn/partnersforhealth/documents/sot_pdl_sc_acsf.pdf',localUrl='/reference/tennessee/2025-10/drug-list.pdf',sha256=hashlib.sha256(old.read_bytes()).hexdigest(),totalPages=len(pdf.pages),status='Source only; not processed')
(ROOT/'data/formulary-checks/tennessee-2025.json').write_text(json.dumps(prior,indent=2)+'\n')
print('Published rows:',len(rows));print([(r['id'],r['name'],r['cells']['tier'],r['cells']['limits']) for r in rows if any(s in r['name'] for s in ['ADDERALL TAB 5MG','sulfate tabs','GVOKE KIT','mifepristone','OZEMPIC','saxagliptin','SOFDRA','XERAC','ORACEA','permethrin','PERMETHRIN','EUCRISA'])])
