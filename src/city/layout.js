// Line-by-line port of blender/city.py (CC_CityGenerator).
//
// Everything is evaluated in Blender space (x east, y north, z up) with float32
// rounding at the same places Geometry Nodes rounds, so a given seed produces
// the same instances in the browser and in Blender (verified by scripts/parity.mjs).
// The only difference: Blender evaluates a finite preview window, this module
// evaluates any block on demand - the city is infinite.

import { randF, randI } from './blenderHash.js';

const F = Math.fround;
export const N_STYLES = 26;
const ROUND_STYLES = new Set([2, 3, 6, 17, 20, 22]); // square footprint (octa, round, twist, hex, bundle, halo)
const BOXY_STYLES = new Set([0, 1, 4, 5, 8, 13, 14, 16, 25]); // corner trims + facade clutter
const HALF_PI = F(Math.PI / 2);
const K = {
	p03: F(0.3), p06: F(0.6), p08: F(0.8), p09: F(0.9), p13: F(1.3), p16: F(1.6), p022: F(0.22),
	p045: F(0.45), p062: F(0.62), p078: F(0.78), p075: F(0.75),
	p038: F(0.38), p053: F(0.53), p066: F(0.66), p082: F(0.82), p25: F(2.5), p12: F(1.2),
};

export const PIECES = {
	towers: ['T00_Pillars', 'T01_Fins', 'T02_Octa', 'T03_Round', 'T04_Spine', 'T05_Stack', 'T06_Twist', 'T07_Taper', 'T08_Diagrid',
		'T09_Ziggurat', 'T10_Cantilever', 'T11_LPlan', 'T12_Cross', 'T13_Kowloon', 'T14_Arcology', 'T15_Blade', 'T16_Deco', 'T17_Hex',
		'T18_Pagoda', 'T19_Tyrell', 'T20_Bundle', 'T21_Exo', 'T22_Halo', 'T23_Capsule', 'T24_Sail', 'T25_Portal'],
	roof: ['R0_ACUnit', 'R1_WaterTank', 'R2_Antenna', 'R3_Dish', 'R4_Hut', 'R5_Vents'],
	signs: ['S0_Blade', 'S1_Wide', 'S2_Tall', 'S3_Roof', 'S4_Disc', 'S5_Banner'],
	facade: ['F0_WallAC', 'F1_Balcony', 'F2_Pipes'],
	holo: ['H0_Diamond', 'H1_Rings'],
};

/** Map GN input names (as exported in manifest.json) to layout params. */
export function paramsFromValues(v) {
	return {
		seed: v['Seed'], B: F(v['Block Size']), SW: F(v['Street Width']), n: v['Lots Per Side'],
		G: F(v['Lot Gap']), I: F(v['Max Inset']), MC: F(v['Mega Block Chance']),
		hmin: F(v['Height Min']), hmax: F(v['Height Max']), hpow: F(v['Height Power']),
		D: v['District Size'], DF: F(v['District Floor']), LC: F(v['Landmark Chance']), LB: F(v['Landmark Boost']),
		FH: F(v['Floor Height']), TC: F(v['Tier Chance']), SB: F(v['Setback']),
		RC: v['Roof Clutter'], SD: v['Sign Density'], BC: F(v['Billboard Chance']), RSC: F(v['Roof Sign Chance']),
		TRC: F(v['Trim Chance']), BRC: F(v['Skybridge Chance']), HC: F(v['Hologram Chance']), TT: F(v['Trim Thickness']),
		SS: F(v['Sign Scale'] ?? 1), FC: v['Facade Clutter'] ?? 0,
	};
}

export class CityLayout {
	constructor(params, channels) {
		this.CH = channels;
		this.setParams(params);
	}

	setParams(p) {
		this.p = p;
		this.S = Math.imul(p.seed, 7919);
		this.pitch = F(p.B + p.SW);
		this.lotRegular = F(F(p.B - F((p.n - 1) * p.G)) / p.n);
		this._t0Cache = new Map();
		this._solids = new Map();
	}

