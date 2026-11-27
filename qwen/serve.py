"""Loopback-only Qwen3 narration companion for Auden."""
import io
import json
import os
import traceback
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore
import wave

PORT = 8776
HOST = '127.0.0.1'
ADDRESS = f'{HOST}:{PORT}'
DIST = Path(__file__).resolve().parent.parent / 'pages' / 'dist'
ORIGINS = {
    'https://bandaakshith.github.io',
    f'http://{ADDRESS}',
    *(f'http://{host}:{port}' for host in ('127.0.0.1', 'localhost') for port in (5173, 4176, 4177)),
}
MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-4bit'
VOICES = {'Ryan', 'Aiden'}
VOICE_PROFILES = {
    'Deep Voice': ('Ryan', 'Use a rich, low male register and a resonant, measured delivery.'),
    'Bass Voice': ('Uncle_Fu', 'Speak English with a very warm, full-bodied male bass and a smooth delivery.'),
    'Manly Voice': ('Aiden', 'Use a mature male voice with a strong, confident delivery and clear articulation.'),
}
DIRECTIONS = {
    'plain': 'Read naturally as an audiobook narrator, with clear diction and emotionally appropriate phrasing.',
    'quiet': 'Use a hushed, intimate delivery for the quoted dialogue, then read the narration naturally.',
    'emphatic': 'Deliver the quoted dialogue with controlled anger and a sharp emphasis, then return to normal narration.',
    'sad': 'Deliver the quoted dialogue with restrained sorrow and a gentle pace, then return to normal narration.',
    'train': 'Voice the opening choo-choo as a playful imitation of a steam train, then read the narration naturally.',
    'knock': 'Voice the opening sound as two short, distinct taps imitating a knock on a wooden door.',
}
executor = ThreadPoolExecutor(max_workers=1)
slots = BoundedSemaphore(2)


def load():
    from mlx_audio.tts.utils import load_model

    print('Loading Qwen3-TTS. The first run downloads the model weights.', flush=True)
    try:
        result = load_model(os.environ.get('AUDEN_QWEN_MODEL', MODEL))
    except Exception:
        traceback.print_exc()
        raise
    print('Qwen3-TTS ready.', flush=True)
    return result


def narrate(model, text, voice, direction, speed):
    import numpy as np

    speaker, profile = VOICE_PROFILES.get(voice, (voice, ''))
    instruction = f'{profile} {DIRECTIONS[direction]}'.strip()
    if speed < 0.95:
        instruction += ' Read at a relaxed pace.'
    elif speed > 1.05:
        instruction += ' Read at a brisk pace while staying clear.'
    pcm = io.BytesIO()
    with wave.open(pcm, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(model.sample_rate)
        for result in model.generate_custom_voice(
            text=text, speaker=speaker, language='english', instruct=instruction,
            max_tokens=600, temperature=0.55,
        ):
            samples = np.asarray(result.audio, dtype=np.float32).reshape(-1)
            output.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
        if output.getnframes() == 0:
            raise RuntimeError('Qwen returned empty audio.')
    return pcm.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def log_message(self, *_):
        pass

    def allowed(self):
        return (self.headers.get('Host') == ADDRESS
                and self.headers.get('Origin') in ORIGINS)

    def local_health(self):
        return self.headers.get('Host') == ADDRESS and self.headers.get('Origin') is None

    def respond(self, status, body=b'', content_type='application/json'):
        self.send_response(status)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Vary', 'Origin')
        if self.allowed():
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            if self.headers.get('Access-Control-Request-Private-Network') == 'true':
                self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def message(self, status, **data):
        self.respond(status, json.dumps(data).encode())

    def do_OPTIONS(self):
        self.respond(204 if self.allowed() and self.path in ('/v1/health', '/v1/narrate') else 403)

    def do_GET(self):
        if not self.path.startswith('/v1/'):
            super().do_GET()
            return
        if not (self.allowed() or self.local_health()):
            self.message(403, error='This origin cannot connect to Auden Qwen.')
        elif self.path != '/v1/health':
            self.message(404, error='Unknown route.')
        elif self.server.model.done() and self.server.model.exception():
            self.message(503, state='error', error='Qwen could not initialize. Check the companion terminal.')
        else:
            self.message(200, state='ready' if self.server.model.done() else 'loading')

    def send_head(self):
        if self.headers.get('Host') != ADDRESS:
            self.send_error(403)
            return None
        path = self.path.partition('?')[0]
        if path == '/':
            self.path = '/index.html'
        file = Path(self.translate_path(self.path)).resolve()
        if not file.is_relative_to(DIST.resolve()) or not file.is_file():
            self.send_error(404, 'Build Auden with npm run build --prefix pages to serve the local reader.')
            return None
        return super().send_head()

    def do_POST(self):
        if not self.allowed():
            self.message(403, error='This origin cannot connect to Auden Qwen.')
            return
        if self.path != '/v1/narrate':
            self.message(404, error='Unknown route.')
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 4096 or self.headers.get_content_type() != 'application/json':
                raise ValueError()
            payload = json.loads(self.rfile.read(size))
            text, voice, direction, speed = (payload[key] for key in ('text', 'voice', 'direction', 'speed'))
            if (not isinstance(text, str) or not 0 < len(text.strip()) <= 420
                    or not isinstance(voice, str) or (voice not in VOICES and voice not in VOICE_PROFILES)
                    or direction not in DIRECTIONS
                    or type(speed) not in (int, float) or not 0.75 <= speed <= 2):
                raise ValueError()
        except (TypeError, ValueError, KeyError, UnicodeError):
            self.message(400, error='Invalid narration request.')
            return
        if not self.server.model.done():
            self.message(503, error='Qwen is still loading on this Mac.')
            return
        if not slots.acquire(blocking=False):
            self.message(429, error='Qwen is busy. Try again in a moment.')
            return
        try:
            model = self.server.model.result()
            audio = executor.submit(narrate, model, text.strip(), voice, direction, speed).result()
        except Exception as error:
            print(f'Qwen narration failed ({type(error).__name__}).', flush=True)
            self.message(503, error='Qwen could not render this clip.')
            return
        finally:
            slots.release()
        try:
            self.respond(200, audio, 'audio/wav')
        except (BrokenPipeError, ConnectionResetError):
            pass

    def setup(self):
        super().setup()
        self.connection.settimeout(8)


if __name__ == '__main__':
    workspace = Path(__file__).resolve().parent.parent
    os.environ.setdefault('HF_HOME', str(workspace / '.qwen-cache'))
    os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
    os.environ.setdefault('HF_HUB_DISABLE_IMPLICIT_TOKEN', '1')
    with ThreadingHTTPServer((HOST, PORT), Handler) as server:
        server.model = executor.submit(load)
        print(f'Auden Qwen listening on http://{HOST}:{PORT}', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
