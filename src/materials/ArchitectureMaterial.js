// The city uber-material (TSL). Every kit piece is drawn with this one material;
// per-vertex `aRole` (from the Blender material slot) selects the look and the
// per-instance `aInst` vec4 carries the shading data the generator emitted:
//   towers  (hue, seed, windowStyle, trim)     signs (hue, seed, atlasIndex, flags)
//   screens (hue, seed, programme, 0)          bars  (hue, seed, 0, 1)
//
// Roles: 0 facade, 1 glass/windows, 2 neon, 3 metal, 4 concrete, 5 sign, 6 LED screen,
//        7 warm light, 8 beacon.

import { MeshStandardNodeMaterial, Vector3 } from 'three/webgpu';
import {
	Fn, If, attribute, uniform, float, int, vec2, vec3, vec4, struct, select, mix, step, smoothstep, clamp, fract, floor,
	abs, sin, cos, exp, max, min, length, atan, pow, fwidth, texture, positionWorld, normalWorld, uv, time, hash, mod, dot,
	mrt, cameraPosition,
} from 'three/tsl';
import { paletteColor } from './palette.js';
import { ATLAS } from './SignAtlas.js';
import { cameraVelocity } from './velocity.js';

export const archUniforms = {
	origin: uniform(new Vector3()),
	floorH: uniform(4.0),
	winW: uniform(2.6),
	lit: uniform(0.38),
	winI: uniform(1.15),
	neonI: uniform(4.5),
	signI: uniform(2.6),
	screenI: uniform(2.2),
	lampI: uniform(4.0),
	glow: uniform(1.0),
	shopI: uniform(2.0),
	videoOn: uniform(0), // 1 when public/media is present
	screenBase: uniform(0), // first 16:9 tile in the video atlas
	screenCount: uniform(1),
};

/** float hash of three ints (wraps on negatives). */
export const hash3 = Fn(([a, b, c]) => hash(a.toUint().mul(73856093).bitXor(b.toUint().mul(19349663)).bitXor(c.toUint().mul(83492791))));

const ShadeOut = struct({ color: 'vec3', emissive: 'vec3', rough: 'float', metal: 'float' });

