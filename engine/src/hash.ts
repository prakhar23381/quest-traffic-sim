/** FNV-1a (32-bit) over the raw bytes of a Float64Array. Exact, bit-level comparison. */
export function fnv1aFloat64(data: Float64Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
