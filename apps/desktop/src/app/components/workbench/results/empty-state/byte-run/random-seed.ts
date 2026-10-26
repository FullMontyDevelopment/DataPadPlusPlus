let sequence = 0

// Entropy belongs at the controller boundary; the simulation stays replayable
// for tests. A local nonce also separates rapid retries or restricted hosts.
export function newRunSeed() {
  let entropy: number
  try {
    entropy = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!
  } catch {
    entropy = Math.floor(Math.random() * 0x1_0000_0000) ^ Date.now()
  }
  sequence = (sequence + 1) >>> 0
  return (entropy ^ Math.imul(sequence, 0x9e3779b9)) >>> 0
}
