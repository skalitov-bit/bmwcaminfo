"""Append the recorded emulator GIF to the existing SpeedCAM release notes."""
import json,os,urllib.request
repo=os.environ['GITHUB_REPOSITORY']
api=f'https://api.github.com/repos/{repo}/releases/442307256'
def request(method='GET',data=None):
 headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','Content-Type':'application/json','User-Agent':'SpeedCAM-release-demo'}
 req=urllib.request.Request(api,method=method,headers=headers,data=json.dumps(data).encode() if data else None)
 with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)
release=request()
assert release['tag_name']=='aurelm_speed_camera_warning@0.9.28' and not release['draft']
assert release['target_commitish']=='d71d2f7334e7896610a9f4b0e1cef7cdb687b05f'
begin='<!-- speedcam-demo-start -->'
end='<!-- speedcam-demo-end -->'
body=release['body'] or ''
if begin in body:
 start=body.index(begin);finish=body.index(end,start)+len(end)
 body=(body[:start]+body[finish:]).strip()
url=f'https://raw.githubusercontent.com/{repo}/{os.environ["GITHUB_SHA"]}/docs/SpeedCAM_Strelka_300m_Plus25.gif'
demo=begin+'\n### Демонстрация в эмуляторе\n\nСТРЕЛКА через **300 м** · ограничение **60 км/ч** · скорость **85 км/ч** · превышение **+25 км/ч**.\n\n![SpeedCAM: СТРЕЛКА через 300 м, превышение +25 км/ч]('+url+')\n\nЗапись эмулятора с тестовыми данными. Демонстрационный сценарий не включён в установочный пакет.\n'+end
body=body.rstrip()+'\n\n'+demo+'\n'
request('PATCH',{'body':body})
result=request()
assert result['body']==body and not result['draft']
print(result['html_url'])

