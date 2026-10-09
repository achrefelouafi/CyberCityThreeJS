// Verifies that src/city/layout.js reproduces Blender's CC_CityGenerator exactly.
// Blender side: public/assets/parity.json is written by blender/export.py and holds
// every instance the node tree produced for its preview window.
//
//   npm run parity
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CityLayout, paramsFromValues } from '../src/city/layout.js';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/assets/manifest.json'), 'utf8'));
const parity = JSON.parse(readFileSync(resolve(root, process.argv[2] || 'public/assets/parity.json'), 'utf8'));
const v = parity.values;

const layout = new CityLayout(paramsFromValues(v), manifest.channels);
const NB = v['Preview Blocks'], ox = v['Preview Origin X'], oy = v['Preview Origin Y'];

// JS instances -> column-major matrices (T * Rz * S), same as Instance on Points
const js = [];
for (let by = oy; by < oy + NB; by++) {
	for (let bx = ox; bx < ox + NB; bx++) {
		layout.block(bx, by, (piece, x, y, z, r, sx, sy, sz) => {
			const c = Math.cos(r), s = Math.sin(r);
			js.push({ piece, m: [c * sx, s * sx, 0, 0, -s * sy, c * sy, 0, 0, 0, 0, sz, 0, x, y, z, 1] });
		});
	}
}

// spatial hash (1 m cells), matches searched in the 27 neighbouring cells
const cell = (p, x, y, z) => `${p}|${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}`;
const bucket = new Map();
for (const b of parity.instances) {
	const k = cell(b.piece, b.m[12], b.m[13], b.m[14]);
	if (!bucket.has(k)) bucket.set(k, []);
	bucket.get(k).push(b);
}
function candidates(j) {
	const out = [];
	const [x, y, z] = [j.m[12], j.m[13], j.m[14]];
	for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
		const list = bucket.get(cell(j.piece, x + dx, y + dy, z + dz));
		if (list) for (const b of list) out.push([list, b]);
	}
	return out;
}

let matched = 0, worst = 0;
const missing = [];
for (const j of js) {
	// pick the closest candidate around this location
	let best = null, be = Infinity;
	for (const [list, b] of candidates(j)) {
		const e = Math.max(...b.m.map((x, k) => Math.abs(x - j.m[k]) / Math.max(1, Math.abs(x))));
		if (e < be) { be = e; best = [list, b]; }
	}
	if (!best || be > 1e-2) { missing.push(j); continue; }
	worst = Math.max(worst, be);
	best[0].splice(best[0].indexOf(best[1]), 1);
	matched++;
}
const extra = [...bucket.values()].flat();

const byPiece = (arr) => arr.reduce((o, x) => ((o[x.piece] = (o[x.piece] || 0) + 1), o), {});
console.log(`Blender instances : ${parity.instances.length}`);
console.log(`JS instances      : ${js.length}`);
console.log(`matched           : ${matched}  (worst relative matrix error ${worst.toExponential(2)})`);
console.log(`only in JS        : ${missing.length}`, missing.length ? byPiece(missing) : '');
console.log(`only in Blender   : ${extra.length}`, extra.length ? byPiece(extra) : '');
if (missing.length) console.log('  e.g. JS', missing.slice(0, 3).map((x) => [x.piece, x.m.slice(12, 15).map((n) => n.toFixed(3))]));
if (extra.length) console.log('  e.g. BL', extra.slice(0, 3).map((x) => [x.piece, x.m.slice(12, 15)]));
const ok = missing.length === 0 && extra.length === 0 && worst < 1e-3;
console.log(ok ? '\nPARITY OK - the browser builds the same city as Geometry Nodes.' : '\nPARITY MISMATCH');
process.exit(ok ? 0 : 1);
