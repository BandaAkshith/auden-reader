import { KokoroTTS } from 'kokoro-js'
import { env, RawAudio, Tensor } from '@huggingface/transformers'
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'
import moduleUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url'
import { naturalVoices, type NaturalVoice } from './voiceCatalog'

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: (event: MessageEvent<{ kind: 'prepare' | 'synthesize' | 'cancel'; id: number; session: number; text?: string; voice: NaturalVoice; speed?: number }>) => void
}

env.allowLocalModels = false
env.backends.onnx.wasm.numThreads = 1
env.backends.onnx.wasm.wasmPaths = {
  wasm: new URL(wasmUrl, self.location.href).href,
  mjs: new URL(moduleUrl, self.location.href).href,
}

const voiceFiles = import.meta.glob<string>(['../node_modules/kokoro-js/voices/am_michael.bin', '../node_modules/kokoro-js/voices/af_heart.bin', '../node_modules/kokoro-js/voices/af_bella.bin', '../node_modules/kokoro-js/voices/af_nicole.bin', '../node_modules/kokoro-js/voices/af_nova.bin', '../node_modules/kokoro-js/voices/am_adam.bin', '../node_modules/kokoro-js/voices/am_echo.bin', '../node_modules/kokoro-js/voices/bm_george.bin', '../node_modules/kokoro-js/voices/bm_lewis.bin', '../node_modules/kokoro-js/voices/bf_emma.bin', '../node_modules/kokoro-js/voices/bf_isabella.bin'], {
  eager: true, query: '?url', import: 'default',
})
const voices = new Map<string, Promise<Float32Array>>()

async function loadVoice(voice: string) {
  const file = Object.hasOwn(naturalVoices, voice) && voiceFiles[`../node_modules/kokoro-js/voices/${voice}.bin`]
  if (!file) throw new Error('This Kokoro voice is unavailable.')
  let asset = voices.get(voice)
  if (!asset) {
    asset = fetch(new URL(file, self.location.href)).then(async response => {
      if (!response.ok) throw new Error('The voice file could not be loaded.')
      return new Float32Array(await response.arrayBuffer())
    }).catch(error => { voices.delete(voice); throw error })
    voices.set(voice, asset)
  }
  return asset
}

// Keep Kokoro's phonemization and tokenization. Load its published voice
// embeddings from Auden's origin instead of changing the worker's fetch cache.
class BrowserKokoro extends KokoroTTS {
  override async generate_from_ids(ids: Parameters<KokoroTTS['generate_from_ids']>[0], { voice = 'af_heart', speed = 1 }: Parameters<KokoroTTS['generate_from_ids']>[1] = {}) {
    const row = Math.min(509, Math.max(0, (ids.dims.at(-1) || 2) - 2)) * 256
    const voiceStyle = (await loadVoice(voice)).slice(row, row + 256)
    scope.postMessage({ id: activeRequest, phase: 'Synthesizing voice…' })
    const { waveform } = await this.model({
      input_ids: ids, style: new Tensor('float32', voiceStyle, [1, 256]), speed: new Tensor('float32', [speed], [1]),
    })
    scope.postMessage({ id: activeRequest, phase: 'Preparing playback…' })
    return new RawAudio(Float32Array.from(waveform.data), 24_000)
  }
}

let activeRequest = -1
let model: Promise<KokoroTTS> | undefined
let queue = Promise.resolve()
let cancelledThrough = -1

scope.onmessage = ({ data: { kind, id, session, text, voice, speed } }) => {
  if (kind === 'cancel') {
    cancelledThrough = Math.max(cancelledThrough, session)
    return
  }
  queue = queue.then(async () => {
    if (kind === 'synthesize' && session <= cancelledThrough) {
      scope.postMessage({ id, error: 'Narration changed position.' })
      return
    }
    activeRequest = id
    try {
      model ??= KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: progress => {
          if (progress.status === 'progress' && progress.file.endsWith('.onnx')) {
            scope.postMessage({ id, progress: Math.round(progress.progress) })
          }
        },
      }).then(engine => new BrowserKokoro(engine.model, engine.tokenizer))
        .catch(error => { model = undefined; throw error })
      const [engine] = await Promise.all([model, loadVoice(voice)])
      if (kind === 'prepare') { scope.postMessage({ id, ready: true }); return }
      scope.postMessage({ id, phase: 'Generating audio…' })
      const result = await engine.generate(text, { voice, speed })
      const samples = result.audio
      if (!samples.length) throw new Error('The voice returned empty audio.')
      scope.postMessage({ id, samples, sampleRate: result.sampling_rate }, [samples.buffer])
    } catch (error) {
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