	// ---------------------------------------------------------------- hashing (CC_Rand)
	seedOf(y, ch) { return (Math.imul(y, 64) + ch + this.S) | 0; }
	R(x, y, ch) { return randF(x, this.seedOf(y, this.CH[ch])); }
	RI(x, y, ch, lo, hi) { return randI(lo, hi, x, this.seedOf(y, this.CH[ch])); }
	RItem(lx, ly, k, ch) { return randF((Math.imul(lx, 16) + k) | 0, this.seedOf(ly, this.CH[ch])); }
	RIItem(lx, ly, k, ch, lo, hi) { return randI(lo, hi, (Math.imul(lx, 16) + k) | 0, this.seedOf(ly, this.CH[ch])); }

	// ---------------------------------------------------------------- grid
	blockMin(b) { return F(F(b * this.pitch) + F(this.p.SW * 0.5)); }

	district(bx, by) {
		const D = this.p.D;
		const cx = Math.floor(bx / D), cy = Math.floor(by / D);
		const fx = F(F((bx - cx * D) + 0.5) / D);
		const fy = F(F((by - cy * D) + 0.5) / D);
		const v00 = this.R(cx, cy, 'DIST'), v10 = this.R(cx + 1, cy, 'DIST');
		const v01 = this.R(cx, cy + 1, 'DIST'), v11 = this.R(cx + 1, cy + 1, 'DIST');
		const sx = smooth(fx), sy = smooth(fy);
		const d = lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
		return lerp(this.p.DF, 1, d);
	}

	mega(bx, by) { return this.R(bx, by, 'MEGA') < this.p.MC; }
	lotSize(mega) { return mega ? this.p.B : this.lotRegular; }
	lotCenter(bmin, a, ls) { return F(bmin + F(F(a * F(ls + this.p.G)) + F(ls * 0.5))); }

	mass(bx, by, lx, ly, mega) {
		const p = this.p;
		const dist = this.district(bx, by);
		const base = F(p.hmin + F(F(F(p.hmax - p.hmin) * F(Math.pow(this.R(lx, ly, 'H'), p.hpow))) * dist));
		const landmark = this.R(lx, ly, 'LANDMARK') < F(p.LC * dist);
		const h1 = landmark ? F(base * p.LB) : base;
		const h2 = mega ? F(h1 * K.p13) : h1;
		const floors = Math.max(Math.floor(F(F(h2 / p.FH) + 0.5)), 3);
		const tr = this.R(lx, ly, 'TIER');
		const tRaw = 1 + (tr < p.TC ? 1 : 0) + (tr < F(p.TC * K.p045) ? 1 : 0);
		const tiers = floors < 10 ? 1 : tRaw;
		return { dist, landmark, floors, tiers };
	}

	boundary(i, tiers) {
		if (i <= 0) return 0;
		if (i >= tiers) return 1;
		if (tiers === 2) return K.p062;
		return i === 1 ? 0.5 : K.p078;
	}

	floorAt(i, floors, tiers) { return Math.floor(F(F(floors * this.boundary(i, tiers)) + 0.5)); }

	t0Top(bx, by, a, b) {
		const key = `${bx},${by},${a},${b}`;
		let v = this._t0Cache.get(key);
		if (v !== undefined) return v;
		const mega = this.mega(bx, by);
		if (mega) { a = 0; b = 0; }
		const n = this.p.n;
		const m = this.mass(bx, by, bx * n + a, by * n + b, mega);
		v = F(this.floorAt(1, m.floors, m.tiers) * this.p.FH);
		if (this._t0Cache.size > 50000) this._t0Cache.clear();
		this._t0Cache.set(key, v);
		return v;
	}

	// ---------------------------------------------------------------- generation
	/**
	 * Generate every instance of block (bx, by).
	 * emit(piece, x, y, z, rotZ, sx, sy, sz, a0, a1, a2, a3) in Blender space; a* are
	 * shading attributes: towers (hue, seed, windowStyle, trim), signs (hue, seed, atlas, flags)...
	 */
	block(bx, by, emit, detail = true) {
		const p = this.p, n = p.n;
		const mega = this.mega(bx, by);
		const ls = this.lotSize(mega);
		const bminx = this.blockMin(bx), bminy = this.blockMin(by);
		const lots = mega ? 1 : n;
		for (let b = 0; b < lots; b++) {
			for (let a = 0; a < lots; a++) {
				this.lot(bx, by, a, b, mega, ls, bminx, bminy, emit, detail);
			}
		}
		this.street(bx, by, bminx, bminy, emit, detail);
	}

