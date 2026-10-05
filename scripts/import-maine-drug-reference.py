"""Read the public MHDO workbook without modifying it. No inferred MONY codes or dates."""
import collections,hashlib,json,re,xml.etree.ElementTree as ET,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
folder=root/'data/public-drug-reference/maine'
p=folder/'top-100-most-costly-prescribed-231116.xlsx'
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p) as z:
 strings=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
 rows=[]
 for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:row',ns):
  cells={}
  for cell in row.findall('s:c',ns):
   value=cell.find('s:v',ns);value=value.text if value is not None else ''
   cells[re.sub(r'\d','',cell.get('r'))]=strings[int(value)] if cell.get('t')=='s' and value else value
  if int(row.get('r'))<=5 or not cells.get('C'):continue
  if not re.fullmatch(r'\d{11}',cells['C']):raise ValueError('Invalid source NDC at row '+row.get('r'))
  category=cells['A']
  if not (category.startswith('Generic ') or category.startswith('Brand ')):raise ValueError('Unrecognized report category')
  rows.append({'sourceRow':int(row.get('r')),'ndc11':cells['C'],'reportCategory':category,'manufacturer':cells['B'].strip(),'description':cells['D'],'therapeuticClass':cells['E'],'publishedSourceType':cells['F'],'reportedBrandGeneric':'generic' if category.startswith('Generic ') else 'brand','classificationBasis':'MHDO Top 100 List category; not a raw Medi-Span brand flag','averageWacSourceValue':cells['G'],'classificationEffectiveDate':None,'rawMediSpanMonyCode':None,'sourceCells':cells})
assert len(rows)==282,'Does not match publisher total'
assert len({r['ndc11'] for r in rows})==282,'Duplicate NDCs'
assert all(r['publishedSourceType'] in ['Single Source','Multi-Source'] for r in rows)
(folder/'records.json').write_text(json.dumps(rows,indent=2)+'\n')
summary={'records':len(rows),'uniqueNdcs':len({r['ndc11'] for r in rows}),'sourceTypes':dict(collections.Counter(r['publishedSourceType'] for r in rows)),'genericSingleSourceNdcs':[r['ndc11'] for r in rows if r['reportedBrandGeneric']=='generic' and r['publishedSourceType']=='Single Source'],'checks':['Publisher total of 282 matched','All NDCs have 11 digits; leading zeroes preserved','No duplicate NDCs','Every record retains source row and original cells'],'notTested':['Contract compliance','Actual claim adjudication','Guarantee calculations','Historical classification accuracy']}
(folder/'import-checks.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
