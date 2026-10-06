"""Download pinned public CMS source components (several GB of temporary disk)."""
import pathlib,sys,struct,zlib,csv
base=pathlib.Path(sys.argv[1]);base.mkdir(parents=True,exist_ok=True)
import io,urllib.request,zipfile,json
class RemoteZip(io.RawIOBase):
 def __init__(self,url):
  self.url=url;self.pos=0;self.size=int(urllib.request.urlopen(urllib.request.Request(url,method='HEAD')).headers['Content-Length'])
 def seekable(self):return True
 def seek(self,offset,whence=0):
  self.pos=offset if whence==0 else (self.pos if whence==1 else self.size)+offset;return self.pos
 def tell(self):return self.pos
 def read(self,n=-1):
  if n<0:n=self.size-self.pos
  end=min(self.size-1,self.pos+n-1)
  if end<self.pos:return b''
  r=urllib.request.urlopen(urllib.request.Request(self.url,headers={'Range':f'bytes={self.pos}-{end}'}))
  assert r.status==206,r.status
  d=r.read();self.pos+=len(d);return d

selected=[{'temporal': [{'@type': 'PeriodOfTime', 'startDate': '2026-08-01', 'endDate': '2026-08-31'}], 'distribution': [{'downloadURL': 'https://data.cms.gov/sites/default/files/2026-08/d8c9b393-66f0-4973-a748-f66742fe0fd2/2026_20260819.zip'}]}, {'temporal': [{'@type': 'PeriodOfTime', 'startDate': '2026-09-01', 'endDate': '2026-09-30'}], 'distribution': [{'downloadURL': 'https://data.cms.gov/sites/default/files/2026-09/903ba816-d276-4c17-9b5a-0224bbd4e949/2026_20260916.zip'}]}]
(base/'selected-catalog.json').write_text(json.dumps(selected))
for d in selected:
 period=d['temporal'][0]['startDate'][:7];folder=base/period;folder.mkdir(exist_ok=True)
 remote=RemoteZip(d['distribution'][0]['downloadURL']);z=zipfile.ZipFile(remote)
 for e in z.infolist():
  if any(e.filename.lower().startswith(x) for x in ['basic drugs','beneficiary cost','plan information','excluded drugs','insulin beneficiary','indication based']):
   path=folder/e.filename
   if not path.exists():path.write_bytes(z.read(e))
   with zipfile.ZipFile(path) as nested:
    for f in nested.infolist():
     if not f.is_dir():(folder/pathlib.Path(f.filename).name).write_bytes(nested.read(f))
 e=next(e for e in z.infolist() if 'part 6' in e.filename)
 remote.seek(e.header_offset);h=struct.unpack('<IHHHHHIIIHH',remote.read(30));offset=e.header_offset+30+h[-2]+h[-1];p=folder/'network.zip'
 if not p.exists():
  req=urllib.request.Request(remote.url,headers={'Range':f'bytes={offset}-{offset+e.compress_size-1}'})
  with urllib.request.urlopen(req) as response,open(p,'wb') as out:
   assert response.status==206
   dec=zlib.decompressobj(-15) if e.compress_type==8 else None
   while chunk:=response.read(1024*1024):out.write(dec.decompress(chunk) if dec else chunk)
   if dec:out.write(dec.flush())
 with zipfile.ZipFile(p) as nested:
  name=nested.namelist()[0];found=[];count=0
  with nested.open(name) as raw:
   reader=csv.DictReader(io.TextIOWrapper(raw,encoding='cp1252'),delimiter='|')
   for line,row in enumerate(reader,2):
    count+=1
    if row['CONTRACT_ID']=='S5601' and row['PLAN_ID']=='024' and row['SEGMENT_ID']=='000':found.append({'line':line,'values':row})
  (folder/'network-selected.json').write_text(json.dumps({'file':name,'partition':6,'partitionRows':count,'rows':found}))
 print(period,len(found),'selected pharmacy rows',flush=True)
p=base/'nadac.csv'
if not p.exists():urllib.request.urlretrieve('https://download.medicaid.gov/data/nadac-national-average-drug-acquisition-cost-09-30-2026.csv',p)
