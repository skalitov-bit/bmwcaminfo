#!/usr/bin/env python3
"""Generate offline SpeedCAM voice assets; ffmpeg is needed for packaging only."""
import argparse
import array
import getpass
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / 'native/bmwcaminfo-voice'
API = 'https://api.elevenlabs.io'
MAX_BYTES = 16 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_json(path, value):
    atomic_write(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        temp = Path(f.name)
        f.write(data)
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def phrases():
    # Include the two generic recordings too; the old generator preserved them.
    original = {Path(name).stem: info['text'] for name, info in read_json(SERVICE/'audio-manifest.json').items() if not name.startswith(('en-', 'beeper-'))}
    edited_file = Path(__file__).with_name('elevenlabs-phrases.json')
    if not edited_file.exists():
        return original
    edited = read_json(edited_file)
    dps_file = Path(__file__).with_name('elevenlabs-dps-phrases.json')
    dps_ids = set(read_json(dps_file)) if dps_file.exists() else set()
    end_file = Path(__file__).with_name('elevenlabs-section-phrases.json')
    end_ids = set(read_json(end_file)) if end_file.exists() else set()
    if not isinstance(edited, dict) or set(edited) not in (set(original), set(original)-dps_ids, set(original)-dps_ids-end_ids):
        raise ValueError('Edited phrases must contain exactly the existing phrase IDs.')
    if any(not isinstance(text, str) or not text.strip() or len(text) > 500 for text in edited.values()):
        raise ValueError('Each edited phrase must contain 1 to 500 characters.')
    return {**original, **edited}


def config(path):
    c = read_json(path)
    if set(c) != {'voice_id', 'model_id', 'output_format', 'voice_settings'}:
        raise ValueError('Config must contain only voice_id, model_id, output_format, voice_settings; no API key.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', c['voice_id']):
        raise ValueError('Invalid Voice ID')
    if c['model_id'] not in ('eleven_multilingual_v2', 'eleven_v4'):
        raise ValueError('Supported models: eleven_multilingual_v2, eleven_v4.')
    if c['output_format'] not in ('pcm_24000', 'pcm_44100', 'pcm_48000'):
        raise ValueError('Select a supported lossless PCM output format.')
    settings = c['voice_settings']
    expected = {'stability', 'similarity_boost'}
    if c['model_id'] == 'eleven_multilingual_v2':
        expected |= {'style', 'speed', 'use_speaker_boost'}
    if set(settings) != expected:
        raise ValueError('Unexpected voice settings for '+c['model_id'])
    for k in sorted(expected - {'use_speaker_boost'}):
        lo, hi = (0.7, 1.2) if k == 'speed' else (0, 1)
        if type(settings[k]) not in (int, float) or not math.isfinite(settings[k]) or not lo <= settings[k] <= hi:
            raise ValueError('Invalid setting: '+k)
    if 'use_speaker_boost' in settings and type(settings['use_speaker_boost']) is not bool:
        raise ValueError('use_speaker_boost must be boolean')
    return c


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the API key to another endpoint.


def request(key, path, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(API+path, data=data, headers={
        'xi-api-key': key, 'Content-Type': 'application/json', 'User-Agent': 'SpeedCAM-voice-builder/1'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=90) as response:
            body = response.read(MAX_BYTES+1)
            if len(body) > MAX_BYTES:
                raise ValueError('Response is too large')
            return body, response.headers.get('Content-Type', '').split(';')[0].lower()
    except urllib.error.HTTPError as e:
        hints = {401: 'API key rejected', 403: 'Voice, format or API permission unavailable',
                 402: 'Payment or plan restriction', 404: 'Voice not found', 429: 'Quota or request limit reached'}
        # Map known error codes; never echo the provider's body, which may contain secrets.
        reason = hints.get(e.code, 'Request failed')
        try:
            detail = json.loads(e.read(8192)).get('detail', {})
            code = detail.get('status') if isinstance(detail, dict) else None
            reason = {'paid_plan_required': 'This voice or feature requires a paid ElevenLabs plan',
                      'quota_exceeded': 'Insufficient ElevenLabs credits',
                      'missing_permissions': 'API key is missing a required permission',
                      'invalid_api_key': 'API key rejected'}.get(code, reason)
        except (ValueError, OSError, AttributeError):
            pass
        raise RuntimeError(f'ElevenLabs HTTP {e.code}: '+reason+
                           '. No automatic retry was made.') from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError('ElevenLabs connection failed. No automatic retry: synthesis may already have been billed.') from None


def pcm_stats(raw, rate):
    if len(raw) % 2 or not 0.25 <= len(raw)/(2*rate) <= 20:
        raise ValueError('Invalid PCM length (expected 0.25–20 seconds, mono 16-bit)')
    samples = array.array('h', raw)
    if sys.byteorder != 'little':
        samples.byteswap()
    peak = max(abs(x) for x in samples)
    rms = math.sqrt(sum(float(x)*x for x in samples)/len(samples))
    if rms < 1:
        raise ValueError('Silent audio response')
    clipped = sum(abs(x) >= 32767 for x in samples)/len(samples)
    if clipped > 0.001:
        raise ValueError('Audio reaches full scale too often; listen to another generation before packaging.')
    return {'seconds': len(samples)/rate, 'peakDbFS': 20*math.log10(peak/32768),
            'rmsDbFS': 20*math.log10(rms/32768), 'fullScaleFraction': clipped}


def wav_bytes(raw, rate):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate); f.writeframes(raw)
    return buffer.getvalue()


def speech_text(text):
    # No pronunciation respelling: the earlier voice did not render it correctly.
    return text


def identity(c, text):
    value = {'config': c, 'text': text}
    if speech_text(text) != text:
        value['spoken_text'] = speech_text(text)
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=False).encode())


