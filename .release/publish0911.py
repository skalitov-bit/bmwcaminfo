"""Publish the verified 0.9.11 draft by release ID, including all assets."""
from pathlib import Path
import hashlib, json, os, urllib.request, urllib.error, urllib.parse

root=Path(__file__).resolve().parents[1]
repo=os.environ['GITHUB_REPOSITORY']
tag='aurelm_speed_camera_warning@0.9.11'
api=f'https://api.github.com/repos/{repo}'

def request(url,method='GET',data=None,raw=False):
    headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','User-Agent':'BMWCamInfo-release'}
    if data is not None:
        headers['Content-Type']='application/octet-stream' if raw else 'application/json'
        if not raw:data=json.dumps(data).encode()
    req=urllib.request.Request(url,method=method,headers=headers,data=data)
    with urllib.request.urlopen(req,timeout=180) as response:
        content=response.read()
        return json.loads(content) if content else None

def find_release():
    for page in range(1,11):
        rows=request(api+f'/releases?per_page=100&page={page}')
        for row in rows:
            if row['tag_name']==tag:return row
        if len(rows)<100:return None
    raise RuntimeError('Release listing exceeded pagination limit')

release=find_release()
if release is None:
    try:
        release=request(api+'/releases','POST',{'tag_name':tag,'target_commitish':os.environ['GITHUB_SHA'],'name':'BMWCamInfo 0.9.11 — меню слева и оформление HUD','draft':True,'prerelease':False,'body':(root/'.release/0.9.11/notes.txt').read_text(encoding='utf-8')})
    except (urllib.error.URLError,TimeoutError):
        release=find_release()
        if release is None:raise
if not release['draft']:raise RuntimeError('Refusing to overwrite a published release')
if release['target_commitish']!=os.environ['GITHUB_SHA']:raise RuntimeError('Draft targets a different commit')
release_url=api+'/releases/'+str(release['id'])
upload_url=release['upload_url'].split('{')[0]
files=sorted(p for p in (root/'release0911').iterdir() if p.is_file())
assets={a['name']:a for a in request(release_url+'/assets?per_page=100')}
for p in files:
    digest='sha256:'+hashlib.sha256(p.read_bytes()).hexdigest()
    if p.name in assets:
        a=assets[p.name]
        if a['state']!='uploaded' or a['size']!=p.stat().st_size or a.get('digest')!=digest:raise RuntimeError('Existing asset differs: '+p.name)
    else:
        a=request(upload_url+'?name='+urllib.parse.quote(p.name,safe=''),'POST',p.read_bytes(),raw=True)
        if a['state']!='uploaded' or a['size']!=p.stat().st_size or a.get('digest')!=digest:raise RuntimeError('Uploaded asset failed verification: '+p.name)
    print('Verified asset:',p.name,flush=True)
uploaded={a['name']:a for a in request(release_url+'/assets?per_page=100')}
if set(uploaded)!={p.name for p in files}:raise RuntimeError('Unexpected or missing assets')
for p in files:
    if uploaded[p.name].get('digest')!='sha256:'+hashlib.sha256(p.read_bytes()).hexdigest():raise RuntimeError('Digest mismatch: '+p.name)
request(release_url,'PATCH',{'draft':False,'make_latest':'true'})
published=request(release_url)
if published['draft'] or not published['published_at']:raise RuntimeError('Publication not confirmed')
print(published['html_url'],flush=True)
