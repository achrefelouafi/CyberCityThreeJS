// Floating media layer: giant hologram creatures (NOAA deep-sea jellyfish, keyed
// to black and drawn additively) hovering over intersections, and translucent
// video / neon ad panels spanning the street canyons - the car flies straight
// through them. Placement is a pure function of the street grid (infinite,
// deterministic); one InstancedMesh, one draw call, all shading in TSL.
import { InstancedMesh, PlaneGeometry, MeshBasicNodeMaterial, AdditiveBlending, DoubleSide, InstancedBufferAttribute, Vector3 } from 'three/webgpu';
import {
	attribute, varying, positionGeometry, uv, vec2, vec3, vec4, float, uniform, select, normalize, cameraPosition, time, sin,
	smoothstep, step, fract, floor, mod, texture, hash, max, mix, length, exp, abs, min, positionWorld, dot,
} from 'three/tsl';
import { hash2 } from '../city/blenderHash.js';
import { paletteColor } from '../materials/palette.js';
import { ATLAS } from '../materials/SignAtlas.js';
import { additiveMRT } from '../materials/additiveMRT.js';

const MAX = 112;
const rnd = (i, j, k) => hash2((i * 73856093) ^ (k * 83492791), j * 19349663 + k) / 4294967296;

export const holoLayerUniforms = { intensity: uniform(1.0), adIntensity: uniform(1.0) };

export class HoloLayer {
	constructor({ videoAtlas, signAtlas, posterAtlas }) {
		this.video = videoAtlas;
		const geo = new PlaneGeometry(1, 1);
		this.aPos = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
		this.aData = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
		geo.setAttribute('aPos', this.aPos);
		geo.setAttribute('aData', this.aData);
		const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
		m.fog = false;
		m.mrtNode = additiveMRT();
		const P = attribute('aPos', 'vec4');
		const D = attribute('aData', 'vec4');
		const kind = D.x, tile = D.y, yaw = D.z, seed = D.w;
		const giant = kind.lessThan(0.5);
		// giants: cylindrical billboard facing the camera; ads: fixed across the street
		const toCam = normalize(vec3(cameraPosition.x.sub(P.x), 0, cameraPosition.z.sub(P.z)));
		const rightG = vec3(toCam.z, 0, toCam.x.negate());
		const rightA = select(yaw.greaterThan(0.5), vec3(1, 0, 0), vec3(0, 0, 1));
		const right = select(giant, rightG, rightA);
		const w = P.w, h = select(giant, P.w, select(kind.lessThan(2.5), P.w.mul(9 / 16), P.w.mul(2.0)));
		const bob = select(giant, sin(time.mul(0.5).add(seed.mul(20))).mul(4), float(0));
		const p = positionGeometry;
		m.positionNode = vec3(P.x, P.y.add(bob), P.z).add(right.mul(p.x.mul(w))).add(vec3(0, p.y.mul(h), 0));

		const vKind = varying(kind), vTile = varying(tile), vSeed = varying(seed);
		// flat panels read correctly from both sides: mirror U when seen from the back
		const front = vec3(rightA.z.negate(), 0, rightA.x); // right x up
		const back = varying(dot(cameraPosition.sub(P.xyz), front).lessThan(0).and(giant.not()).select(float(1), float(0)));
		const U0 = uv();
		const U = vec2(mix(U0.x, U0.x.oneMinus(), back), U0.y);
		// glitch: occasional horizontal tearing
		const band = floor(U.y.mul(28));
		const g = step(0.965, hash(band.toInt().toUint().add(floor(time.mul(12)).toInt().toUint().mul(31)).add(vSeed.mul(1e4).toUint())));
		const gu = U.x.add(g.mul(0.04));
		// video atlas tile (holo clips use the centred square of their 16:9 tile)
		const col = mod(vTile, 4), row = floor(vTile.div(4));
		const sq = 216 / 384;
		const tu = select(vKind.lessThan(0.5), float((1 - sq) / 2).add(gu.mul(sq)), gu);
		const vuv = vec2(col.add(tu).div(4), float(1).sub(row.add(float(1).sub(U.y)).div(4)));
		const sep = float(0.004).add(g.mul(0.01));
		const vr = texture(videoAtlas.texture, vuv.add(vec2(sep, 0))).r;
		const vg = texture(videoAtlas.texture, vuv).g;
		const vb = texture(videoAtlas.texture, vuv.sub(vec2(sep, 0))).b;
		const vid = vec3(vr, vg, vb);
		// neon typography panels reuse the sign atlas (wide cells)
		const cell = mod(vTile, 32);
		const suv = vec2(mod(cell, 4).add(gu.mul(0.97).add(0.015)).mul(ATLAS.wide.w), floor(cell.div(4)).add(U.y.oneMinus().mul(0.94).add(0.03)).mul(ATLAS.wide.h).add(ATLAS.wide.y0)).div(ATLAS.size);
		const sa = texture(signAtlas, suv);
		const hue = floor(vSeed.mul(4));
		const neon = paletteColor(hue).mul(sa.x).add(paletteColor(mod(hue.add(1), 4)).mul(sa.y)).mul(2.2);

		const scan = sin(U.y.mul(420).sub(time.mul(18))).mul(0.18).add(0.82);
		const flicker = sin(time.mul(31).add(vSeed.mul(50))).mul(0.04).add(0.96).mul(step(0.02, fract(time.mul(0.37).add(vSeed))).mul(0.7).add(0.3));
		const edge = min(min(U.x, U.x.oneMinus()), min(U.y, U.y.oneMinus()));
		const frame = smoothstep(0.012, 0.0, edge).mul(1.5);
		const tint = paletteColor(hue);
		// giants: luminance key + slight palette tint, soft vignette
		const key = smoothstep(0.07, 0.32, max(vid.r, max(vid.g, vid.b)));
		const giantCol = mix(vid, vid.mul(tint).mul(1.6), 0.25).mul(key).mul(3.6).mul(smoothstep(0.5, 0.36, length(U.sub(0.5))));
		// generated holo-posters (kind 3): 8 x 2 portrait cells, canvas flipY -> row 0 at the top
		const pc = mod(vTile, 16);
		const puv = vec2(mod(pc, 8).add(gu.clamp(0.0, 1.0)).div(8), float(1).sub(floor(pc.div(8))).add(U.y).div(2));
		const poster = posterAtlas ? texture(posterAtlas, puv).rgb.mul(2.8) : vec3(0);
		const adCol = select(vKind.lessThan(1.5), vid.mul(2.4).add(tint.mul(0.04)), select(vKind.lessThan(2.5), neon, poster))
			.add(tint.mul(frame).mul(2.0)).mul(holoLayerUniforms.adIntensity);
		const col3 = select(vKind.lessThan(0.5), giantCol, adCol);
		// fade near the lens (fly-through) and with distance (no fog on additive)
		const d = length(positionWorld.sub(cameraPosition));
		const fade = smoothstep(3.0, 22.0, d).mul(exp(d.mul(-0.0013)));
		m.colorNode = col3.mul(scan).mul(flicker).mul(fade).mul(holoLayerUniforms.intensity);
		this.mesh = new InstancedMesh(geo, m, MAX);
		this.mesh.count = 0;
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 12;
		this.mesh.name = 'holo-layer';
		this.last = new Vector3(1e9, 0, 0);
	}

