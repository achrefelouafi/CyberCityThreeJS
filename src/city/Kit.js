// Loads the modular kit exported by blender/export.py.
// Each glTF node is one piece; its primitives (one per Blender material) are
// merged into a single BufferGeometry with a per-vertex `aRole` attribute taken
// from the material's `cc_role`, so the whole city can be drawn with one
// instanced draw call per piece and a single TSL uber-material.

import { BufferAttribute, Float32BufferAttribute } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export async function loadKit(url, manifest, onProgress) {
	const gltf = await new GLTFLoader().loadAsync(url, onProgress);
	const roles = Object.fromEntries(Object.entries(manifest.materials).map(([k, v]) => [k, v.role]));
	const pieces = new Map();

	for (const node of gltf.scene.children) {
		const parts = [];
		node.traverse((o) => {
			if (!o.isMesh) return;
			const g = o.geometry.clone();
			// meshes nested under a multi-primitive node share its transform -> local geometry
			if (o !== node) g.applyMatrix4(o.matrix);
			const role = roles[o.material.name] ?? 0;
			const n = g.attributes.position.count;
			for (const name of Object.keys(g.attributes)) {
				if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
			}
			if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
			if (!g.attributes.normal) g.computeVertexNormals();
			g.setAttribute('aRole', new BufferAttribute(new Float32Array(n).fill(role), 1));
			if (!g.index) {
				const idx = new Uint32Array(n);
				for (let i = 0; i < n; i++) idx[i] = i;
				g.setIndex(new BufferAttribute(idx, 1));
			}
			parts.push(g);
		});
		if (!parts.length) continue;
		const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
		geometry.name = node.name;
		geometry.computeBoundingSphere();
		pieces.set(node.name, geometry);
	}
	return pieces;
}
