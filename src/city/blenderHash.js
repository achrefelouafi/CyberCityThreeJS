// Exact port of Blender's noise::hash (Bob Jenkins' lookup3 "final" mix) as used
// by the Geometry Nodes "Random Value" node. Verified empirically against
// Blender 5.1 (see scripts/parity.mjs):
//   FLOAT   value = hash_to_float(seed, id)            in [0, 1]
//   INT     value = min + hash(id, seed) % (max - min + 1)
//   BOOLEAN value = hash_to_float(id, seed) <= probability

const rot = (x, k) => (x << k) | (x >>> (32 - k));

export function hash2(kx, ky) {
	let a = (0xdeadbeef + (2 << 2) + 13) | 0;
	let b = a;
	let c = a;
	a = (a + kx) | 0;
	b = (b + ky) | 0;
	c ^= b; c = (c - rot(b, 14)) | 0;
	a ^= c; a = (a - rot(c, 11)) | 0;
	b ^= a; b = (b - rot(a, 25)) | 0;
	c ^= b; c = (c - rot(b, 16)) | 0;
	a ^= c; a = (a - rot(c, 4)) | 0;
	b ^= a; b = (b - rot(a, 14)) | 0;
	c ^= b; c = (c - rot(b, 24)) | 0;
	return c >>> 0;
}

const f32 = Math.fround;
const INV = f32(4294967295); // float(0xFFFFFFFFu) rounds to 2^32

export const hashToFloat = (kx, ky) => f32(f32(hash2(kx, ky)) / INV);

/** Random Value (FLOAT) with min 0 / max 1. */
export const randF = (id, seed) => hashToFloat(seed, id);

/** Random Value (INT). */
export const randI = (lo, hi, id, seed) => lo + (hash2(id, seed) % (hi - lo + 1));
