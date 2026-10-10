// Runs the Blender side of the pipeline headlessly:
//   1. blender/build.py  -> blender/cybercity.blend (+ optional preview render)
//   2. blender/export.py -> public/assets/{kit.glb, car.glb, manifest.json, parity.json}
//
//   npm run assets                 build + export
//   npm run assets -- --render     also render the docs/ images (city, car, kit catalogue)
//   npm run car                    rebuild only the hover car (add -- --render for studio stills)
//   BLENDER=/path/to/blender npm run assets
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function findBlender() {
	if (process.env.BLENDER) return process.env.BLENDER;
	const candidates = [];
	if (process.platform === 'win32') {
		const base = 'C:/Program Files/Blender Foundation';
		if (existsSync(base)) {
			const versions = readdirSync(base).filter((d) => d.startsWith('Blender')).sort((a, b) => parseFloat(b.split(' ')[1]) - parseFloat(a.split(' ')[1]));
			for (const v of versions) candidates.push(join(base, v, 'blender.exe'));
		}
	} else if (process.platform === 'darwin') {
		candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
	}
	candidates.push('blender');
	return candidates.find((c) => c === 'blender' || existsSync(c));
}

function run(blender, args) {
	console.log(`\n> blender ${args.join(' ')}`);
	const r = spawnSync(blender, args, { cwd: root, stdio: 'inherit' });
	if (r.status !== 0) {
		console.error(`Blender exited with ${r.status}`);
		process.exit(r.status ?? 1);
	}
}

const blender = findBlender();
console.log('Using Blender:', blender);
const render = process.argv.includes('--render');
if (process.argv.includes('--car')) {
	// fast path: rebuild only the hover car (blender/car.py) -> public/assets/car.glb (+ docs/car_*.png with --render)
	run(blender, ['-b', '--factory-startup', '--python', 'blender/car.py', '--', 'public/assets/car.glb', ...(render ? ['docs'] : [])]);
	console.log('Car rebuilt -> public/assets/car.glb');
	process.exit(0);
}
run(blender, ['-b', '--factory-startup', '--python', 'blender/build.py']);
run(blender, ['-b', 'blender/cybercity.blend', '--python', 'blender/export.py', '--', '--out', 'public/assets']);
if (render) {
	// press renders: EEVEE city window, car studio stills, per-piece kit catalogue
	run(blender, ['-b', 'blender/cybercity.blend', '--python', 'blender/render_previews.py']);
	run(blender, ['-b', 'blender/cybercity.blend', '--python', 'blender/render_car.py']);
	run(blender, ['-b', 'blender/cybercity.blend', '--python', 'blender/render_kit_sheet.py']);
	const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['scripts/kit_sheet.py'], { cwd: root, stdio: 'inherit' });
	if (py.status !== 0) console.warn('kit_sheet.py needs Python + Pillow; skipped the contact sheets');
}
console.log('\nPipeline complete -> public/assets');
