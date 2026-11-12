"""Publish 0.9.29 and its voice tool only after all uploaded digests match."""
from pathlib import Path
import hashlib, json, os, urllib.request, urllib.error, urllib.parse
root=Path(__file__).resolve().parents[1]
repo=os.environ['GITHUB_REPOSITORY']
api=f'https://api.github.com/repos/{repo}'
out=Path(os.environ.get('SPEEDCAM_RELEASE_OUT',str(root/'release0929')))

def request(url,method='GET',data=None,raw=False):
    headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','User-Agent':'SpeedCAM-release'}
    if data is not None:
        headers['Content-Type']='application/octet-stream' if raw else 'application/json'
        if not raw:data=json.dumps(data).encode()
    with urllib.request.urlopen(urllib.request.Request(url,method=method,headers=headers,data=data),timeout=180) as response:
        content=response.read()
        return json.loads(content) if content else None

def find_release(tag):
    for page in range(1,11):
        rows=request(api+f'/releases?per_page=100&page={page}')
        for row in rows:
            if row['tag_name']==tag:return row
        if len(rows)<100:return None
    raise RuntimeError('Release listing exceeded pagination limit')

def publish(tag,title,body,files,latest):
    release=find_release(tag)
    if release is None:
        try:
            release=request(api+'/releases','POST',{'tag_name':tag,'target_commitish':os.environ['GITHUB_SHA'],'name':title,'draft':True,'prerelease':False,'body':body})
        except (urllib.error.URLError,TimeoutError):
            release=find_release(tag)
            if release is None:raise
    if release['target_commitish']!=os.environ['GITHUB_SHA']:raise RuntimeError('Release targets a different commit')
    url=api+'/releases/'+str(release['id'])
    upload=release['upload_url'].split('{')[0]
    assets={a['name']:a for a in request(url+'/assets?per_page=100')}
    for p in files:
        digest='sha256:'+hashlib.sha256(p.read_bytes()).hexdigest()
        a=assets.get(p.name)
        if a is None:
            if not release['draft']:raise RuntimeError('Refusing to alter published release')
            a=request(upload+'?name='+urllib.parse.quote(p.name,safe=''),'POST',p.read_bytes(),raw=True)
        if a['state']!='uploaded' or a['size']!=p.stat().st_size or a.get('digest')!=digest:
            raise RuntimeError('Asset verification failed: '+p.name)
        print('Verified '+tag+': '+p.name,flush=True)
    uploaded={a['name']:a for a in request(url+'/assets?per_page=100')}
    if set(uploaded)!={p.name for p in files}:raise RuntimeError('Unexpected or missing assets')
    for p in files:
        if uploaded[p.name].get('digest')!='sha256:'+hashlib.sha256(p.read_bytes()).hexdigest():raise RuntimeError('Digest mismatch: '+p.name)
    if release['draft']:request(url,'PATCH',{'draft':False,'make_latest':'true' if latest else 'false'})
    published=request(url)
    if published['draft'] or not published['published_at']:raise RuntimeError('Publication not confirmed')
    print(published['html_url'],flush=True)

checks=json.loads((out/'BUILD-CHECKSUMS.json').read_text(encoding='utf-8'))
files=sorted(p for p in out.iterdir() if p.is_file())
if set(checks)!={p.name for p in files if p.name!='BUILD-CHECKSUMS.json'}:raise RuntimeError('Release asset list changed after testing')
for p in files:
    if p.name=='BUILD-CHECKSUMS.json':continue
    if checks[p.name]!={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}:raise RuntimeError('Release asset changed after testing: '+p.name)
publish('bmwcaminfo-voice@0.1.10','SpeedCAM — звуковой сервис 0.1.10',
    'Отдельные голосовые предупреждения Стрелки и Автодории для SpeedCAM 0.9.29. Автодория сообщает о средней скорости только при подтверждении этого вида контроля в базе. Восемь готовых записей, воспроизведение офлайн. Устанавливается как tool через совместимый MGU Store/mgu-deploy. Длительность аудиомаршрута учитывает длину записи. Файлы и программная логика проверены; BMW MediaPlayer на автомобиле пока не проверен. Исходники находятся в релизе SpeedCAM 0.9.29.',
    [out/'bmwcaminfo-voice@0.1.10.tgz'],False)
publish('aurelm_speed_camera_warning@0.9.29','SpeedCAM 0.9.29 — Стрелка, Автодория и настройки уведомлений',
    (root/'.release/0.9.29/notes.txt').read_text(encoding='utf-8'),files,True)