	lot(bx, by, a, b, mega, ls, bminx, bminy, emit, detail) {
		const p = this.p, n = p.n;
		const lx = bx * n + a, ly = by * n + b;
		const cx = this.lotCenter(bminx, a, ls);
		const cy = this.lotCenter(bminy, b, ls);
		let w = Math.max(F(ls - F(F(this.R(lx, ly, 'INSET_X') * p.I) * 2)), 6);
		let d = Math.max(F(ls - F(F(this.R(lx, ly, 'INSET_Y') * p.I) * 2)), 6);
		const style = this.RI(lx, ly, 'STYLE', 0, N_STYLES - 1);
		if (ROUND_STYLES.has(style)) { const m = Math.min(w, d); w = m; d = m; }
		const { landmark, floors, tiers } = this.mass(bx, by, lx, ly, mega);
		const H = F(floors * p.FH);

		const hue = this.RI(lx, ly, 'TRIM_HUE', 0, 3);
		const bseed = this.R(lx, ly, 'BSEED');
		const wstyle = this.RI(lx, ly, 'WSTYLE', 0, 3);
		const trimOn = this.R(lx, ly, 'TRIM') < p.TRC;
		const hasCorners = BOXY_STYLES.has(style);
		const rOffX = F(this.R(lx, ly, 'OFF_X') - 0.5);
		const rOffY = F(this.R(lx, ly, 'OFF_Y') - 0.5);
		const k1SB = F(1 - p.SB);

		// ---- tiers + neon trims
		for (let t = 0; t < tiers; t++) {
			const z0 = F(this.floorAt(t, floors, tiers) * p.FH);
			const z1 = F(this.floorAt(t + 1, floors, tiers) * p.FH);
			const st = F(Math.pow(k1SB, t));
			const wt = F(w * st), dt = F(d * st);
			const tx = F(cx + F(rOffX * F(w - wt)));
			const ty = F(cy + F(rOffY * F(d - dt)));
			emit(PIECES.towers[style], tx, ty, z0, 0, wt, dt, F(z1 - z0), hue, bseed, wstyle, trimOn ? 1 : 0);
			if (trimOn && hasCorners) {
				const TT = p.TT, hw = F(wt * 0.5), hd = F(dt * 0.5), zt = F(z1 - TT), hz = F(z1 - z0);
				emit('P3_NeonBar', F(tx - hw), F(ty - hd), z0, 0, TT, TT, hz, hue, bseed, 0, 1);
				emit('P3_NeonBar', F(tx + hw), F(ty - hd), z0, 0, TT, TT, hz, hue, bseed, 0, 1);
				emit('P3_NeonBar', F(tx + hw), F(ty + hd), z0, 0, TT, TT, hz, hue, bseed, 0, 1);
				emit('P3_NeonBar', F(tx - hw), F(ty + hd), z0, 0, TT, TT, hz, hue, bseed, 0, 1);
				emit('P3_NeonBar', tx, F(ty - hd), zt, 0, wt, TT, TT, hue, bseed, 0, 1);
				emit('P3_NeonBar', F(tx + hw), ty, zt, 0, TT, dt, TT, hue, bseed, 0, 1);
				emit('P3_NeonBar', tx, F(ty + hd), zt, 0, wt, TT, TT, hue, bseed, 0, 1);
				emit('P3_NeonBar', F(tx - hw), ty, zt, 0, TT, dt, TT, hue, bseed, 0, 1);
			}
		}

		// ---- roofscape
		const stT = F(Math.pow(k1SB, tiers - 1));
		const wT = F(w * stT), dT = F(d * stT);
		const rx = F(cx + F(rOffX * F(w - wT)));
		const ry = F(cy + F(rOffY * F(d - dT)));
		if (detail && wT >= 10 && dT >= 10) {
			for (let k = 0; k < p.RC; k++) {
				const ipx = F(F(this.RItem(lx, ly, k, 'ROOF_PX') - 0.5) * F(wT - 6));
				const ipy = F(F(this.RItem(lx, ly, k, 'ROOF_PY') - 0.5) * F(dT - 6));
				const rot = F(this.RIItem(lx, ly, k, 'ROOF_ROT', 0, 3) * HALF_PI);
				const type = this.RIItem(lx, ly, k, 'ROOF_TYPE', 0, 5);
				emit(PIECES.roof[type], F(rx + ipx), F(ry + ipy), H, rot, 1, 1, 1, 0, bseed, k, 0);
			}
		}
		const holo = landmark && this.R(lx, ly, 'HOLO') < p.HC;
		if (landmark && !holo) {
			const s = F(Math.min(wT, dT) * K.p03);
			emit('L0_Spire', rx, ry, H, 0, s, s, F(H * K.p022), hue, bseed, 0, 1);
		}
		if (holo) {
			const s2 = F(Math.min(wT, dT) * K.p09);
			const type = this.RI(lx, ly, 'HOLO_TYPE', 0, 1);
			emit(PIECES.holo[type], rx, ry, F(F(H + F(s2 * K.p06)) + 6), 0, s2, s2, s2, hue, bseed, type, 0);
		}
		if (!landmark && this.R(lx, ly, 'RSIGN') < p.RSC && wT >= 14 && dT >= 8) {
			const side = this.RI(lx, ly, 'RSIGN_SIDE', 0, 3);
			const face = side % 2 === 0 ? wT : dT;
			const rsc = Math.min(1, F(face / 15));
			emit('S3_Roof', rx, ry, H, F(side * HALF_PI), rsc, 1, 1,
				this.RI(lx, ly, 'RSIGN_HUE', 0, 3), bseed, this.RI(lx, ly, 'RSIGN_ATLAS', 0, 63), 1 + 2 + 4);
		}

		// ---- facade signs (on tier 0)
		const h0 = F(this.floorAt(1, floors, tiers) * p.FH);
		if (h0 > 20) {
			const hw = F(w * 0.5), hd = F(d * 0.5);
			const zr = Math.min(F(h0 - F(F(p.SS * 9) + 8)), 90);
			for (let k = 0; k < p.SD; k++) {
				const side = this.RIItem(lx, ly, k, 'SIGN_SIDE', 0, 3);
				const [ox, oy, tx, ty] = SIDE[side];
				const even = side % 2 === 0;
				const halfPerp = even ? hd : hw;
				const halfAlong = even ? hw : hd;
				const along = F(F(F(this.RItem(lx, ly, k, 'SIGN_ALONG') - 0.5) * 2) * Math.max(F(halfAlong - 3), 0));
				const tr = this.RItem(lx, ly, k, 'SIGN_TYPE');
				const stype = tr < K.p038 ? 0 : tr < K.p053 ? 1 : tr < K.p066 ? 2 : tr < K.p082 ? 4 : 5;
				const z = F(4 + F(this.RItem(lx, ly, k, 'SIGN_Z') * zr));
				const scl0 = F(F(K.p075 + F(this.RItem(lx, ly, k, 'SIGN_SCALE') * K.p06)) * p.SS);
				const scl = stype === 5 ? F(scl0 * K.p06) : scl0;
				const sx = F(cx + F(F(ox * halfPerp) + F(tx * along)));
				const sy = F(cy + F(F(oy * halfPerp) + F(ty * along)));
				emit(PIECES.signs[stype], sx, sy, z, F(side * HALF_PI), scl, scl, scl,
					this.RIItem(lx, ly, k, 'SIGN_HUE', 0, 3), bseed + k * 0.137,
					this.RIItem(lx, ly, k, 'SIGN_ATLAS', 0, 63), 1 + 4 + (stype === 1 ? 2 : 0) + (stype === 4 ? 8 : 0));
			}
		}

		// ---- facade clutter: AC units, balconies, pipe runs (box-like towers only)
		if (BOXY_STYLES.has(style) && h0 > 12) {
			const hw = F(w * 0.5), hd = F(d * 0.5);
			const fmax = Math.min(F(F(h0 / p.FH) - 1), 18);
			for (let k = 0; k < p.FC; k++) {
				const side = this.RIItem(lx, ly, k, 'CLUT_SIDE', 0, 3);
				const [ox, oy, tx, ty] = SIDE[side];
				const even = side % 2 === 0;
				const halfPerp = even ? hd : hw, halfAlong = even ? hw : hd;
				const along = F(F(F(this.RItem(lx, ly, k, 'CLUT_ALONG') - 0.5) * 2) * Math.max(F(halfAlong - K.p25), 0));
				const ct = this.RIItem(lx, ly, k, 'CLUT_TYPE', 0, 9);
				const piece = ct < 6 ? 0 : ct < 9 ? 1 : 2;
				const fl = Math.floor(F(this.RItem(lx, ly, k, 'CLUT_Z') * fmax));
				const z = piece === 2 ? 0 : F(F(fl * p.FH) + K.p12);
				const cxp = F(cx + F(F(ox * halfPerp) + F(tx * along)));
				const cyp = F(cy + F(F(oy * halfPerp) + F(ty * along)));
				emit(PIECES.facade[piece], cxp, cyp, z, F(side * HALF_PI), 1, 1, piece === 2 ? h0 : 1, hue, bseed, 0, 0);
			}
		}

		// ---- LED billboard
		if (this.R(lx, ly, 'BB') < p.BC && h0 > 40) {
			const side = this.RI(lx, ly, 'BB_SIDE', 0, 3);
			const [ox, oy] = SIDE[side];
			const even = side % 2 === 0;
			const face = even ? w : d;
			const halfPerp = even ? F(d * 0.5) : F(w * 0.5);
			const s = Math.min(F(F(face * K.p08) / 16), F(K.p06 + F(this.R(lx, ly, 'BB_SCALE') * K.p16)));
			const z = F(10 + F(this.R(lx, ly, 'BB_Z') * Math.max(F(F(h0 - F(s * 9)) - 16), 0)));
			emit('B0_Billboard', F(cx + F(ox * halfPerp)), F(cy + F(oy * halfPerp)), z, F(side * HALF_PI), s, s, s,
				hue, bseed, this.RI(lx, ly, 'BB_CONTENT', 0, 7), 0);
		}
	}