def cached(out, name, c, text, manifest):
    item = manifest.get(name)
    file = out/(name+'.wav')
    return bool(item and item.get('fingerprint') == identity(c, text) and file.is_file()
                and digest(file.read_bytes()) == item.get('sha256'))


def generate(c, texts, out, key, force=False):
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out/'generation.json'
    manifest = read_json(manifest_path) if manifest_path.exists() else {}
    rate = int(c['output_format'].split('_')[1])
    for name, text in texts.items():
        if not force and cached(out, name, c, text, manifest):
            print(name+': cached', flush=True)
            continue
        payload = {'text': speech_text(text), 'model_id': c['model_id'], 'voice_settings': c['voice_settings']}
        # multilingual_v2 does not support language_code. Text is already Russian.
        raw, content_type = request(key, '/v1/text-to-speech/'+c['voice_id']+'?output_format='+c['output_format'], payload)
        if not (content_type.startswith('audio/') or content_type == 'application/octet-stream'):
            raise ValueError('Expected an audio response, got '+content_type)
        if raw.startswith((b'RIFF', b'ID3', b'{', b'<')):
            raise ValueError('Response is not the requested raw PCM format')
        stats = pcm_stats(raw, rate)
        data = wav_bytes(raw, rate)
        atomic_write(out/(name+'.wav'), data)
        manifest[name] = {'text': text, 'spoken_text': speech_text(text), 'provider': 'ElevenLabs', **c, 'fingerprint': identity(c, text),
                          'sha256': digest(data), 'measurements': stats}
        write_json(manifest_path, manifest)
        print(f'{name}: saved {stats["seconds"]:.2f}s WAV; listening review required', flush=True)


def ffmpeg_run(ffmpeg, args):
    return subprocess.run([ffmpeg, '-nostdin', '-v', 'error', *args], check=True, capture_output=True).stdout


