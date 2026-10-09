// Additive hologram material for the H* kit pieces: spinning, scan-lined,
// fresnel-rimmed and glitching. Colour comes from the instance palette index.
import { MeshBasicNodeMaterial, AdditiveBlending, DoubleSide } from 'three/webgpu';
import {
	attribute, positionLocal, positionGeometry, positionWorld, normalWorld, cameraPosition, time, vec3, float, sin, cos, abs, dot, normalize,
	smoothstep, fract, step, hash, floor, pow, uniform, mix,
} from 'three/tsl';
import { paletteColor } from './palette.js';
import { additiveMRT } from './additiveMRT.js';

export const holoUniforms = { intensity: uniform(2.2) };

export function createHoloMaterial() {
	const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
	m.name = 'Hologram';
	m.mrtNode = additiveMRT();
	const inst = attribute('aInst', 'vec4');
	const seed = inst.y;
	// positionNode runs *after* the instance transform, so spin about the instance's own
	// centre: holo instances are unrotated with a uniform scale (passed in aInst.w)
	const a = time.mul(0.5).add(seed.mul(6.28));
	const c = cos(a), s = sin(a);
	const p = positionGeometry, k = inst.w.max(1e-3);
	const centre = positionLocal.sub(p.mul(k));
	const bob = sin(time.mul(1.1).add(seed.mul(9.0))).mul(0.03);
	m.positionNode = centre.add(vec3(p.x.mul(c).sub(p.z.mul(s)), p.y.add(bob), p.x.mul(s).add(p.z.mul(c))).mul(k));

	const V = normalize(cameraPosition.sub(positionWorld));
	const fres = pow(float(1).sub(abs(dot(normalWorld, V))), 2.0);
	const scan = smoothstep(0.25, 0.0, abs(fract(positionWorld.y.mul(0.9).sub(time.mul(1.5))).sub(0.5))).mul(0.6).add(0.4);
	const band = step(0.92, fract(positionWorld.y.mul(0.08).sub(time.mul(0.35)))).mul(1.5);
	const glitch = step(0.96, hash(floor(time.mul(12)).toUint().add(seed.mul(1000).toUint()))).mul(0.8);
	const col = mix(paletteColor(inst.x), vec3(0.6, 1.0, 1.0), 0.25);
	m.colorNode = col.mul(fres.mul(1.6).add(0.12)).mul(scan.add(band)).mul(float(1).sub(glitch)).mul(holoUniforms.intensity);
	m.opacityNode = float(1);
	return m;
}
