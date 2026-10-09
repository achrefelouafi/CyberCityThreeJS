// GPU rain: camera-facing streaks in a world-locked, wrapping box around the
// camera. One draw call, positions computed entirely in the vertex shader.
import { BufferGeometry, BufferAttribute, Mesh, MeshBasicNodeMaterial, AdditiveBlending, Vector3 } from 'three/webgpu';
import {
	attribute, uniform, vec3, float, fract, time, cameraPosition, normalize, cross, smoothstep, length, mix, positionWorld,
} from 'three/tsl';
import { archUniforms } from '../materials/ArchitectureMaterial.js';
import { additiveMRT } from '../materials/additiveMRT.js';

export const rainUniforms = {
	amount: uniform(1.0),
	speed: uniform(26),
	wind: uniform(new Vector3(2.5, 0, 1.2)),
	brightness: uniform(0.9),
};

export function createRain(count = 14000, box = 90, height = 70) {
	const g = new BufferGeometry();
	const pos = new Float32Array(count * 4 * 3); // unused by the shader except as a placeholder
	const seed = new Float32Array(count * 4 * 3);
	const corner = new Float32Array(count * 4 * 2);
	const idx = new Uint32Array(count * 6);
	for (let i = 0; i < count; i++) {
		const s = [Math.random(), Math.random(), Math.random()];
		const cs = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
		for (let k = 0; k < 4; k++) {
			seed.set(s, (i * 4 + k) * 3);
			corner.set(cs[k], (i * 4 + k) * 2);
		}
		idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
	}
	g.setAttribute('position', new BufferAttribute(pos, 3));
	g.setAttribute('aSeed', new BufferAttribute(seed, 3));
	g.setAttribute('aCorner', new BufferAttribute(corner, 2));
	g.setIndex(new BufferAttribute(idx, 1));

	const U = rainUniforms;
	const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
	m.mrtNode = additiveMRT();
	const s = attribute('aSeed', 'vec3');
	const c = attribute('aCorner', 'vec2');
	const B = float(box), H = float(height);
	// world-locked wrap: absolute positions, folded into a box centred on the camera
	const camAbs = cameraPosition.add(archUniforms.origin);
	const fall = time.mul(U.speed);
	const ax = s.x.mul(B).add(U.wind.x.mul(time));
	const az = s.z.mul(B).add(U.wind.z.mul(time));
	const ay = s.y.mul(H).sub(fall);
	const wrap = (a, cam, size) => fract(a.sub(cam).div(size)).sub(0.5).mul(size).add(cam);
	const center = vec3(wrap(ax, camAbs.x, B), wrap(ay, camAbs.y, H), wrap(az, camAbs.z, B)).sub(archUniforms.origin);
	const dirV = normalize(vec3(U.wind.x, U.speed.negate(), U.wind.z));
	const toCam = normalize(cameraPosition.sub(center));
	const side = normalize(cross(dirV, toCam));
	const len = float(1.1);
	m.positionNode = center.add(side.mul(c.x).mul(0.011)).sub(dirV.mul(c.y).mul(len));
	const d = length(cameraPosition.sub(center));
	const fade = smoothstep(1.0, 4.0, d).mul(smoothstep(B.mul(0.5), B.mul(0.15), d));
	m.colorNode = mix(vec3(0.55, 0.62, 0.9), vec3(0.9, 0.6, 1.0), s.y).mul(fade).mul(U.brightness).mul(U.amount).mul(c.y.oneMinus().mul(0.7).add(0.3));
	const mesh = new Mesh(g, m);
	mesh.frustumCulled = false;
	mesh.renderOrder = 30;
	mesh.name = 'rain';
	return mesh;
}
