"""Replace release GIF with four static emulator/HUD pairs."""
import json,os,urllib.request
repo=os.environ['GITHUB_REPOSITORY']
api=f'https://api.github.com/repos/{repo}/releases/442307256'
def request(method='GET',data=None):
 headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','Content-Type':'application/json','User-Agent':'SpeedCAM-release-screenshots'}
 req=urllib.request.Request(api,method=method,headers=headers,data=json.dumps(data).encode() if data else None)
 with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)
release=request()
assert release['tag_name']=='aurelm_speed_camera_warning@0.9.28' and not release['draft']
assert release['target_commitish']=='d71d2f7334e7896610a9f4b0e1cef7cdb687b05f'
body=release['body'] or ''
for key in ('speedcam-demo','speedcam-screenshots'):
 begin='<!-- '+key+'-start -->'; end='<!-- '+key+'-end -->'
 if begin in body:
  start=body.index(begin); finish=body.index(end,start)+len(end)
  body=(body[:start]+body[finish:]).strip()
base=f'https://raw.githubusercontent.com/{repo}/{os.environ["GITHUB_SHA"]}/docs/screenshots-0.9.28/'
rows=['<!-- speedcam-screenshots-start -->','### Примеры интерфейса и HUD',
 'Статичные демонстрационные примеры на тестовых данных. Экраны записаны в эмуляторе; кадры HUD получены программной отрисовкой приложения, а не фотографированием проекции в автомобиле. Модели и параметры выбраны для демонстрации.']
for name,title,caption in [
 ('01-speed','1. Камера скорости — СТРЕЛКА','До камеры 300 м. Скорость 85 км/ч, лимит 60, превышение +25 км/ч.'),
 ('02-stop-line','2. Стоп-линия — КОРДОН','До камеры 300 м. Скорость 50 км/ч, лимит 60, без превышения.'),
 ('03-red-light','3. Красный свет — АВТОУРАГАН','До камеры 300 м. Скорость 50 км/ч, лимит 60, без превышения.'),
 ('04-average','4. Средняя скорость — АВТОДОРИЯ','До конца участка 300 м. Средняя скорость 85 км/ч, лимит 60, превышение +25 км/ч.')
]:
 rows.extend(['#### '+title,caption,'**Центральный экран — эмулятор**',
  '!['+title+' — эмулятор]('+base+name+'-emulator.jpg)',
  '**HUD — программная отрисовка**','!['+title+' — HUD]('+base+name+'-HUD.png)'])
rows.extend(['На кадрах с превышением внешнее кольцо HUD показано в яркой фазе. Все изображения статичны.','<!-- speedcam-screenshots-end -->'])
body=body.rstrip()+'\n\n'+'\n\n'.join(rows)+'\n'
assert '.gif' not in body
request('PATCH',{'body':body})
result=request()
assert result['body']==body and not result['draft']
print(result['html_url'])