def build_package(c, out, version, ffmpeg, extra_texts=None):
    texts = phrases()
    if extra_texts:
        if any(not re.fullmatch(r'[a-z0-9-]+', name) or not isinstance(text, str) or not text.strip() or len(text)>500 or name in texts and texts[name]!=text for name,text in extra_texts.items()):
            raise ValueError('Invalid additional phrase IDs or texts')
        texts.update(extra_texts)
    manifest = read_json(out/'generation.json')
    missing = [name for name, text in texts.items() if not cached(out, name, c, text, manifest)]
    if missing:
        raise ValueError('Generate all current phrases first: '+', '.join(missing))
    original = read_json(SERVICE/'component.json')
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or tuple(map(int,version.split('.'))) <= tuple(map(int,original['version'].split('.'))):
        raise ValueError('Use a new service version higher than '+original['version'])
    # Build in isolation. Never replace released recordings or their metadata in place.
    with tempfile.TemporaryDirectory(prefix='service-', dir=out) as temp:
        stage = Path(temp)
        for f in original['files']+original['units']:
            relative = f.get('from', f.get('path'))
            target = stage/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(SERVICE/relative, target)
        voices, levels = {}, {}
        for name, text in texts.items():
            source = out/(name+'.wav')
            with wave.open(str(source), 'rb') as wav:
                if wav.getnchannels()!=1 or wav.getsampwidth()!=2:
                    raise ValueError('Expected mono PCM16 WAV')
                stats = pcm_stats(wav.readframes(wav.getnframes()), wav.getframerate())
            # Headroom only: no amplification, compressor, limiter or noise suppression.
            headroom = min(0, -3-stats['peakDbFS'])
            decoded_levels = {}
            for volume in range(10,101,10):
                relative = 'audio/'+('' if volume==100 else f'volume-{volume}/')+name+'.m4a'
                target = stage/relative; target.parent.mkdir(parents=True, exist_ok=True)
                if not any(f['path']==relative for f in original['files']):
                    original['files'].append({'path':relative,'from':relative,'mode':'0644'})
                gain = 10**(headroom/20)*volume/100
                ffmpeg_run(ffmpeg, ['-y','-i',str(source),'-map_metadata','-1','-af',f'volume={gain}',
                                    '-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)])
                pcm = ffmpeg_run(ffmpeg, ['-i',str(target),'-f','s16le','-ac','1','-ar','24000','-'])
                decoded = pcm_stats(pcm,24000)
                decoded_levels[volume] = decoded['rmsDbFS']
                sha = digest(target.read_bytes())
                if volume==100:
                    voices[name+'.m4a'] = {'text': text, 'provider': 'ElevenLabs', 'voiceId': c['voice_id'],
                        'modelId': c['model_id'], 'durationSeconds': decoded['seconds'], 'sha256': sha}
                else:
                    levels[relative] = {'volume':volume, 'source':name+'.m4a', 'sha256':sha}
            for volume in range(10,100,10):
                relative = f'audio/volume-{volume}/'+name+'.m4a'
                ratio = 10**((decoded_levels[volume]-decoded_levels[100])/20)
                if abs(ratio-volume/100) >= 0.025:
                    raise ValueError('Encoded volume level mismatch: '+relative)
                levels[relative]['rmsRatio'] = round(ratio,5)
            # The service holds the audio route using durationSeconds from this manifest.
        write_json(stage/'audio-manifest.json', voices)
        write_json(stage/'volume-manifest.json', levels)
        original['version'] = version
        write_json(stage/'component.json', original)
        from pack_voice import pack
        target = pack(out, root=stage)
        write_json(out/'package-checksums.json', {target.name: {'sha256':digest(target.read_bytes()), 'bytes':target.stat().st_size}})
        return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['plan','check','generate','package'])
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('elevenlabs-voice.json'))
    parser.add_argument('--out', type=Path, default=ROOT/'voice-generated/elevenlabs')
    parser.add_argument('--phrase', choices=['all',*phrases()], default='all')
    parser.add_argument('--prompt-key', action='store_true', help='Read the key with hidden input; never save it')
    parser.add_argument('--force', action='store_true', help='Regenerate cached phrases; consumes API credits')
    parser.add_argument('--include-dps', action='store_true', help='Include the four police-post phrases')
    version_parts = list(map(int,read_json(SERVICE/'component.json')['version'].split('.')))
    version_parts[-1] += 1
    parser.add_argument('--service-version', default='.'.join(map(str,version_parts)))
    parser.add_argument('--ffmpeg', default=os.environ.get('FFMPEG','ffmpeg'))
    args = parser.parse_args()
    c = config(args.config); texts = phrases()
    extras = read_json(Path(__file__).with_name('elevenlabs-dps-phrases.json')) if args.include_dps else None
    if extras: texts.update(extras)
    if args.phrase != 'all': texts = {args.phrase:texts[args.phrase]}
    if args.command == 'plan':
        print(json.dumps({'config':c, 'phrases':texts, 'characters':sum(map(len,texts.values())),
                          'networkRequests':0}, ensure_ascii=False, indent=2)); return
    if args.command == 'package':
        build_package(c,args.out,args.service_version,args.ffmpeg,extras); return
    if not args.prompt_key:
        from dotenv import load_dotenv
        load_dotenv(ROOT/'.env.local', override=False, interpolate=False)
    key = getpass.getpass('ElevenLabs API key (hidden): ') if args.prompt_key else os.environ.get('ELEVENLABS_API_KEY','')
    if not key.strip():
        raise ValueError('Set ELEVENLABS_API_KEY or use --prompt-key. Do not put the key in config or source files.')
    if args.command == 'check':
        print(json.dumps(check_voice(key, c['voice_id']), ensure_ascii=False))
    else:
        generate(c,texts,args.out,key,args.force)


def check_voice(key, voice_id):
    from elevenlabs import ElevenLabs
    from elevenlabs.core.api_error import ApiError
    import httpx
    # Explicitly disable redirects and retries, and never print response bodies.
    with httpx.Client(timeout=90, follow_redirects=False) as http:
        client = ElevenLabs(api_key=key, httpx_client=http)
        try:
            info = client.voices.get(voice_id=voice_id, request_options={'max_retries': 0})
        except ApiError as error:
            detail = error.body.get('detail', {}) if isinstance(error.body, dict) else {}
            if isinstance(detail, dict) and detail.get('status') == 'missing_permissions':
                raise RuntimeError('API key needs voices_read permission to check the selected voice; synthesis has not been tested.') from None
            raise RuntimeError(f'ElevenLabs voice check failed (HTTP {error.status_code}).') from None
        except Exception:
            raise RuntimeError('ElevenLabs voice check failed; check connection and SDK installation.') from None
    if info.voice_id != voice_id:
        raise ValueError('Voice ID mismatch')
    return {'voice_id':info.voice_id, 'name':info.name, 'apiCheck':'success'}


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print('ERROR: '+str(error),file=sys.stderr)
        sys.exit(1)