	/** Re-place instances around the camera (absolute grid -> render space). */
	update(camera, origin, pitch, streetWidth, force = false) {
		const cam = camera.position;
		if (!force && cam.distanceToSquared(this.last) < 30 * 30) return;
		this.last.copy(cam);
		const ax = cam.x + origin.x, az = cam.z + origin.z;
		const ci = Math.round(ax / pitch), cj = Math.round(-az / pitch);
		const R = 8;
		const cand = [];
		const holos = this.video.holos, screens = this.video.screens;
		for (let dj = -R; dj <= R; dj++) {
			for (let di = -R; di <= R; di++) {
				const i = ci + di, j = cj + dj;
				const x = i * pitch, z = -j * pitch;
				// giant hologram creature above the intersection
				if (holos.length && rnd(i, j, 1) < 0.09) {
					cand.push([x, 120 + rnd(i, j, 2) * 120, z, 80 + rnd(i, j, 3) * 80, 0, holos[Math.floor(rnd(i, j, 4) * holos.length)], 0, rnd(i, j, 9)]);
				}
				// ad panels spanning the street that leaves this intersection along +X and along -Z
				const wmax = streetWidth * 0.92;
				for (const [axis, k] of [[0, 5], [1, 15]]) {
					if (rnd(i, j, k) >= 0.2) continue;
					const w = Math.min(wmax, 18 + rnd(i, j, k + 1) * 14);
					const y = 28 + rnd(i, j, k + 2) * 80;
					const px = axis === 0 ? x + pitch * (0.25 + rnd(i, j, k + 3) * 0.5) : x;
					const pz = axis === 0 ? z : z - pitch * (0.25 + rnd(i, j, k + 3) * 0.5);
					const useVideo = screens.length && rnd(i, j, k + 4) < 0.6;
					const kind = useVideo ? 1 : 2;
					const tile = useVideo ? screens[Math.floor(rnd(i, j, k + 5) * screens.length)] : Math.floor(rnd(i, j, k + 5) * 32);
					// axis 0: street runs along X -> panel spans Z (yaw 0); axis 1: spans X (yaw 1)
					cand.push([px, y, pz, w, kind, tile, axis === 0 ? 0 : 1, rnd(i, j, k + 6)]);
				}
				// floating portrait posters along the canyon walls, facing the street
				for (const [axis, k] of [[0, 25], [1, 35]]) {
					if (rnd(i, j, k) >= 0.16) continue;
					const side = rnd(i, j, k + 1) < 0.5 ? -1 : 1;
					const f = 0.15 + rnd(i, j, k + 2) * 0.7;
					const w = 6 + rnd(i, j, k + 3) * 6;
					const y = 16 + rnd(i, j, k + 4) * 70;
					const off = side * (streetWidth * 0.5 - 1.5);
					const px = axis === 0 ? x + pitch * f : x + off;
					const pz = axis === 0 ? z + off : z - pitch * f;
					cand.push([px, y, pz, w, 3, Math.floor(rnd(i, j, k + 5) * 16), axis === 0 ? 1 : 0, rnd(i, j, k + 6)]);
				}
			}
		}
		for (const c of cand) c.d = (c[0] - ax) ** 2 + (c[2] - az) ** 2;
		cand.sort((a, b) => a.d - b.d);
		const n = Math.min(cand.length, MAX);
		const A = this.aPos.array, B = this.aData.array;
		for (let k = 0; k < n; k++) {
			const c = cand[k];
			A.set([c[0] - origin.x, c[1], c[2] - origin.z, c[3]], k * 4);
			B.set([c[4], c[5], c[6], c[7]], k * 4);
		}
		this.mesh.count = n;
		this.aPos.needsUpdate = true;
		this.aData.needsUpdate = true;
	}
}
