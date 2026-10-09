// Browser-side dressing on top of the Geometry-Nodes-exact layout.
//
// The GN layout (layout.js, parity-checked against Blender) places tower tiers on a
// unit footprint. This pass reads those instances back per lot and adds detail that
// must be in *metres* rather than stretched with the tower: floor-aligned cornice
// ledges with lit lips, rooftop crowns (helipads, steel lattices, art-deco steps,
// antenna farms, LED crown rings, domes) and street-level shop awnings with signs.
// The pieces themselves are Geometry Nodes generators in blender/kit.py (D*, C*, A0).
// Pure function of the instance list: deterministic, infinite, no state.

import { hash2 } from './blenderHash.js';

const r01 = (s, k) => hash2(s, k * 2654435761) / 4294967296;
const HALF_PI = Math.PI / 2;
// side -> [outX, outY, tanX, tanY] (piece outward axis is -Y), as in layout.js
const SIDE = [[0, -1, 1, 0], [1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1]];

// style index -> ledge piece (prismatic towers only)
const LEDGE = {
	0: 'D0_LedgeBox', 1: 'D0_LedgeBox', 4: 'D0_LedgeBox', 5: 'D0_LedgeBox', 8: 'D0_LedgeBox', 13: 'D0_LedgeBox',
	14: 'D0_LedgeBox', 16: 'D0_LedgeBox', 2: 'D2_LedgeOcta', 3: 'D1_LedgeRound', 20: 'D1_LedgeRound', 17: 'D3_LedgeHex',
};
// crowns that suit each roof (box roofs vs round roofs); styles absent here keep their own top
const BOX_CROWNS = ['C0_Helipad', 'C1_Lattice', 'C2_Deco', 'C3_Antennas', 'C4_LEDRing', 'C4_LEDRing'];
const ROUND_CROWNS = ['C5_Dome', 'C5_Dome', 'C0_Helipad', 'C3_Antennas'];
const CROWN = {
	0: BOX_CROWNS, 1: BOX_CROWNS, 4: BOX_CROWNS, 5: BOX_CROWNS, 8: BOX_CROWNS, 10: BOX_CROWNS, 13: BOX_CROWNS, 14: BOX_CROWNS,
	19: BOX_CROWNS, 21: BOX_CROWNS, 23: BOX_CROWNS, 25: BOX_CROWNS,
	2: ROUND_CROWNS, 3: ROUND_CROWNS, 17: ROUND_CROWNS, 20: ROUND_CROWNS, 22: ROUND_CROWNS,
};
const CROWN_INSET = { 19: 0.8, 21: 0.9, 23: 0.7, 22: 0.88 }; // usable roof fraction
const AWNING_STYLES = new Set([0, 1, 4, 5, 8, 13, 14, 16, 21, 25]);
const TOP_HUNGRY = new Set(['L0_Spire', 'H0_Diamond', 'H1_Rings', 'S3_Roof']); // own the roof already

export const DRESS_PIECES = ['D0_LedgeBox', 'D1_LedgeRound', 'D2_LedgeOcta', 'D3_LedgeHex', 'C0_Helipad', 'C1_Lattice', 'C2_Deco',
	'C3_Antennas', 'C4_LEDRing', 'C5_Dome', 'A0_Awning'];

/**
 * @param list   emitted instances of one block: [piece, x, y, z, rot, sx, sy, sz, a0, a1, a2, a3]
 * @param towers piece name -> style index
 * @param FH     floor height
 * @param out    receives the dressed list (same tuple layout)
 */
export function dressBlock(list, towers, FH, out) {
	// group the tiers of each lot by building seed
	const lots = new Map();
	for (const e of list) {
		const style = towers.get(e[0]);
		if (style === undefined) continue;
		let L = lots.get(e[9]);
		if (!L) lots.set(e[9], (L = { style, tiers: [], busyRoof: false, crown: null }));
		L.tiers.push(e);
	}
	for (const e of list) {
		if (TOP_HUNGRY.has(e[0])) {
			const L = lots.get(e[9]);
			if (L) L.busyRoof = true;
		}
	}
	for (const [bseed, L] of lots) {
		const s = Math.floor(bseed * 16777216) | 0;
		const hue = L.tiers[0][8], trim = L.tiers[0][11];
		L.tiers.sort((a, b) => a[3] - b[3]);

		// ---- cornice ledges every k floors, lit on ~45% of towers
		const lp = LEDGE[L.style];
		if (lp && r01(s, 1) < 0.72) {
			const every = 5 + Math.floor(r01(s, 2) * 8);
			const lit = trim || r01(s, 3) < 0.45 ? 1 : 0;
			const th = 0.35 + r01(s, 4) * 0.5;
			for (const t of L.tiers) {
				const f0 = Math.round(t[3] / FH), f1 = Math.round((t[3] + t[7]) / FH);
				for (let f = Math.max(f0 + 2, every * Math.ceil((f0 + 2) / every)); f <= f1 - 2; f += every) {
					out.push([lp, t[1], t[2], f * FH - th * 0.5, 0, t[5], t[6], th, hue, bseed, 0, lit]);
				}
			}
		}

		// ---- rooftop crown on the top tier
		const top = L.tiers[L.tiers.length - 1];
		const crowns = CROWN[L.style];
		if (crowns && !L.busyRoof && r01(s, 5) < 0.62) {
			const piece = crowns[Math.floor(r01(s, 6) * crowns.length)];
			const k = CROWN_INSET[L.style] ?? 1;
			const w = top[5] * k, d = top[6] * k, m = Math.min(w, d);
			const round = piece === 'C5_Dome';
			const prog = Math.floor(r01(s, 7) * 8);
			out.push([piece, top[1], top[2], top[3] + top[7], 0, round ? m : w, round ? m : d, m, hue, bseed, prog, 1]);
			L.crown = piece;
		}

		// ---- street awnings + shop signs along the ground floor
		const t0 = L.tiers[0];
		if (AWNING_STYLES.has(L.style) && t0[3] < 0.5) {
			for (let side = 0; side < 4; side++) {
				const [ox, oy, tx, ty] = SIDE[side];
				const even = side % 2 === 0;
				const halfPerp = (even ? t0[6] : t0[5]) * 0.5, len = even ? t0[5] : t0[6];
				const n = Math.floor((len - 2) / 7.5);
				for (let j = 0; j < n; j++) {
					const h = r01(s, 20 + side * 16 + j);
					if (h > 0.5) continue;
					const along = (j + 0.5) * ((len - 2) / n) - (len - 2) / 2;
					out.push(['A0_Awning', t0[1] + ox * halfPerp + tx * along, t0[2] + oy * halfPerp + ty * along, FH * 1.15 + 0.15,
						side * HALF_PI, 1, 1, 1, (hue + Math.floor(h * 8)) % 4, bseed + j * 0.071, Math.floor(r01(s, 90 + j) * 64), 7]);
				}
			}
		}
	}
	// the original instances; crowned roofs drop their loose roof clutter
	for (const e of list) {
		if (e[0][0] === 'R') {
			const L = lots.get(e[9]);
			if (L?.crown) continue;
		}
		out.push(e);
	}
	return out;
}
