from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import json
root=Path('site');missing=set();count=0
class Check(HTMLParser):
 def handle_starttag(self,tag,attrs):
  d=dict(attrs)
  for key in ('src','href','poster'):
   u=d.get(key,'')
   if not u.startswith('/') or u.startswith('//'):continue
   p=root/unquote(urlsplit(u).path.lstrip('/'))
   if key=='href' and tag!='link' and (p/'index.html').exists():continue
   if not p.exists():missing.add(u)
for p in root.rglob('*.html'):
 c=Check();c.feed(p.read_text());count+=1
print(json.dumps({'pages_checked':count,'missing_local_references':sorted(missing)},indent=2))
if missing:raise SystemExit(1)
