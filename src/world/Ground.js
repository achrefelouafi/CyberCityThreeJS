// Wet asphalt street plane that follows the camera. Lane markings, zebra
// crossings, puddles and fake light pools are all procedural (world space),
// so the plane can snap around freely.

import { Mesh, PlaneGeometry, MeshStandardNodeMaterial } from 'three/webgpu';
import {
	Fn, uniform, vec2, vec3, float, mix, smoothstep, step, abs, min, max, mod, fract, floor, positionWorld, int, select,
	mx_noise_float, exp, length, mrt,
} from 'three/tsl';
import { archUniforms, hash3 } from '../materials/ArchitectureMaterial.js';
import { paletteColor } from '../materials/palette.js';
import { cameraVelocity } from '../materials/velocity.js';

export const groundUniforms = {
	pitch: uniform(86),
	street: uniform(26),
	block: uniform(60),
	wet: uniform(0.75),
	pool: uniform(1.0),
};

export function createGround() {
	const U = groundUniforms;
	const mat = new MeshStandardNodeMaterial();
	const shade = () => {
		const P = positionWorld.add(archUniforms.origin);
		const pitch = U.pitch, hs = U.street.mul(0.5);
		const gx = mod(P.x, pitch), gz = mod(P.z, pitch);
		const dx = min(gx, pitch.sub(gx)); // distance to street centre line x = i*pitch
		const dz = min(gz, pitch.sub(gz));
		const inX = dx.lessThan(hs); // on a street running along Z
		const inZ = dz.lessThan(hs);
		const cross = inX.and(inZ);

		// puddles: low-frequency noise -> mirror-like patches
		const n = mx_noise_float(vec3(P.x.mul(0.045), 0.0, P.z.mul(0.045))).mul(0.5).add(0.5);
		const n2 = mx_noise_float(vec3(P.x.mul(0.35), 1.7, P.z.mul(0.35))).mul(0.5).add(0.5);
		const puddle = smoothstep(0.36, 0.56, n.mul(0.8).add(n2.mul(0.2))).mul(U.wet);
		const rough = mix(0.42, 0.03, puddle);

		// markings ------------------------------------------------------------
		const dash = (coord, len) => step(0.5, fract(coord.div(len)));
		// along-Z streets: centre line (double amber), lane dashes (white)
		const centreX = smoothstep(0.32, 0.22, abs(dx.sub(0.0)).sub(0.0)).mul(step(0.08, dx));
		const laneX = smoothstep(0.14, 0.08, abs(dx.sub(hs.mul(0.5)))).mul(dash(P.z, 9));
		const centreZ = smoothstep(0.32, 0.22, dz).mul(step(0.08, dz));
		const laneZ = smoothstep(0.14, 0.08, abs(dz.sub(hs.mul(0.5)))).mul(dash(P.x, 9));
		const zebraOnX = inX.and(dz.greaterThan(hs).and(dz.lessThan(hs.add(4.0)))); // crossing over a Z-street
		const zebraOnZ = inZ.and(dx.greaterThan(hs).and(dx.lessThan(hs.add(4.0))));
		const zebra = select(zebraOnX, step(0.5, fract(P.x.div(1.6))), select(zebraOnZ, step(0.5, fract(P.z.div(1.6))), float(0)));
		const amber = select(cross, float(0), select(inX, centreX, select(inZ, centreZ, float(0))));
		const white = select(cross, float(0), select(inX, laneX, select(inZ, laneZ, float(0)))).add(zebra.mul(0.8));
		const wear = smoothstep(0.25, 0.6, n2);
		const paint = max(amber, white).mul(wear).mul(puddle.oneMinus().mul(0.7).add(0.3));

		// fake light pools: storefront spill along the kerbs + street lamps
		const edge = max(select(inX, smoothstep(hs.sub(6.0), hs, dx), float(0)), select(inZ, smoothstep(hs.sub(6.0), hs, dz), float(0)));
		const seg = select(inX, floor(P.z.div(12)), floor(P.x.div(12)));
		const side = select(inX, floor(P.x.div(pitch).add(0.5)), floor(P.z.div(pitch).add(0.5)));
		const hc = hash3(int(seg), int(side), int(select(inX, float(1), float(2))));
		const spill = paletteColor(floor(hc.mul(4))).mul(edge.mul(edge)).mul(step(0.35, hc)).mul(0.22);
		const lampSeg = U.block.div(max(floor(U.block.div(18)), 1.0));
		const along = select(inX, P.z, P.x);
		const lp = abs(fract(along.div(lampSeg)).sub(0.5)).mul(lampSeg);
		const lampPool = exp(lp.mul(lp).add(max(hs.sub(select(inX, dx, dz)).sub(1.0), 0.0).pow(2)).mul(-0.03)).mul(0.35);
		const pools = spill.add(vec3(1.0, 0.75, 0.5).mul(lampPool)).mul(U.pool).mul(select(cross, float(0.4), float(1)));

		const asphalt = mix(vec3(0.016, 0.016, 0.02), vec3(0.008, 0.008, 0.012), puddle);
		const col = mix(asphalt, vec3(0.5, 0.45, 0.35), paint.mul(0.5));
		const reflect = puddle.mul(0.85).add(0.15).mul(U.wet.mul(0.6).add(0.4));
		return { col, rough, reflect, emi: pools.add(vec3(1.0, 0.6, 0.15).mul(amber.mul(wear)).mul(0.25)).add(vec3(white.mul(wear).mul(0.06))) };
	};
	const s = shade();
	mat.colorNode = s.col;
	mat.roughnessNode = s.rough;
	mat.metalnessNode = float(0.0);
	mat.emissiveNode = s.emi;
	// reflect mask for SSR: puddles are mirrors, damp asphalt is a blurry reflector
	mat.mrtNode = mrt({ velocity: cameraVelocity, reflect: vec2(s.reflect, s.rough) });

	const mesh = new Mesh(new PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), mat);
	mesh.name = 'ground';
	mesh.frustumCulled = false;
	// after the city: the towers fill the depth buffer first, so the (noise-heavy) street
	// shader only runs on the asphalt you can actually see
	mesh.renderOrder = 1;
	return mesh;
}
