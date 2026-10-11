// Shader precompilation that actually matches what three r186 renders later.
//
// renderer.compileAsync() alone misses two things:
//  - transparent double-sided materials are drawn as a back pass + a front pass, each its
//    own shader, but compileAsync restores material.side before its queued builds run, so
//    it only ever builds the (unused) double-sided variant;
//  - it walks the scene synchronously and then builds its queue one shader at a time, so
//    the parallel shader compiler sits idle.
// Here, every material is swapped for a copy (optionally without MRT outputs, as in a VR
// session) only for compileAsync's synchronous scene walk, the two pass variants get their
// own copies, and the drawables are split across several concurrent compileAsync calls.
// Copies share all nodes with the original, so three's build cache (material + camera
// layout + render context) hands the results to the real meshes when they first render.
import { BackSide, FrontSide, DoubleSide } from 'three/webgpu';

/**
 * @param {object} o
 * @param {boolean} [o.stripMRT=false] compile the variants a VR session draws (no mrtNode)
 * @param {boolean} [o.includeHidden=false] also compile invisible things (shown later)
 * @param {Object3D[]} [o.extra] objects outside the scene that will join it later
 * @param {number} [o.groups=4] concurrent compileAsync calls
 * @param {(fraction: number) => void} [o.onProgress]
 */
export async function precompile(renderer, scene, camera, { stripMRT = false, includeHidden = false, extra = [], groups = 4, onProgress = null } = {}) {
	const host = extra.length ? scene : null;
	for (const o of extra) if (!o.parent) host.add(o);
	const drawables = [], variants = new Map(); // material -> [main, back?, front?]
	scene.traverse((o) => {
		if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || Array.isArray(o.material) || !o.material) return;
		if (!includeHidden) { let p = o; while (p && p.visible) p = p.parent; if (p) return; }
		drawables.push(o);
		const m = o.material;
		if (variants.has(m)) return;
		const copy = (side) => {
			const c = m.clone();
			if (stripMRT) c.mrtNode = null;
			if (side !== undefined) c.side = side;
			return c;
		};
		const twoPass = m.transparent && m.side === DoubleSide && !m.forceSinglePass;
		variants.set(m, twoPass ? [copy(), copy(BackSide), copy(FrontSide)] : [copy()]);
	});
	const progress = [];
	const report = () => {
		let a = 0, b = 0;
		for (const [l, t] of progress) { a += l; b += t; }
		onProgress?.(b ? a / b : 0);
	};
	const launch = (subset, pick) => {
		const slot = [0, subset.length];
		progress.push(slot);
		const keep = new Set(subset), state = [];
		scene.traverse((o) => state.push([o, o.visible, o.material]));
		for (const [o] of state) {
			o.visible = !o.material || keep.has(o);
			if (keep.has(o)) o.material = variants.get(o.material)[pick];
		}
		const job = renderer.compileAsync(scene, camera, null, (e) => { slot[0] = e.loaded; slot[1] = e.total; report(); });
		for (const [o, visible, material] of state) { o.visible = visible; if (material) o.material = material; }
		return job;
	};
	const twoPass = drawables.filter((o) => variants.get(o.material).length === 3);
	const jobs = [];
	for (let k = 0; k < groups; k++) jobs.push(launch(drawables.filter((_, i) => i % groups === k), 0));
	if (twoPass.length) jobs.push(launch(twoPass, 1), launch(twoPass, 2));
	for (const o of extra) if (o.parent === host) host.remove(o);
	await Promise.all(jobs);
	onProgress?.(1);
}
