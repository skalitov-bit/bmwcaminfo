"""Check the installable layout, not only the emulator's overlay visibility.
Usage: python tests/no-native-bar.py release-directory
"""
from pathlib import Path
import sys, json, tarfile, xml.etree.ElementTree as ET

root=Path(__file__).resolve().parents[1]
app=json.loads((root/'apps/aurelm_speed_camera_warning/app.json').read_text(encoding='utf-8'))
assert not next(s for s in app['screens'] if s['name']=='MAIN').get('buttons')
release=Path(sys.argv[1])
checks=[]
for ext in ('mgu','tgz'):
    with tarfile.open(release/(app['id']+'@'+app['version']+'.'+ext),'r:gz') as archive:
        members={m.name:m for m in archive.getmembers() if m.isfile()}
        specs=[n for n in members if n.endswith('/kit/app-spec.json')]
        assert len(specs)==1
        spec=json.load(archive.extractfile(members[specs[0]]))
        assert not next(s for s in spec['screens'] if s['name']=='MAIN').get('buttons')
        xmls=[n for n in members if n.endswith('/application.xml')]
        uis=[n for n in members if n.endswith('/uiDescription.json')]
        assert xmls and uis
        for name in xmls:
            tree=ET.fromstring(archive.extractfile(members[name]).read())
            assert not tree.findall(".//layoutGroup[@name='Bar']"),name
            main=tree.find(".//container[@id='%s']" % spec['stateIds']['MAIN'])
            assert main is not None
            if app.get('responsiveMain'):assert main.attrib['widget']=='LT_State_Wide',name
            assert not any(e.attrib.get('type')=='button' for e in main.iter()),name
            assert tree.findall(".//container[@id='9000']"),'Popup layout must survive'
        for name in uis:
            ui=json.load(archive.extractfile(members[name]))
            main=next(c for c in ui['containers'].values() if c['name']=='MAIN')
            assert not any(c['name'].startswith('BTN_') for c in main['components'].values()),name
            assert any(c['name']=='MAIN_GFX' for c in main['components'].values()),name
        checks.append({'format':ext,'xmlLayouts':len(xmls),'uiDescriptions':len(uis),'nativeBarButtons':0})
print(json.dumps({'passed':True,'checks':checks,'vehicleVerified':False}))
