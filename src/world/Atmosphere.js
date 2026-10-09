// Night sky (background node), analytic height fog and a procedural environment
// map so glass, wet streets and the car paint reflect a neon-polluted sky.

import { Color, Mesh, SphereGeometry, BackSide, MeshBasicNodeMaterial, PlaneGeometry, Scene, PMREMGenerator, Vector3 } from 'three/webgpu';
import {
	Fn, uniform, vec2, vec3, float, mix, smoothstep, exp, max, abs, select, length, normalize, positionWorld, cameraPosition,
	positionWorldDirection, fog, time, mx_fractal_noise_float, pow, clamp, hash, floor, fract, dot,
} from 'three/tsl';

export const atmo = {
	zenith: uniform(new Color(0.004, 0.004, 0.014)),
	horizon: uniform(new Color(0.075, 0.022, 0.1)),
	glow: uniform(new Color(0.45, 0.07, 0.26)),
	fogColor: uniform(new Color(0.03, 0.016, 0.055)),
	fogDensity: uniform(0.0034),
	fogHeight: uniform(85),
	fogBase: uniform(0.00012),
	cloud: uniform(0.55),
	stars: uniform(0.6),
};

/** Sky radiance for a world direction (also drives the fog colour so the city melts into the haze). */
export const skyColor = Fn(([dir]) => {
	const y = dir.y;
	const h = max(y, 0.0);
	const base = mix(atmo.horizon, atmo.zenith, pow(smoothstep(-0.02, 0.55, y), 0.6));
	const glowBand = atmo.glow.mul(exp(h.mul(-14.0))).mul(0.55);
	// clouds lit from below by the city
	const cuv = dir.xz.div(max(y, 0.03).add(0.12)).mul(0.9).add(vec2(time.mul(0.004), time.mul(0.0015)));
	const n = mx_fractal_noise_float(vec3(cuv.x, cuv.y, time.mul(0.01)), 4, 2.0, 0.5).mul(0.5).add(0.5);
	const cl = smoothstep(0.45, 0.85, n).mul(smoothstep(0.0, 0.08, y)).mul(smoothstep(0.7, 0.15, y)).mul(atmo.cloud);
	const cloudCol = mix(atmo.glow.mul(0.35), vec3(0.06, 0.05, 0.12), smoothstep(0.05, 0.45, y));
	// sparse stars above the haze
	const sg = dir.xz.div(max(y, 0.05)).mul(160.0);
	const cell = floor(sg);
	const st = smoothstep(0.996, 1.0, hash(cell.x.toInt().toUint().mul(7919).add(cell.y.toInt().toUint())))
		.mul(smoothstep(0.25, 0.6, y)).mul(atmo.stars).mul(smoothstep(0.3, 0.0, length(fract(sg).sub(0.5))));
	return mix(base.add(glowBand), cloudCol, cl).add(vec3(st));
});

export function setupAtmosphere(scene) {
	scene.backgroundNode = skyColor(positionWorldDirection);

	const fogFactor = Fn(() => {
		const d = positionWorld.sub(cameraPosition);
		const dist = length(d);
		const k = float(1).div(atmo.fogHeight);
		const camY = max(cameraPosition.y, 0.0);
		const py = max(positionWorld.y, 0.0);
		const dy = py.sub(camY);
		const fy = select(abs(dy).greaterThan(0.5), exp(camY.mul(k).negate()).sub(exp(py.mul(k).negate())).div(k.mul(dy)), exp(camY.mul(k).negate()));
		const optical = atmo.fogDensity.mul(dist).mul(fy).add(atmo.fogBase.mul(dist));
		return float(1).sub(exp(optical.negate()));
	});
	const fogCol = Fn(() => {
		const dir = normalize(positionWorld.sub(cameraPosition));
		const sky = skyColor(vec3(dir.x, max(dir.y, 0.015), dir.z));
		return mix(atmo.fogColor, sky, 0.4);
	});
	scene.fogNode = fog(fogCol(), fogFactor());
}

/** A one-off neon environment: sky dome + glowing panels, prefiltered with PMREM. */
export function buildEnvironment(renderer) {
	const env = new Scene();
	const dome = new Mesh(new SphereGeometry(100, 48, 24), new MeshBasicNodeMaterial({ side: BackSide }));
	dome.material.colorNode = skyColor(positionWorldDirection).mul(1.2);
	env.add(dome);
	const palette = [new Color(1.0, 0.08, 0.58), new Color(0.0, 0.8, 1.0), new Color(0.55, 0.18, 1.0), new Color(1.0, 0.5, 0.08), new Color(1, 0.8, 0.6)];
	let s = 7;
	const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
	for (let i = 0; i < 90; i++) {
		const m = new MeshBasicNodeMaterial();
		const c = palette[Math.floor(rnd() * palette.length)].clone().multiplyScalar(2 + rnd() * 6);
		m.color = c;
		const w = 3 + rnd() * 14, h = 2 + rnd() * 18;
		const p = new Mesh(new PlaneGeometry(w, h), m);
		const a = rnd() * Math.PI * 2, el = -0.05 + rnd() * 0.35;
		p.position.set(Math.cos(a) * 80 * Math.cos(el), Math.sin(el) * 80, Math.sin(a) * 80 * Math.cos(el));
		p.lookAt(0, p.position.y, 0);
		env.add(p);
	}
	const pmrem = new PMREMGenerator(renderer);
	const rt = pmrem.fromScene(env, 0.02);
	pmrem.dispose();
	return rt.texture;
}

/**
 * Reflection environment for the hero car: near-black sky with long, thin neon
 * light strips. Rotated with distance travelled, it reads as city lights sliding
 * over the paint - the "passing under neon" look - for free.
 */
export function buildCarEnvironment(renderer) {
	const env = new Scene();
	const dome = new Mesh(new SphereGeometry(100, 32, 16), new MeshBasicNodeMaterial({ side: BackSide }));
	dome.material.colorNode = skyColor(positionWorldDirection).mul(0.35);
	env.add(dome);
	const cols = [new Color(1.0, 0.1, 0.6), new Color(0.0, 0.8, 1.0), new Color(0.6, 0.2, 1.0), new Color(1.0, 0.55, 0.15), new Color(1, 0.9, 0.8)];
	let s = 11;
	const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
	for (let i = 0; i < 26; i++) {
		const m = new MeshBasicNodeMaterial();
		m.color = cols[i % cols.length].clone().multiplyScalar(1.5 + rnd() * 3);
		const vertical = rnd() < 0.5;
		const p = new Mesh(new PlaneGeometry(vertical ? 0.8 : 30 + rnd() * 40, vertical ? 25 + rnd() * 30 : 0.8), m);
		const a = rnd() * Math.PI * 2, el = -0.1 + rnd() * 0.5;
		p.position.set(Math.cos(a) * 70 * Math.cos(el), Math.sin(el) * 70, Math.sin(a) * 70 * Math.cos(el));
		p.lookAt(0, p.position.y, 0);
		env.add(p);
	}
	// soft overhead key so the roof line reads
	const key = new Mesh(new PlaneGeometry(60, 12), new MeshBasicNodeMaterial());
	key.material.color = new Color(0.1, 0.11, 0.16);
	key.position.set(0, 60, 0);
	key.lookAt(0, 0, 0);
	env.add(key);
	const pmrem = new PMREMGenerator(renderer);
	const rt = pmrem.fromScene(env, 0.0);
	pmrem.dispose();
	return rt.texture;
}
