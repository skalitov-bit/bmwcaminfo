"""Offline contract tests. No real ElevenLabs synthesis or credit consumption."""
import array
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import elevenlabs_voice as ev


class VoiceTests(unittest.TestCase):
    def test_sdk_voice_check_and_redacted_failure(self):
        import httpx
        requests = []
        def reply(request):
            requests.append(request)
            self.assertEqual(request.headers['xi-api-key'], 'TEST-SECRET')
            return httpx.Response(200, json={'voice_id':self.c['voice_id'], 'name':'Test voice'})
        client = httpx.Client(transport=httpx.MockTransport(reply))
        with patch('httpx.Client', return_value=client):
            result = ev.check_voice('TEST-SECRET', self.c['voice_id'])
        self.assertEqual(result['apiCheck'], 'success')
        self.assertEqual(len(requests), 1)
        def denied(request):
            requests.append(request)
            return httpx.Response(401, json={'detail':'TEST-SECRET'})
        client = httpx.Client(transport=httpx.MockTransport(denied))
        with patch('httpx.Client', return_value=client), self.assertRaises(RuntimeError) as caught:
            ev.check_voice('TEST-SECRET', self.c['voice_id'])
        self.assertNotIn('TEST-SECRET', str(caught.exception))
        self.assertIn('401', str(caught.exception))
        self.assertEqual(len(requests), 2)
        client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(
            401, json={'detail':{'status':'missing_permissions', 'message':'TEST-SECRET'}})))
        with patch('httpx.Client', return_value=client), self.assertRaises(RuntimeError) as caught:
            ev.check_voice('TEST-SECRET', self.c['voice_id'])
        self.assertIn('voices_read', str(caught.exception))
        self.assertNotIn('TEST-SECRET', str(caught.exception))

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.out=Path(self.temp.name)
        parts=list(map(int,ev.read_json(ev.SERVICE/'component.json')['version'].split('.')))
        parts[-1]+=1
        self.version='.'.join(map(str,parts))
        self.c=ev.config(Path(ev.__file__).with_name('elevenlabs-voice.json'))
        samples=array.array('h',(int(8000*math.sin(2*math.pi*260*i/24000)) for i in range(28800)))
        if sys.byteorder!='little':samples.byteswap()
        self.raw=samples.tobytes()

    def tearDown(self):
        self.temp.cleanup()

    def test_cache_and_request_contract(self):
        with patch.object(ev,'request',return_value=(self.raw,'audio/pcm')) as api:
            ev.generate(self.c,{'strelka':ev.phrases()['strelka']},self.out,'TEST-SECRET')
            self.assertEqual(api.call_count,1)
            key,path,body=api.call_args.args
            self.assertEqual(key,'TEST-SECRET')
            self.assertEqual(path,'/v1/text-to-speech/'+self.c['voice_id']+'?output_format=pcm_24000')
            self.assertNotIn('language_code',body)
            self.assertNotIn('audio_effects',body)
            self.assertEqual(body['text'],ev.phrases()['strelka'])
            ev.generate(self.c,{'strelka':ev.phrases()['strelka']},self.out,'TEST-SECRET')
            self.assertEqual(api.call_count,1)
            ev.generate(self.c,{'strelka':'Другой текст'},self.out,'TEST-SECRET')
            self.assertEqual(api.call_count,2)
            (self.out/'strelka.wav').write_bytes(b'corrupted')
            ev.generate(self.c,{'strelka':'Другой текст'},self.out,'TEST-SECRET')
            self.assertEqual(api.call_count,3)
        self.assertNotIn('TEST-SECRET',(self.out/'generation.json').read_text())

    def test_new_voice_uses_original_phrase_text(self):
        for text in ev.phrases().values():
            self.assertEqual(text,ev.speech_text(text))
        old=dict(self.c,voice_id='different-test-voice')
        self.assertNotEqual(ev.identity(old,'Стрелка'),ev.identity(self.c,'Стрелка'))

    def test_model_settings_and_cache_separation(self):
        v4 = dict(self.c, model_id='eleven_v4', voice_settings={'stability':0.8,'similarity_boost':0.75})
        v2 = dict(self.c, model_id='eleven_multilingual_v2', voice_settings={
            **v4['voice_settings'], 'style':0.0,'speed':0.95,'use_speaker_boost':False})
        path = self.out/'config.json'
        for config in (v4,v2):
            ev.write_json(path,config)
            self.assertEqual(ev.config(path),config)
        self.assertNotEqual(ev.identity(v4,'Стрелка'),ev.identity(v2,'Стрелка'))
        ev.write_json(path,dict(v4,voice_settings=v2['voice_settings']))
        with self.assertRaisesRegex(ValueError,'Unexpected voice settings'):
            ev.config(path)
        with patch.object(ev,'request',return_value=(self.raw,'audio/pcm')) as api:
            ev.generate(v4,{'strelka':'Комплекс Стрелка'},self.out,'TEST-SECRET')
            body=api.call_args.args[2]
            self.assertEqual(body['model_id'],'eleven_v4')
            self.assertEqual(set(body['voice_settings']),{'stability','similarity_boost'})

    def test_invalid_response_preserves_existing_recording(self):
        with patch.object(ev,'request',return_value=(self.raw,'audio/pcm')):
            ev.generate(self.c,{'strelka':'Текст'},self.out,'secret')
        original=(self.out/'strelka.wav').read_bytes()
        for raw,mime in [(b'{}','application/json'),(b'RIFF'+self.raw,'audio/wav'),(b'\0'*48000,'audio/pcm'),(b'\xff\x7f'*24000,'audio/pcm')]:
            with patch.object(ev,'request',return_value=(raw,mime)), self.assertRaises(ValueError):
                ev.generate(self.c,{'strelka':'Текст'},self.out,'secret',force=True)
            self.assertEqual(original,(self.out/'strelka.wav').read_bytes())

    def test_error_redaction_no_retry_no_redirect(self):
        for status in (401,403,429,500,302):
            err=urllib.error.HTTPError(ev.API,status,'TEST-SECRET',{},io.BytesIO(b'TEST-SECRET'))
            with patch('urllib.request.OpenerDirector.open',side_effect=err) as api:
                with self.assertRaises(RuntimeError) as caught:ev.request('TEST-SECRET','/v1/voices/test')
                self.assertNotIn('TEST-SECRET',str(caught.exception))
                self.assertEqual(api.call_count,1)
        self.assertIsNone(ev.NoRedirect().redirect_request(None,None,302,'',{},'https://example.com'))

    def test_package_requires_complete_matching_set(self):
        ev.write_json(self.out/'generation.json',{})
        with self.assertRaisesRegex(ValueError,'Generate all'):ev.build_package(self.c,self.out,self.version,'unused')

    @unittest.skipUnless(os.environ.get('FFMPEG'),'Set FFMPEG to test actual AAC packaging')
    def test_package_retains_beeper_and_production_assets(self):
        before={p:ev.digest(p.read_bytes()) for p in ev.SERVICE.rglob('*') if p.is_file()}
        with patch.object(ev,'request',return_value=(self.raw,'audio/pcm')):
            ev.generate(self.c,ev.phrases(),self.out,'secret')
        target=ev.build_package(self.c,self.out,self.version,os.environ['FFMPEG'])
        with tarfile.open(target) as archive:
            component=json.load(archive.extractfile('component.json'))
            self.assertEqual(component['version'],self.version)
            for f in component['files']:
                self.assertEqual(ev.digest(archive.extractfile('files/'+f['path']).read()),f['sha256'])
            for relative in ev.read_json(ev.SERVICE/'beeper-manifest.json'):
                self.assertEqual(archive.extractfile('files/'+relative).read(),(ev.SERVICE/relative).read_bytes())
            voices=json.load(archive.extractfile('files/audio-manifest.json'))
            levels=json.load(archive.extractfile('files/volume-manifest.json'))
            self.assertEqual(len(voices),len(ev.phrases()));self.assertEqual(len(levels),len(ev.phrases())*9)
            self.assertTrue(all(v['provider']=='ElevenLabs' and 1<=v['durationSeconds']<=2 for v in voices.values()))
        self.assertEqual(before,{p:ev.digest(p.read_bytes()) for p in before})


if __name__=='__main__':unittest.main()
