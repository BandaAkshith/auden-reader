// Overlap nearby matching portions of speech so the clip's length changes
// without shifting the pitch of the narrator.
export function stretchSpeech(input: Float32Array, sampleRate: number, speed: number) {
  if (speed === 1 || input.length < 2) return input
  const output = new Float32Array(Math.max(1, Math.round(input.length / speed)))
  const overlap = Math.min(Math.round(sampleRate * .018), input.length, output.length)
  const search = Math.round(sampleRate * .011)
  const stride = Math.max(1, Math.round(sampleRate / 6000))
  const step = stride * 2
  const weights = Array.from({ length: overlap }, (_, i) => .5 - .5 * Math.cos(Math.PI * i / overlap))

  output.set(input.subarray(0, Math.min(overlap * 2, output.length)))
  for (let at = overlap; at < output.length; at += overlap) {
    const width = Math.min(overlap * 2, output.length - at)
    const blend = Math.min(overlap, width)
    const last = Math.max(0, input.length - width)
    const expected = Math.min(last, Math.round(at * speed))
    let start = expected
    if (blend > overlap / 2) {
      let referenceEnergy = 0
      for (let i = 0; i < blend; i += stride) referenceEnergy += output[at + i] ** 2
      if (referenceEnergy > .00001) {
        let best = -Infinity
        for (let position = Math.max(0, expected - search); position <= Math.min(last, expected + search); position += step) {
          let match = 0
          let energy = 0
          for (let i = 0; i < blend; i += stride) {
            const value = input[position + i]
            match += value * output[at + i]
            energy += value * value
          }
          const score = match / Math.sqrt(referenceEnergy * energy + 1e-12) - .06 * Math.abs(expected - position) / Math.max(1, search)
          if (score > best) { best = score; start = position }
        }
      }
    }
    for (let i = 0; i < blend; i++) output[at + i] = output[at + i] * (1 - weights[i]) + input[start + i] * weights[i]
    output.set(input.subarray(start + blend, start + width), at + blend)
  }
  return output
}

// Match audible level gently across independently generated pieces. Include
// quiet delivery in the level target and leave loud peaks room to breathe.
export function balanceSpeech(samples: Float32Array, target: number) {
  let energy = 0
  let audible = 0
  let peak = 0
  for (const sample of samples) {
    const magnitude = Math.abs(sample)
    peak = Math.max(peak, magnitude)
    if (magnitude < .012) continue
    energy += sample * sample
    audible++
  }
  if (!audible) return
  const rms = Math.sqrt(energy / audible)
  const gain = Math.min(.98 / peak, Math.max(.74, Math.min(1.28, target / rms)))
  for (let i = 0; i < samples.length; i++) samples[i] *= gain
}
