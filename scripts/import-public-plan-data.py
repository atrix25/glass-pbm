"""Import exact public-source rows. Run with the downloaded CMS components directory.
No generated claims, prices, or expected operational outcomes are added.
"""
import csv,datetime,gzip,hashlib,json,pathlib,sys
base=pathlib.Path(sys.argv[1]);dest=pathlib.Path('public/reference/public-data');dest.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
periods=['2026-08','2026-09'];catalog=json.load(open(base/'selected-catalog.json'))
sources=[];records={};counts={}
for period in periods:
 folder=base/period; rows=[]
 for area,prefix in [('plan','plan information'),('formulary','basic drugs'),('benefits','beneficiary cost'),('insulin','insulin beneficiary'),('excluded','excluded drugs'),('indications','indication based')]:
  path=next(p for p in folder.glob('*.txt') if p.name.lower().startswith(prefix));data=path.read_bytes();sid=f'{period}-{area}'
  reader=csv.DictReader(data.decode('cp1252').splitlines(),delimiter='|');selected=[];scanned=0
  for line,r in enumerate(reader,2):
   scanned+=1
   include=r.get('FORMULARY_ID')=='00026007' if area in ['formulary','excluded','indications'] and 'FORMULARY_ID' in r else r.get('CONTRACT_ID')=='S5601' and r.get('PLAN_ID')=='024' and r.get('SEGMENT_ID','000')=='000'
   if include:
    if area=='formulary':key=r['NDC']
    elif area=='benefits':key=':'.join(r[k] for k in ['COVERAGE_LEVEL','TIER','DAYS_SUPPLY'])
    elif area=='insulin':key=r['TIER']+':'+r['DAYS_SUPPLY']
    elif area=='plan':key='S5601:024:000'
    else:key=str(line)
    selected.append({'id':area+':'+key,'area':area,'source':sid,'line':line,'values':r})
  sources.append({'id':sid,'period':period,'file':path.name,'sha256':sha(data),'hashFile':path.name,'scanned':scanned,'selected':len(selected),'url':next(d for d in catalog if d['temporal'][0]['startDate'].startswith(period))['distribution'][0]['downloadURL']})
  rows+=selected
 network=folder/'network-selected.json'
 if network.exists():
  n=json.load(open(network));sid=f'{period}-network'
  sources.append({'id':sid,'period':period,'file':n['file'],'sha256':sha((folder/'network.zip').read_bytes()),'hashFile':'network.zip (original nested CMS ZIP, partition 6)','scanned':n['partitionRows'],'selected':len(n['rows']),'partition':6,'url':next(d for d in catalog if d['temporal'][0]['startDate'].startswith(period))['distribution'][0]['downloadURL']})
  for r in n['rows']:rows.append({'id':'network:'+r['values']['PHARMACY_NUMBER'],'area':'network','source':sid,'line':r['line'],'values':r['values']})
 assert len({r['id'] for r in rows})==len(rows),'duplicate plan key'
 records[period]=rows
ndcs={r['values']['NDC'] for rows in records.values() for r in rows if r['area']=='formulary'}
p=base/'nadac.csv';prices=[];dates=['08/26/2026','09/30/2026'];scanned=0
for line,r in enumerate(csv.DictReader(open(p)),2):
 scanned+=1
 if r['As of Date'] in dates and r['NDC'] in ndcs:prices.append({'id':r['As of Date']+':'+r['NDC']+':'+r['Pricing Unit']+':'+r['Pharmacy Type Indicator'],'area':'prices','source':'nadac','line':line,'values':r})
assert len({r['id'] for r in prices})==len(prices),'duplicate price key'
sources.append({'id':'nadac','period':'2026-09-30','file':'nadac-national-average-drug-acquisition-cost-09-30-2026.csv','sha256':sha(p.read_bytes()),'hashFile':'nadac-national-average-drug-acquisition-cost-09-30-2026.csv','scanned':scanned,'selected':len(prices),'url':'https://download.medicaid.gov/data/nadac-national-average-drug-acquisition-cost-09-30-2026.csv'})
payload={'snapshots':records,'prices':prices};raw=json.dumps(payload,separators=(',',':')).encode();packed=gzip.compress(raw,mtime=0);(dest/'records.json.gz').write_bytes(packed)
# Independent source census: authored outside the processing engine.
census={m:{a:sum(r['area']==a for r in rows) for a in sorted({r['area'] for r in rows})} for m,rows in records.items()}
manifest={'schema':1,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'plan':'SilverScript Choice (PDP)','planId':'S5601-024-000','region':'Alabama and Tennessee · PDP region 12','periods':periods,'priceDates':dates,'sources':sources,'census':census,'prices':len(prices),'payloadHash':sha(raw),'archiveHash':sha(packed),'dictionary':'https://data.cms.gov/sites/default/files/2025-10/0564eb37-402d-4110-bd98-2d5399dc30e7/PUFRecordLayout-2026.pdf','networkScope':'Matching plan rows in CMS network partition 6 only. Other partitions have not been scanned; complete network coverage is not established.'}
pathlib.Path('data/public-data-checks/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'census':census,'prices':len(prices),'bytes':len(packed)},indent=2))
