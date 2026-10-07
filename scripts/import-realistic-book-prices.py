import csv,json,hashlib,datetime,pathlib,sys
specs=[('70010006310',60,30,'Generic',False),('60505257908',30,30,'Generic',False),('68180098003',30,30,'Generic',False),('00378180510',30,30,'Generic',False),('65862020299',30,30,'Generic',False),('82009002710',30,30,'Generic',False),('65862001205',30,30,'Generic',False),('31722071390',30,30,'Generic',False),('00781261305',21,7,'Acute',False),('00003089421',60,30,'Brand',False),('00597015230',30,30,'Brand',True),('58406003204',4,28,'Specialty',True),('72511076002',2,28,'Specialty',True),('17270074000',8.5,30,'Acute',False)]
path=pathlib.Path(sys.argv[1]);wanted={s[0] for s in specs};rows=[]
for line,r in enumerate(csv.DictReader(open(path)),2):
 if r['NDC'] in wanted:rows.append({'line':line,**r})
for ndc,*_ in specs:assert any(r['NDC']==ndc for r in rows),ndc
payload={'source':'https://download.medicaid.gov/data/nadac-national-average-drug-acquisition-cost-09-30-2026.csv','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'description':'Exact CMS NADAC rows; synthetic drug tiers, quantities, days supply and PA flags are separate scenario assumptions. NADAC is not a negotiated commercial reimbursement rate.','drugs':[{'ndc':n,'quantity':q,'days':d,'tier':t,'pa':pa,'name':next(r['NDC Description'] for r in rows if r['NDC']==n)} for n,q,d,t,pa in specs],'rows':rows}
pathlib.Path('data/realistic-book/prices.json').write_text(json.dumps(payload,separators=(',',':'))+'\n');print(len(rows),'public price rows',len(specs),'products')
