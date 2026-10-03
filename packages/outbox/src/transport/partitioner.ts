/** Kafka DefaultPartitioner murmur2 (Utils.java / @platformatic/kafka port). */
const seed = 0x9747b28cn;
const m = 0x5bd1e995n;
const r = 24n;

function tripleRightShift(num: bigint, bits: bigint): bigint {
  return BigInt(Number(BigInt.asIntN(32, num)) >>> Number(bits));
}

export function murmur2(data: Uint8Array): number {
  const length = data.length;
  let h = seed ^ BigInt(length);
  let i = 0;
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  while (i < length - 3) {
    let k = BigInt(buf.readInt32LE(i));
    i += 4;
    k *= m;
    k ^= tripleRightShift(k, r);
    k *= m;
    h *= m;
    h ^= k;
  }
  if (length % 4 > 0) {
    const tail = Buffer.alloc(4);
    buf.copy(tail, 0, length - (length % 4));
    h ^= BigInt(tail.readInt32LE(0));
    h *= m;
  }
  h ^= tripleRightShift(h, 13n);
  h *= m;
  h ^= tripleRightShift(h, 15n);
  return Number(BigInt.asIntN(32, h));
}

export function toPositive(n: number): number {
  return n & 0x7fffffff;
}

export function partitionForKey(key: string, numPartitions: number): number {
  if (numPartitions <= 0) return 0;
  return toPositive(murmur2(Buffer.from(key, 'utf8'))) % numPartitions;
}