// ------------------------------------------------------------------ LED screen programmes
const screenProgram = Fn(([suv, prog, seed, hue, atl]) => {
	const t = time.mul(0.9).add(seed.mul(50.0));
	const cA = paletteColor(hue);
	const cB = paletteColor(mod(hue.add(1), 4));
	const cC = paletteColor(mod(hue.add(2), 4));
	const out = vec3(0).toVar();
	const p = suv.sub(0.5).mul(vec2(16 / 9, 1));

	If(prog.lessThan(0.5), () => {
		// synthwave sun over a scrolling grid
		const sky = mix(cC.mul(0.25), vec3(1.0, 0.35, 0.25), smoothstep(1.0, 0.35, suv.y));
		const sunD = length(p.sub(vec2(0, 0.06)));
		const cuts = step(0.5, fract(suv.y.mul(26).sub(t.mul(0.5)))).max(step(0.47, suv.y));
		const sun = smoothstep(0.24, 0.235, sunD).mul(cuts);
		const sunCol = mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.2, 0.55), smoothstep(0.62, 0.3, suv.y));
		const gy = max(float(0.36).sub(suv.y), 0.0001);
		const gz = float(0.08).div(gy);
		const gx = p.x.mul(gz).mul(2.0);
		const grid = smoothstep(0.08, 0.0, abs(fract(gx).sub(0.5)).mul(2).oneMinus())
			.max(smoothstep(0.12, 0.0, abs(fract(gz.add(t.mul(1.5))).sub(0.5)).mul(2).oneMinus()));
		const floorCol = cA.mul(grid).mul(1.6).add(vec3(0.05, 0.0, 0.08));
		out.assign(select(suv.y.lessThan(0.36), floorCol, mix(sky, sunCol.mul(1.5), sun)));
	}).ElseIf(prog.lessThan(1.5), () => {
		// plasma
		const q = p.mul(3.0);
		const v = sin(q.x.add(t)).add(sin(q.y.mul(1.3).sub(t.mul(1.2)))).add(sin(q.x.add(q.y).mul(0.8).add(t.mul(0.7))))
			.add(sin(length(q.add(vec2(sin(t.mul(0.4)), cos(t.mul(0.3)))).mul(2.0)).mul(1.6)));
		out.assign(mix(mix(cA, cB, sin(v).mul(0.5).add(0.5)), cC, sin(v.mul(2.0).add(t)).mul(0.5).add(0.5).pow(3)));
	}).ElseIf(prog.lessThan(2.5), () => {
		// scrolling neon typography (sampled from the sign atlas)
		out.assign(cA.mul(atl.x).add(cB.mul(atl.y)).mul(1.6).add(cC.mul(0.06)));
	}).ElseIf(prog.lessThan(3.5), () => {
		// spectrum analyser
		const n = float(28);
		const i = floor(suv.x.mul(n));
		const lvl = sin(i.mul(0.7).add(t.mul(3.1))).mul(0.5).add(0.5).mul(sin(i.mul(1.9).sub(t.mul(5.3))).mul(0.25).add(0.75))
			.mul(sin(t.mul(2.0).add(i.mul(0.13))).mul(0.3).add(0.7));
		const bar = step(suv.y, lvl).mul(step(0.12, fract(suv.x.mul(n))));
		const seg = step(0.25, fract(suv.y.mul(30)));
		out.assign(mix(cB, cA, suv.y).mul(bar).mul(seg).mul(1.4).add(cC.mul(0.04)));
	}).ElseIf(prog.lessThan(4.5), () => {
		// tunnel rings
		const r = length(p);
		const a = atan(p.y, p.x);
		const rings = smoothstep(0.35, 0.5, sin(float(0.6).div(r.add(0.05)).mul(6).sub(t.mul(4))).mul(0.5).add(0.5));
		const spokes = step(0.5, fract(a.mul(12 / 6.2831).add(t.mul(0.2))));
		out.assign(mix(cA, cB, spokes).mul(rings).mul(smoothstep(0.0, 0.3, r)).mul(1.5));
	}).ElseIf(prog.lessThan(5.5), () => {
		// glitch logo
		out.assign(cA.mul(atl.x).add(cB.mul(atl.y)).add(cA.mul(atl.z).mul(0.6)).mul(1.4));
	}).ElseIf(prog.lessThan(6.5), () => {
		// data rain
		const cols = float(48);
		const ci = floor(suv.x.mul(cols));
		const sp = hash(ci.toInt().toUint().add(seed.mul(999).toUint())).mul(0.6).add(0.3);
		const head = fract(t.mul(sp).mul(0.35).add(hash(ci.toInt().toUint()).mul(7.0)));
		const d = fract(head.sub(suv.y));
		const glyph = step(0.35, hash(floor(suv.y.mul(64)).toInt().toUint().mul(31).add(ci.toInt().toUint()).add(floor(t.mul(6)).toInt().toUint())));
		out.assign(cB.mul(pow(d.oneMinus(), 6)).mul(glyph).mul(1.8).add(vec3(0.8).mul(smoothstep(0.985, 1.0, d.oneMinus()))));
	}).Else(() => {
		// hypnotic spiral
		const r = length(p);
		const a = atan(p.y, p.x);
		const s = sin(a.mul(3).add(r.mul(18)).sub(t.mul(3)));
		out.assign(mix(cA, cC, smoothstep(-0.2, 0.2, s)).mul(smoothstep(0.55, 0.05, r).add(0.15)));
	});
	return out;
});