	street(bx, by, bminx, bminy, emit, detail) {
		const p = this.p, n = p.n, B = p.B;
		const bcx = F(bminx + F(B * 0.5)), bcy = F(bminy + F(B * 0.5));
		emit('P0_Sidewalk', bcx, bcy, 0, 0, B, B, K.p03, 0, 0, 0, 0);
		if (detail) {
			const m = Math.max(Math.floor(F(B / 18)), 1);
			const seg = F(B / m), hp = F(F(B * 0.5) - K.p08), hB = F(B * 0.5);
			for (let q = 0; q < 4 * m; q++) {
				const side = Math.floor(q / m), jj = q % m;
				const [ox, oy, tx, ty] = SIDE[side];
				const along = F(F(F(jj + 0.5) * seg) - hB);
				emit('P1_Lamp', F(bcx + F(F(ox * hp) + F(tx * along))), F(bcy + F(F(oy * hp) + F(ty * along))), K.p03,
					F(side * HALF_PI), 1, 1, 1, 0, (bx * 7 + by * 13 + q) % 17 / 17, 0, 0);
			}
		}
		// skybridges
		const span = F(p.SW + F(F(p.I + 2) * 2));
		if (this.R(bx, by, 'BRX') < p.BRC) {
			const row = this.RI(bx, by, 'BRX_ROW', 0, 8) % n;
			const tA = this.t0Top(bx, by, n - 1, row), tB = this.t0Top(bx + 1, by, 0, row);
			const z = F(10 + F(this.R(bx, by, 'BRX_Z') * Math.max(F(Math.min(tA, tB) - 18), 0)));
			const y = this.lotCenter(bminy, row, this.lotRegular);
			emit('P2_Skybridge', F((bx + 1) * this.pitch), y, z, 0, span, 1, 1, this.RI(bx, by, 'BRX_HUE', 0, 3), 0.5, 0, 1);
		}
		if (this.R(bx, by, 'BRY') < p.BRC) {
			const col = this.RI(bx, by, 'BRY_COL', 0, 8) % n;
			const tC = this.t0Top(bx, by, col, n - 1), tD = this.t0Top(bx, by + 1, col, 0);
			const z = F(10 + F(this.R(bx, by, 'BRY_Z') * Math.max(F(Math.min(tC, tD) - 18), 0)));
			const x = this.lotCenter(bminx, col, this.lotRegular);
			emit('P2_Skybridge', x, F((by + 1) * this.pitch), z, F(Math.PI / 2), span, 1, 1, this.RI(bx, by, 'BRY_HUE', 0, 3), 0.25, 0, 1);
		}
	}

