"""Publish only after every draft release asset is uploaded and verified."""
from pathlib import Path
import hashlib,json,os,subprocess,urllib.request,urllib.error

root=Path(__file__).resolve().parents[1]
repo=os.environ['GITHUB_REPOSITORY']
tag='aurelm_speed_camera_warning@0.9.7'
api=f'https://api.github.com/repos/{repo}'
def get(url):
    req=urllib.request.Request(url,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
    return json.load(urllib.request.urlopen(req,timeout=60))
def gh(*args):
    subprocess.run(['gh',*args],check=True,cwd=root)
try:
    release=get(api+'/releases/tags/'+tag)
except urllib.error.HTTPError as e:
    if e.code!=404: raise
    gh('release','create',tag,'--draft','--target',os.environ['GITHUB_SHA'],'--title','BMWCamInfo 0.9.7 — гибридная база и обновлённый HUD','--notes-file',str(root/'.release/0.9.7/notes.txt'))
    release=get(api+'/releases/tags/'+tag)
if not release['draft']:
    raise RuntimeError('Existing published release will not be overwritten')
files=sorted(p for p in (root/'release097').iterdir() if p.is_file())
gh('release','upload',tag,*map(str,files),'--clobber')
uploaded={a['name']:a for a in get(api+'/releases/tags/'+tag)['assets']}
assert set(uploaded)=={p.name for p in files}, 'Unexpected or missing release assets'
for p in files:
    a=uploaded[p.name]
    assert a['state']=='uploaded' and a['size']==p.stat().st_size,p.name
    assert a['digest']=='sha256:'+hashlib.sha256(p.read_bytes()).hexdigest(),p.name
gh('release','edit',tag,'--draft=false','--latest')
print(get(api+'/releases/tags/'+tag)['html_url'])