// ------------------------------------------------------------------ interior mapping
// Each window cell is a virtual room box behind the glass (width = window cell,
// height = storey, depth = 4-7 m). The view ray is intersected with the room in
// facade space; the hit wall / floor / ceiling is shaded procedurally. Gives real
// parallax depth with zero geometry (the AAA city trick).
const interiorRoom = Fn(([o, rd, size, tint, lit, hs]) => {
	// o: entry point in room space (x along facade, y up, z = 0 at glass); rd: ray (z > 0 into the room)
	const sgn = vec3(select(rd.x.greaterThan(0), float(1), float(-1)), select(rd.y.greaterThan(0), float(1), float(-1)), float(1));
	const r = rd.abs().max(vec3(1e-4)).mul(sgn);
	const tX = select(r.x.greaterThan(0), size.x, float(0)).sub(o.x).div(r.x);
	const tY = select(r.y.greaterThan(0), size.y, float(0)).sub(o.y).div(r.y);
	const tZ = size.z.sub(o.z).div(r.z);
	const t = min(min(tX, tY), tZ);
	const h = o.add(r.mul(t));
	const depth = h.z.div(size.z);
	const wall = tint.mul(0.55).add(vec3(0.05));
	const col = vec3(0).toVar();
	If(tZ.lessThanEqual(t.add(1e-4)), () => {
		// back wall: furniture silhouettes + a framed picture / screen
		const desk = step(h.y, size.y.mul(0.28)).mul(step(0.18, fract(h.x.div(size.x).add(hs))));
		const pic = step(abs(h.x.div(size.x).sub(0.5)), 0.18).mul(step(abs(h.y.div(size.y).sub(0.62)), 0.1)).mul(step(0.5, hs));
		col.assign(wall.mul(float(1).sub(desk.mul(0.75))).add(tint.mul(pic).mul(0.6)));
	}).ElseIf(tY.lessThanEqual(t.add(1e-4)), () => {
		If(r.y.greaterThan(0), () => {
			// ceiling: a fluorescent / warm light panel in the middle of the room
			const panel = step(abs(h.x.div(size.x).sub(0.5)), 0.22).mul(step(abs(depth.sub(0.45)), 0.2));
			col.assign(wall.mul(0.7).add(tint.mul(panel).mul(2.6)));
		}).Else(() => {
			col.assign(tint.mul(0.18).add(vec3(0.03, 0.025, 0.02)).mul(depth.mul(0.6).add(0.4)));
		});
	}).Else(() => {
		col.assign(wall.mul(0.62).mul(float(1).sub(depth.mul(0.45))));
	});
	// light falls off towards the back; dark rooms keep a faint moonlit outline
	const light = mix(vec3(0.012, 0.014, 0.022), col.mul(float(1.15).sub(depth.mul(0.5))), lit);
	return light;
});