	/**
	 * Solid boxes (Blender space) of block (bx, by): tower tiers and skybridges.
	 * Used for player-flight collision; derived from the very same generator.
	 */
	solids(bx, by) {
		const key = `${bx},${by}`;
		this._solids ??= new Map();
		let out = this._solids.get(key);
		if (out) return out;
		out = [];
		this.block(bx, by, (piece, x, y, z, r, sx, sy, sz) => {
			if (piece[0] === 'T') out.push([x - sx / 2, y - sy / 2, z, x + sx / 2, y + sy / 2, z + sz]);
			else if (piece === 'P2_Skybridge') {
				const along = Math.abs(Math.sin(r)) > 0.5; // rotated bridges span Y
				const hx = along ? 3.1 : sx / 2, hy = along ? sx / 2 : 3.1;
				out.push([x - hx, y - hy, z, x + hx, y + hy, z + 4.2]);
			}
		}, false);
		if (this._solids.size > 4000) this._solids.clear();
		this._solids.set(key, out);
		return out;
	}

	/** Skybridges crossing the street segment between two intersections (used by the autopilot). */
	bridgesOnStreet(axis, i, j) {
		// axis 'x': street x = i*pitch between y = j*pitch .. (j+1)*pitch -> bridges of block (i-1, j) across +X
		// axis 'y': street y = j*pitch between x = i*pitch .. (i+1)*pitch -> bridges of block (i, j-1) across +Y
		const out = [];
		const p = this.p, n = p.n;
		if (axis === 'x') {
			const bx = i - 1, by = j;
			if (this.R(bx, by, 'BRX') < p.BRC) {
				const row = this.RI(bx, by, 'BRX_ROW', 0, 8) % n;
				const tA = this.t0Top(bx, by, n - 1, row), tB = this.t0Top(bx + 1, by, 0, row);
				const z = F(10 + F(this.R(bx, by, 'BRX_Z') * Math.max(F(Math.min(tA, tB) - 18), 0)));
				out.push({ pos: this.lotCenter(this.blockMin(by), row, this.lotRegular), z0: z, z1: z + 4.2 });
			}
		} else {
			const bx = i, by = j - 1;
			if (this.R(bx, by, 'BRY') < p.BRC) {
				const col = this.RI(bx, by, 'BRY_COL', 0, 8) % n;
				const tC = this.t0Top(bx, by, col, n - 1), tD = this.t0Top(bx, by + 1, col, 0);
				const z = F(10 + F(this.R(bx, by, 'BRY_Z') * Math.max(F(Math.min(tC, tD) - 18), 0)));
				out.push({ pos: this.lotCenter(this.blockMin(bx), col, this.lotRegular), z0: z, z1: z + 4.2 });
			}
		}
		return out;
	}
}

// side -> [outX, outY, tanX, tanY]; side 0=-Y 1=+X 2=+Y 3=-X (piece outward axis is -Y)
const SIDE = [[0, -1, 1, 0], [1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1]];

function smooth(x) { return F(F(x * x) * F(3 - F(2 * x))); }
function lerp(a, b, t) { return F(a + F(F(b - a) * t)); }
