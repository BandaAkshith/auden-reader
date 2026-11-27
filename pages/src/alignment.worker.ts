import { AutoModelForCTC, AutoProcessor, AutoTokenizer, env } from '@huggingface/transformers'
import wasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'
import moduleUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url'
import { acousticWord, forcedWordSpans } from './wordTiming'

env.allowLocalModels = true
env.localModelPath = new URL('../word-model/', self.location.href).href
env.backends.onnx.wasm.numThreads = 1
env.backends.onnx.wasm.wasmPaths = {
  wasm: new URL(wasmUrl, self.location.href).href,
  mjs: new URL(moduleUrl, self.location.href).href,
}

const modelId = 'onnx-community/wav2vec2-base-960h-ONNX'
const revision = '729c1a6730fb549c20a1c73a3d3f96f11020225e'
function load() {
  return Promise.all([AutoModelForCTC.from_pretrained(modelId, { dtype: 'q8', device: 'wasm', revision }),
    AutoProcessor.from_pretrained(modelId, { revision }), AutoTokenizer.from_pretrained(modelId, { revision })])
}
let resources: ReturnType<typeof load> | undefined
let queue = Promise.resolve()

self.onmessage = ({ data }: MessageEvent<{ id: number; samples: Float32Array; words: string[] }>) => {
  queue = queue.then(async () => {
    try {
      resources ??= load().catch(error => { resources = undefined; throw error })
      const [model, processor, tokenizer] = await resources
      const vocabulary = tokenizer.model.tokens_to_ids
      const labels: number[] = []
      const wordOfLabel: number[] = []
      for (const [index, word] of data.words.entries()) {
        const normalized = acousticWord(word)
        if (!normalized) continue
        for (const letter of (labels.length ? '|' : '') + normalized) {
          const token = vocabulary.get(letter)
          if (token === undefined) continue
          labels.push(token)
          wordOfLabel.push(letter === '|' ? -1 : index)
        }
      }
      if (!labels.length) { self.postMessage({ id: data.id, spans: [] }); return }
      const inputs = await processor(data.samples)
      const { logits } = await model(inputs)
      const [, frames, width] = logits.dims
      const blank = tokenizer.pad_token_id ?? 0
      const spans = forcedWordSpans(logits.data as Float32Array, frames, width, labels, wordOfLabel, data.words.length, blank, data.samples.length / 16000)
      self.postMessage({ id: data.id, spans })
    } catch {
      self.postMessage({ id: data.id, failed: true })
    }
  })
}
