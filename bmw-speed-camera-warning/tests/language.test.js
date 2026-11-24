'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../apps/aurelm_speed_camera_warning');
const l=require(path.join(root,'i18n')),font=require(path.join(root,'cluster-text'));
const dictionary=require(path.join(root,'i18n-en.json'));
assert(font.hasGlyph('m'),'Latin lowercase metre glyph must be available on HUD');
l.setLanguage('ru');assert.equal(l.t('НАСТРОЙКИ'),'НАСТРОЙКИ');assert.equal(l.voiceFile('speed-bump.m4a'),'speed-bump.m4a');
l.setLanguage('en');
assert.equal(l.t('3  МАСШТАБ'),'3  ZOOM');assert.equal(l.t('500 м'),'500 m');
for(const [ru,en] of Object.entries(dictionary))assert(!/[А-Яа-яЁё]/.test(l.t(ru)),ru);
for(const s of ['GPS: ТОЧНОСТЬ СНИЖЕНА','500 м','СКОРОСТЬ 60 КМ/Ч','СТРЕЛКА / В СПИНУ','ДАТА БАЗЫ: 25.11.2026'])assert(!/[А-Яа-яЁё]/.test(l.t(s)),s);
assert.equal(l.t('ШКОЛА / ПЕРЕХОД'),'SCHOOL / CROSSING');assert.equal(l.t('ЛЕЖАЧИЙ ПОЛИЦЕЙСКИЙ'),'Speed bump');
assert.equal(l.voiceFile('strelka.m4a'),'en-strelka.m4a');assert.equal(l.voiceFile('en-school.m4a'),'en-school.m4a');assert.equal(l.voiceFile('beeper-1.m4a'),'beeper-1.m4a');
const {LanguagePanel}=require(path.join(root,'language-panel'));let selected=null;const panel=new LanguagePanel(s=>selected=s,()=>{});
assert.equal(panel.buttons(true).length,2);panel.tap(1000,270,true);assert.equal(selected,'en');panel.tap(580,270,true);assert.equal(selected,'ru');
assert.equal(panel.buttons(false).length,3);
for(const s of Object.values(dictionary))for(const c of s.toUpperCase())if(/[A-Z]/.test(c))assert(font.hasGlyph(c),'English glyph '+c);
const native=path.resolve(__dirname,'../native/bmwcaminfo-voice'),manifest=require(path.join(native,'audio-manifest.json'));
const speech=Object.keys(manifest).filter(n=>!n.startsWith('en-')&&!n.startsWith('beeper-'));
for(const name of speech){const en='en-'+name;assert(manifest[en],en);for(const relative of ['audio/'+en,'pcm/'+en.replace('.m4a','.pcm'),...Array.from({length:9},(_,i)=>'audio/volume-'+((i+1)*10)+'/'+en)])assert(fs.statSync(path.join(native,relative)).size>100,relative);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(native,'audio',en))).digest('hex'),manifest[en].sha256);}
const language=require(path.join(native,'speech-language'));language.set('en');assert.equal(language.file('camera-500.pcm'),'en-camera-500.pcm');language.set('ru');assert.equal(language.file('camera-500.pcm'),'camera-500.pcm');
// Selection at enqueue time prevents queued Russian phrases after an English switch.
const {CameraVoiceAlerts}=require(path.join(root,'voice-alert'));const files=[];const v=new CameraVoiceAlerts({});v._request=async file=>{files.push(file);return {ok:true};};
(async()=>{await v.test();await v.sectionEndResult(()=>true);assert.deepEqual(files,['en-camera-500.m4a','en-average-end.m4a']);l.setLanguage('ru');await v.test();assert.equal(files[2],'camera-500.m4a');console.log('PASS RU/EN catalog, metrics, persistent-dialog controls, '+speech.length+' English voice sets, native mapping and voice queue');})().catch(e=>{console.error(e);process.exitCode=1;});