// ------------------------------------------------------------------ the shader
const shade = Fn(() => {
	const U = archUniforms;
	const role = attribute('aRole', 'float');
	const inst = attribute('aInst', 'vec4');
	const hue = inst.x, seed = inst.y;
	const P = positionWorld.add(U.origin);
	const N = normalWorld;
	const ax = abs(N.x), az = abs(N.z), ay = abs(N.y);
	const hcoord = select(ax.greaterThan(az), P.z.mul(N.x.sign()).negate(), P.x.mul(N.z.sign())).toVar();
	const UV = uv();

	// ---- everything needing derivatives / implicit-LOD texture fetches is hoisted (WGSL uniformity)
	const dW = fwidth(vec2(hcoord, P.y)).toVar();
	const dUV = fwidth(UV).toVar();
	const atlasIdx = mod(inst.z, 32);
	const flagWide = mod(floor(inst.w.mul(0.5)), 2.0).greaterThan(0.5);
	const isSign = inst.w.greaterThan(3.5);
	const wide = flagWide;
	const tallUV = vec2(mod(atlasIdx, 16).add(UV.x.mul(0.96).add(0.02)).mul(ATLAS.tall.w), floor(atlasIdx.div(16)).add(UV.y.mul(0.97).add(0.015)).mul(ATLAS.tall.h));
	const wideUV = vec2(mod(atlasIdx, 4).add(UV.x.mul(0.97).add(0.015)).mul(ATLAS.wide.w), floor(atlasIdx.div(4)).add(UV.y.mul(0.94).add(0.03)).mul(ATLAS.wide.h).add(ATLAS.wide.y0));
	// LED screens reuse the atlas: scrolling text (prog 2) / glitch logo (prog 5)
	const isScreen = role.greaterThan(5.5).and(role.lessThan(6.5));
	const scrollIdx = mod(floor(time.mul(0.25).add(seed.mul(17))), 32);
	const glitch = step(0.93, hash(floor(UV.y.mul(24)).toInt().toUint().add(floor(time.mul(8)).toInt().toUint()))).mul(0.06);
	const scrollU = select(inst.z.lessThan(2.5), fract(UV.x.mul(0.5).add(time.mul(0.12))), UV.x.add(glitch));
	const scrUV = vec2(mod(scrollIdx, 4).add(scrollU.mul(0.97).add(0.015)).mul(ATLAS.wide.w), floor(scrollIdx.div(4)).add(UV.y.mul(0.94).add(0.03)).mul(ATLAS.wide.h).add(ATLAS.wide.y0));
	// disc signs (flag 8): one big glyph from the top of a tall design, inside a neon ring
	const isDisc = mod(floor(inst.w.mul(0.125)), 2.0).greaterThan(0.5);
	const discUV = vec2(mod(atlasIdx, 16).add(UV.x.mul(0.8).add(0.1)).mul(ATLAS.tall.w), floor(atlasIdx.div(16)).add(UV.y.mul(0.24).add(0.06)).mul(ATLAS.tall.h));
	const aUV = select(isScreen, scrUV, select(wide, wideUV, select(isDisc, discUV, tallUV))).div(ATLAS.size);
	const atl = texture(signAtlasNode.value, aUV).toVar();

	const color = vec3(0.03).toVar();
	const emissive = vec3(0).toVar();
	const rough = float(0.6).toVar();
	const metal = float(0.2).toVar();

	If(role.lessThan(0.5), () => {
		// ------------------------------------------------ facade
		// material family per building: graphite, raw concrete, oxidised copper, white composite
		const hb = hash3(int(seed.mul(65536)), int(3), int(5));
		const fam = hash3(int(seed.mul(65536)), int(41), int(9));
		const graphite = mix(vec3(0.016, 0.018, 0.026), vec3(0.036, 0.03, 0.042), hb);
		const concrete = vec3(0.075, 0.072, 0.07).mul(hb.mul(0.4).add(0.8));
		const copper = mix(vec3(0.11, 0.055, 0.03), vec3(0.05, 0.09, 0.08), hb.mul(hb));
		const white = vec3(0.2, 0.2, 0.215);
		const base = select(fam.lessThan(0.42), graphite, select(fam.lessThan(0.66), concrete, select(fam.lessThan(0.84), copper, white)));
		// cladding panels: floor seams + vertical joints every 1.5 m, filtered with distance
		const pw = vec2(hcoord.div(1.5), P.y.div(U.floorH));
		const pf = fract(pw);
		const aa = clamp(max(dW.x.div(1.5), dW.y.div(U.floorH)).mul(4), 0, 1);
		const joint = max(smoothstep(0.93, 0.98, pf.y), smoothstep(0.03, 0.0, pf.x).max(smoothstep(0.97, 1.0, pf.x)).mul(0.6));
		const seam = float(1).sub(joint.mul(0.45).mul(aa.oneMinus()));
		const panelVar = hash3(int(floor(pw.x)), int(floor(pw.y)), int(seed.mul(999))).mul(0.18).add(0.91);
		color.assign(base.mul(seam).mul(mix(panelVar, float(1), aa)));
		rough.assign(select(fam.lessThan(0.66), float(0.62), select(fam.lessThan(0.84), float(0.34), float(0.45))));
		metal.assign(select(fam.lessThan(0.42), float(0.35), select(fam.lessThan(0.66), float(0.05), select(fam.lessThan(0.84), float(0.85), float(0.15)))));
		const spill = paletteColor(hue).mul(exp(P.y.div(-16.0))).mul(0.035).mul(U.glow);
		emissive.assign(select(ay.greaterThan(0.6), vec3(0), spill));
	}).ElseIf(role.lessThan(1.5), () => {
		// ------------------------------------------------ glass & windows
		If(ay.greaterThan(0.6), () => {
			// roof slab
			color.assign(vec3(0.03, 0.03, 0.035));
			rough.assign(0.75);
			metal.assign(0.1);
		}).Else(() => {
			const bI = int(seed.mul(65536));
			const hBld = hash3(bI, int(11), int(7));
			const ws = select(inst.z.greaterThan(2.5).and(seed.greaterThan(0.14)), float(0), inst.z).toVar(); // media facades are rare
			const isShop = P.y.lessThan(U.floorH.mul(1.15));

			If(isShop, () => {
				// ---- street level shopfronts
				const w = float(6.0);
				const sx = hcoord.div(w);
				const fx = fract(sx), fy = P.y.div(U.floorH.mul(1.15));
				const shopI = hash3(int(floor(sx)), bI, int(91));
				const pane = smoothstep(0.04, 0.07, fx).mul(smoothstep(0.96, 0.93, fx)).mul(smoothstep(0.08, 0.12, fy)).mul(smoothstep(0.82, 0.78, fy));
				const sign = smoothstep(0.84, 0.86, fy).mul(smoothstep(0.98, 0.96, fy)).mul(step(0.4, shopI));
				const c = paletteColor(mod(hue.add(floor(shopI.mul(4))), 4));
				const warm = vec3(1.0, 0.75, 0.5);
				const open = step(0.25, shopI);
				emissive.assign(mix(warm, c, 0.55).mul(pane).mul(open).mul(U.shopI).add(c.mul(sign).mul(U.shopI.mul(2.2))));
				color.assign(vec3(0.02));
				rough.assign(0.15);
				metal.assign(0.6);
			}).ElseIf(ws.greaterThan(2.5), () => {
				// ---- LED media facade
				const pitch = float(0.5);
				const lp = vec2(hcoord, P.y).div(pitch);
				const lf = fract(lp).sub(0.5);
				const ledAA = smoothstep(0.35, 0.8, max(dW.x, dW.y).div(pitch));
				const dotm = mix(smoothstep(0.42, 0.22, length(lf)), float(0.42), ledAA);
				const q = floor(lp).mul(pitch).div(40.0);
				const t = time.mul(0.45).add(seed.mul(40));
				const v = sin(q.x.mul(2.1).add(t)).add(sin(q.y.mul(1.7).sub(t.mul(1.3)))).add(sin(q.x.add(q.y).mul(1.2).add(t.mul(0.6))));
				const blobs = smoothstep(0.6, 1.6, v);
				const bands = step(0.82, fract(q.y.mul(2.0).sub(t.mul(0.6)))).mul(step(0.5, fract(q.x.mul(0.5).add(t.mul(0.2)))));
				const c = mix(paletteColor(hue), paletteColor(mod(hue.add(1), 4)), sin(v.mul(1.5)).mul(0.5).add(0.5));
				emissive.assign(c.mul(blobs.add(bands.mul(0.8)).add(0.03)).mul(dotm).mul(U.winI.mul(1.1)));
				color.assign(vec3(0.01));
				rough.assign(0.3);
				metal.assign(0.5);
			}).Else(() => {
				// ---- windows: 0 office grid, 1 ribbon, 2 apartments
				const winW = select(ws.lessThan(0.5), U.winW.mul(0.62), select(ws.lessThan(1.5), U.winW.mul(0.5), U.winW.mul(0.95)));
				const x0 = select(ws.lessThan(0.5), float(0.05), select(ws.lessThan(1.5), float(0.02), float(0.2)));
				const x1 = select(ws.lessThan(0.5), float(0.95), select(ws.lessThan(1.5), float(0.98), float(0.7)));
				const y0 = select(ws.lessThan(0.5), float(0.22), select(ws.lessThan(1.5), float(0.3), float(0.32)));
				const y1 = select(ws.lessThan(0.5), float(0.92), select(ws.lessThan(1.5), float(0.8), float(0.84)));
				const group = select(ws.lessThan(0.5), float(4), select(ws.lessThan(1.5), float(9), float(1)));
				const cs = vec2(hcoord.div(winW), P.y.div(U.floorH));
				const cell = floor(cs);
				const f = fract(cs);
				const dc = dW.div(vec2(winW, U.floorH));
				const ex = max(dc.x, 0.002), ey = max(dc.y, 0.002);
				const pane = smoothstep(x0.sub(ex), x0.add(ex), f.x).mul(smoothstep(x1.add(ex), x1.sub(ex), f.x))
					.mul(smoothstep(y0.sub(ey), y0.add(ey), f.y)).mul(smoothstep(y1.add(ey), y1.sub(ey), f.y)).toVar();
				const room = int(floor(cell.x.div(group)));
				const fl = int(cell.y);
				const hRoom = hash3(room, fl, bI);
				const hFloor = hash3(int(77), fl, bI);
				const pBld = mix(0.25, 1.35, hBld);
				const p = clamp(U.lit.mul(pBld).add(hFloor.sub(0.5).mul(0.55)), 0.0, 0.97);
				const lit = step(hRoom, p);
				const hC = hash3(room, fl, bI.add(7));
				const hI = hash3(room, fl, bI.add(13));
				const warm = vec3(1.0, 0.55, 0.26), white = vec3(1.0, 0.82, 0.62), cool = vec3(0.55, 0.75, 1.0);
				// offices skew cool / fluorescent, homes skew warm
				const hT = select(ws.lessThan(1.5), hC.mul(0.6).add(0.32), hC.mul(0.75));
				const tint = select(hT.lessThan(0.42), warm, select(hT.lessThan(0.66), white, select(hT.lessThan(0.86), cool,
					select(hT.lessThan(0.95), vec3(0.2, 0.9, 0.95), vec3(1.0, 0.22, 0.7)))));
				const py = clamp(f.y.sub(y0).div(y1.sub(y0)), 0.0, 1.0);
				const blinds = select(hI.lessThan(0.22), step(0.45, fract(py.mul(11))).mul(0.6).add(0.25), float(1));
				const grad = mix(0.55, 1.25, py);
				const flick = select(hI.greaterThan(0.985), step(0.4, sin(time.mul(23.0).add(hRoom.mul(40))).mul(sin(time.mul(3.1)))).mul(0.8).add(0.2), float(1));
				const tv = select(hC.greaterThan(0.93).and(hI.lessThan(0.5)), vec3(0.35, 0.5, 1.0).mul(sin(time.mul(9.0).add(hI.mul(30))).mul(0.3).add(0.7)), tint);
				const inten = hI.mul(hI).mul(1.6).add(0.25).mul(U.winI).mul(hFloor.mul(0.5).add(0.75));
				// ---- interior mapping: parallax room behind each pane
				const xdom = ax.greaterThan(az);
				const T = select(xdom, vec3(0, 0, N.x.sign().negate()), vec3(N.z.sign(), 0, 0));
				const inward = select(xdom, vec3(N.x.sign().negate(), 0, 0), vec3(0, 0, N.z.sign().negate()));
				const V = positionWorld.sub(cameraPosition).normalize();
				const rd = vec3(dot(V, T), V.y, max(dot(V, inward), 0.05));
				const roomD = hI.mul(3.0).add(4.0);
				const size = vec3(winW, U.floorH, roomD);
				const o = vec3(f.x.mul(winW), f.y.mul(U.floorH), 0);
				const interior = interiorRoom(o, rd, size, tv, lit, hC);
				const near = interior.mul(pane).mul(blinds).mul(flick).mul(inten).mul(1.35).add(tv.mul(lit).mul(pane).mul(blinds).mul(inten).mul(0.08));
				// distant windows: fade to the statistical average to kill moire
				const far = smoothstep(0.22, 0.75, max(dc.x, dc.y));
				const avg = vec3(1.0, 0.72, 0.48).mul(p).mul(x1.sub(x0).mul(y1.sub(y0))).mul(U.winI).mul(0.9);
				emissive.assign(mix(near, avg, far));
				// per-building glass tint: blue-black, teal, bronze, smoked violet
				const gt = hash3(bI, int(5), int(61));
				const glass = select(gt.lessThan(0.4), vec3(0.004, 0.007, 0.014), select(gt.lessThan(0.65), vec3(0.003, 0.012, 0.012),
					select(gt.lessThan(0.85), vec3(0.014, 0.009, 0.005), vec3(0.01, 0.005, 0.014))));
				const mull = vec3(0.025, 0.026, 0.03);
				color.assign(mix(mull, glass, pane));
				rough.assign(mix(0.4, 0.09, pane));
				metal.assign(mix(0.6, 0.55, pane));
			});
		});
	}).ElseIf(role.lessThan(2.5), () => {
		// ------------------------------------------------ neon tubes
		const on = mod(inst.w, 2.0).mul(select(isSign, float(0.45), float(1)));
		const hs = hash3(int(seed.mul(65536)), int(17), int(23));
		const flick = select(hs.lessThan(0.07),
			step(0.35, sin(time.mul(hs.mul(40).add(9))).add(sin(time.mul(17.3)).mul(0.5))).mul(0.85).add(0.15), float(1));
		const breathe = sin(time.mul(1.3).add(hs.mul(20))).mul(0.08).add(0.92);
		const c = paletteColor(hue);
		emissive.assign(c.add(vec3(0.06)).mul(U.neonI).mul(mix(0.05, 1.0, on)).mul(flick).mul(breathe));
		color.assign(vec3(0.02));
		rough.assign(0.3);
		metal.assign(0.0);
	}).ElseIf(role.lessThan(3.5), () => {
		// ------------------------------------------------ metal
		color.assign(vec3(0.05, 0.052, 0.06));
		rough.assign(0.35);
		metal.assign(0.9);
	}).ElseIf(role.lessThan(4.5), () => {
		// ------------------------------------------------ concrete / wet sidewalks
		const wet = smoothstep(0.35, 0.65, hash3(int(floor(P.x.div(3))), int(floor(P.z.div(3))), int(5)));
		color.assign(vec3(0.04, 0.04, 0.046));
		rough.assign(select(ay.greaterThan(0.6), mix(0.55, 0.12, wet), float(0.85)));
		metal.assign(0.0);
	}).ElseIf(role.lessThan(5.5), () => {
		// ------------------------------------------------ neon sign faces
		const hs = hash3(int(seed.mul(65536)), int(29), int(31));
		const cA = paletteColor(hue);
		const cB = paletteColor(mod(hue.add(floor(hs.mul(3)).add(1)), 4));
		const flick = select(hs.lessThan(0.08), step(0.3, sin(time.mul(hs.mul(60).add(11))).add(sin(time.mul(7.7)))).mul(0.9).add(0.1), float(1));
		const core = smoothstep(0.9, 1.0, atl.x).mul(0.15);
		const discMask = select(isDisc, smoothstep(0.5, 0.46, length(UV.sub(0.5))), float(1));
		emissive.assign(cA.mul(atl.x.mul(atl.x)).add(cB.mul(atl.y.mul(atl.y))).add(vec3(core)).add(cA.mul(atl.z).mul(0.05)).mul(U.signI).mul(flick).mul(discMask));
		color.assign(vec3(0.01));
		rough.assign(0.3);
		metal.assign(0.0);
	}).ElseIf(role.lessThan(6.5), () => {
		// ------------------------------------------------ LED billboards
		// programmes 0-4 play real footage from the video atlas, 5-7 stay procedural
		const suv = vec2(UV.x, UV.y.oneMinus());
		const c = vec3(0).toVar();
		If(U.videoOn.greaterThan(0.5).and(inst.z.lessThan(4.5)), () => {
			const tile = U.screenBase.add(mod(inst.z.add(floor(seed.mul(13))), U.screenCount));
			const col = mod(tile, 4), row = floor(tile.div(4));
			const vuv = vec2(col.add(suv.x).div(4), float(1).sub(row.add(float(1).sub(suv.y)).div(4)));
			const glitchX = step(0.97, hash(floor(suv.y.mul(40)).toInt().toUint().add(floor(time.mul(10)).toInt().toUint()).add(int(seed.mul(999)).toUint()))).mul(0.02);
			c.assign(texture(videoAtlasNode.value, vuv.add(vec2(glitchX.div(4), 0))).level(0).rgb.mul(1.8));
		}).Else(() => {
			const prog = select(U.videoOn.greaterThan(0.5), select(inst.z.lessThan(5.5), float(0), select(inst.z.lessThan(6.5), float(6), float(3))), inst.z);
			c.assign(screenProgram(suv, prog, seed, hue, atl));
		});
		const g = fract(suv.mul(vec2(192, 108))).sub(0.5);
		const ledAA = smoothstep(0.3, 0.7, max(dUV.x.mul(192), dUV.y.mul(108)));
		const dotm = mix(smoothstep(0.5, 0.2, length(g)), float(0.55), ledAA);
		const scan = sin(suv.y.mul(3.0).sub(time.mul(2.0))).mul(0.06).add(0.94);
		emissive.assign(c.mul(dotm).mul(scan).mul(U.screenI));
		color.assign(vec3(0.005));
		rough.assign(0.2);
		metal.assign(0.0);
	}).ElseIf(role.lessThan(7.5), () => {
		// ------------------------------------------------ warm practical lights
		emissive.assign(vec3(1.0, 0.78, 0.55).mul(U.lampI));
		color.assign(vec3(0.05));
	}).Else(() => {
		// ------------------------------------------------ aviation beacon
		const blink = step(0.86, fract(time.mul(0.7).add(seed.mul(3.7))));
		emissive.assign(vec3(1.0, 0.05, 0.04).mul(blink.mul(40).add(0.6)));
		color.assign(vec3(0.05));
	});

	return ShadeOut(color, emissive, rough, metal);
});

const signAtlasNode = { value: null };
const videoAtlasNode = { value: null };

export function createArchitectureMaterial(atlasTexture, videoTexture) {
	signAtlasNode.value = atlasTexture;
	videoAtlasNode.value = videoTexture;
	const m = new MeshStandardNodeMaterial();
	m.name = 'CityUber';
	const s = shade().toVar();
	m.colorNode = s.get('color');
	m.emissiveNode = s.get('emissive');
	m.roughnessNode = s.get('rough');
	m.metalnessNode = s.get('metal');
	m.mrtNode = mrt({ velocity: cameraVelocity });
	return m;
}
