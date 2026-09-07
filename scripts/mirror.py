"""Capture public Centre Point pages and their original presentation assets."""
import concurrent.futures, html, json, re, urllib.request, urllib.parse, subprocess
from pathlib import Path
from html.parser import HTMLParser
ROOT='https://centrepointnagpur.com'
OUT=Path('site'); OUT.mkdir(exist_ok=True)
pages={}; assets=set(); failures=[]
class Links(HTMLParser):
 def __init__(self): super().__init__(); self.links=[]
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  if tag=='a' and d.get('href'): self.links.append(d['href'])
def fetch(url):
 try:
  r=subprocess.run(['curl','-sSL','--fail','--max-time','40',url],capture_output=True)
  if r.returncode: return None,r.stderr.decode()
  return r.stdout,'html' if b'<html' in r.stdout[:3000].lower() else 'asset' 
 except Exception as e:return None,str(e)
def page_url(url,base=ROOT+'/'):
 u=urllib.parse.urlsplit(urllib.parse.urljoin(base,html.unescape(url)))
 if u.netloc!='centrepointnagpur.com' or u.query or any(x in u.path for x in ['/wp-','/feed','/xmlrpc','/author/','/tag/','/category/']): return None
 if Path(u.path).suffix and not u.path.endswith('.html'):return None
 return ROOT+(u.path or '/')
def getpage(url):
 b,c=fetch(url)
 return url,b.decode('utf-8',errors='replace') if b and 'html' in c else None
pending={ROOT+'/'}
for depth in range(3):
 with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
  for url,body in ex.map(getpage,sorted(pending)):
   if body:pages[url]=body
 pending=set()
 for url,body in list(pages.items()):
  p=Links();p.feed(body)
  for href in p.links:
   u=page_url(href,url)
   if u and u not in pages:pending.add(u)
 print('Pages',len(pages),'remaining',len(pending),flush=True)
 if not pending:break
# Scan literal and JSON-escaped asset URLs throughout HTML/CSS/JS.
pattern=re.compile(r'(?:https?:)?//centrepointnagpur\.com/[^\s<>"\'\\)]+')
def discover(body,base):
 body=html.unescape(body.replace('\\/','/'))
 found=set()
 for raw in pattern.findall(body):
  u=urllib.parse.urlsplit(urllib.parse.urljoin(base,raw))
  if u.path.startswith(('/wp-content/','/wp-includes/')) and Path(u.path).suffix not in ('','.php'):found.add(ROOT+u.path)
 for raw in re.findall(r'url\(\s*[\'"]?([^\)\'"\s]+)',body):
  u=urllib.parse.urlsplit(urllib.parse.urljoin(base,raw))
  if u.netloc=='centrepointnagpur.com' and Path(u.path).suffix: found.add(ROOT+u.path)
 return found
for u,b in pages.items():assets.update(discover(b,u))
completed=set()
while assets-completed:
 batch=assets-completed
 def download(u):
  b,c=fetch(u)
  if b:
   p=OUT/urllib.parse.unquote(urllib.parse.urlsplit(u).path.lstrip('/'));p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
   if p.suffix in ('.css','.js'):return u,discover(b.decode('utf-8',errors='replace'),u)
  else:failures.append({'url':u,'error':c})
  return u,set()
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
  for u,more in ex.map(download,sorted(batch)):completed.add(u);assets.update(more)
 print('Assets',len(completed),'remaining',len(assets-completed),flush=True)
# Rewrite only captured resources and pages; preserve external booking services.
def rewrite(body):
 for prefix in ('https://centrepointnagpur.com','http://centrepointnagpur.com','//centrepointnagpur.com'):
  body=body.replace(prefix+'/wp-content/','/wp-content/').replace(prefix+'/wp-includes/','/wp-includes/')
  body=body.replace(prefix.replace('/','\\/')+'\\/wp-content\\/','\\/wp-content\\/').replace(prefix.replace('/','\\/')+'\\/wp-includes\\/','\\/wp-includes\\/')
 for url in sorted(pages,key=len,reverse=True):
  path=urllib.parse.urlsplit(url).path
  body=body.replace('href="'+url+'"','href="'+path+'"').replace("href='"+url+"'","href='"+path+"'")
 return body
for url,body in pages.items():
 path=urllib.parse.unquote(urllib.parse.urlsplit(url).path).strip('/')
 p=OUT/path/'index.html';p.parent.mkdir(parents=True,exist_ok=True)
 # Remove original analytics and indexing from the replica.
 body=re.sub(r'<script\b[^>]*(?:googletagmanager|google-site-kit)[^>]*>.*?</script>','',body,flags=re.S|re.I)
 body=re.sub(r'<meta\s+name=[\'"]robots[\'"][^>]*>','',body,flags=re.I)
 body=body.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>')
 p.write_text(rewrite(body))
for p in OUT.rglob('*'):
 if p.suffix in ('.css','.js'):p.write_text(rewrite(p.read_text(errors='replace')))
Path('mirror-report.json').write_text(json.dumps({'source':ROOT,'pages':list(pages),'assets':len(completed),'failures':failures},indent=2))
print('Finished:',len(pages),'pages,',len(completed),'assets,',len(failures),'failed',flush=True)
