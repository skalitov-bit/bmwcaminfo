#!/usr/bin/env python3
"""Generate model warnings, matching the existing release's Russian voice and normalization.

Dependencies: edge-tts, gTTS, imageio-ffmpeg, mutagen. Existing generic recordings are preserved.
"""
import asyncio
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
import edge_tts
import imageio_ffmpeg
from gtts import gTTS
from mutagen.mp4 import MP4

ROOT = Path(__file__).resolve().parents[1] / 'native/bmwcaminfo-voice'
FILTER = 'acompressor=threshold=-24dB:ratio=4:attack=5:release=80:makeup=10dB,loudnorm=I=-8:TP=-0.3:LRA=4,alimiter=limit=0.99'

async def main():
    phrases = json.loads((ROOT / 'phrases.json').read_text(encoding='utf-8'))
    audio = ROOT / 'audio'
    audio.mkdir(exist_ok=True)
    report = {}
    for key, phrase in [('camera-500', 'Внимание, впереди камера'), ('camera-200', 'Повторное предупреждение. Камера через двести метров')]:
        original = audio / (key + '.m4a')
        if not original.exists():
            raise FileNotFoundError(f'Provide the existing generic recording first: {original}')
        report[original.name] = {'text': phrase, 'provider': 'existing generic recording', 'durationSeconds': MP4(original).info.length, 'sha256': hashlib.sha256(original.read_bytes()).hexdigest()}
    with tempfile.TemporaryDirectory(prefix='speedcam-voice-') as temp:
        for key, phrase in phrases.items():
            mp3 = Path(temp) / (key + '.mp3')
            provider = 'ru-RU-SvetlanaNeural'
            try:
                await asyncio.wait_for(edge_tts.Communicate(phrase, provider, rate='-5%', volume='+50%').save(str(mp3)), timeout=45)
            except Exception as error:
                print(f'{key}: Edge TTS unavailable ({type(error).__name__}); using Google Russian TTS', flush=True)
                provider = 'Google Translate Russian TTS'
                await asyncio.to_thread(gTTS(phrase, lang='ru', timeout=(10, 30)).save, str(mp3))
            out = audio / (key + '.m4a')
            subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-af', FILTER, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(out)], check=True)
            duration = MP4(out).info.length
            assert 1 < duration < 20, (key, duration)
            report[out.name] = {'text': phrase, 'provider': provider, 'durationSeconds': duration, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}
            print(f'{key}: {duration:.2f} s, {provider}', flush=True)
    (ROOT / 'audio-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    asyncio.run(main())
