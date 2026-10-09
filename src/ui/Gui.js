// Control panel generated from manifest.json: every input socket of the Blender
// CC_CityGenerator node group becomes a slider here (same name, range, panel and
// description), so the web build is driven by exactly the controls an artist
// sees in Blender's modifier panel.
import GUI from 'lil-gui';

export function buildGui({ manifest, values, onCityChange, groups }) {
	const gui = new GUI({ title: 'NEO//KYOTO · CONTROL' });
	gui.domElement.classList.add('hidden-panel');

	// ---------------------------------------------------------------- city (from Blender)
	const city = gui.addFolder(`City · ${manifest.city.nodeGroup} (Geometry Nodes)`);
	const panels = {};
	let pending = null;
	const changed = () => {
		clearTimeout(pending);
		pending = setTimeout(() => onCityChange(values), 180);
	};
	for (const inp of manifest.city.inputs) {
		if (inp.panel === 'Preview') continue; // Blender-only viewport window
		const folder = panels[inp.panel] ?? (panels[inp.panel] = city.addFolder(inp.panel));
		let c;
		if (inp.socketType === 'NodeSocketColor') {
			const proxy = { v: values[inp.name].slice(0, 3) };
			c = folder.addColor(proxy, 'v').name(inp.name).onChange((v) => { values[inp.name] = [...v, 1]; changed(); });
		} else if (inp.socketType === 'NodeSocketInt') {
			c = folder.add(values, inp.name, inp.min, Math.min(inp.max, inp.min + 1000), 1).onChange(changed);
		} else if (inp.socketType === 'NodeSocketFloat') {
			c = folder.add(values, inp.name, inp.min, inp.max, (inp.max - inp.min) / 400).onChange(changed);
		} else continue;
		if (inp.description) c.domElement.title = inp.description;
	}
	for (const name of ['Skyline', 'Massing', 'Details', 'Palette']) panels[name]?.close();

	// ---------------------------------------------------------------- kit inventory (read only)
	const kit = gui.addFolder(`Kit · ${manifest.pieces.length} GN pieces (${manifest.generator})`);
	for (const p of manifest.pieces) {
		const info = { [p.name]: `${p.nodeGroup} · ${p.triangles} tris` };
		kit.add(info, p.name).disable();
	}
	kit.close();

	// ---------------------------------------------------------------- runtime groups
	for (const [title, items] of Object.entries(groups)) {
		const f = gui.addFolder(title);
		for (const it of items) {
			const { obj, key, min, max, step, name, color, options, onChange } = it;
			let c;
			if (color) c = f.addColor(obj, key);
			else if (options) c = f.add(obj, key, options);
			else if (typeof obj[key] === 'boolean' || typeof obj[key] === 'function') c = f.add(obj, key);
			else c = f.add(obj, key, min, max, step);
			if (name) c.name(name);
			if (onChange) c.onChange(onChange);
		}
		f.close();
	}
	return gui;
}
