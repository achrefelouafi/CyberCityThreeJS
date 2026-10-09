// Floating holo-poster artwork, painted at runtime on a canvas (8 x 2 portrait cells of
// 256 x 512). Fictional brands only: no third-party imagery, nothing to license.
// Each design mixes a palette gradient, a graphic motif (sun, rings, grid, bars, eye,
// waves), a huge vertical kanji line, a Latin brand name and small print.
import { CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three/webgpu';

export const POSTER = { cols: 8, rows: 2, w: 256, h: 512 };

const DESIGNS = [
	['電脳酒', 'SYNTH SAKE', 'sun'], ['夜光', 'NOCTILUCA', 'rings'], ['義眼', 'OPTIK-9', 'eye'], ['龍神', 'RYUJIN AIR', 'waves'],
	['未来', 'MIRAI BANK', 'grid'], ['夢見', 'DREAMWARE', 'bars'], ['天狐', 'TENKO RAMEN', 'sun'], ['電子', 'ZERO-ONE', 'grid'],
	['桜', 'SAKURA NET', 'rings'], ['鬼', 'ONI ENERGY', 'bars'], ['魂', 'SOUL SYNC', 'eye'], ['光速', 'LUX LINE', 'waves'],
	['極楽', 'PARADISO', 'sun'], ['金魚', 'KINGYO', 'rings'], ['新京都', 'NEO KYOTO', 'grid'], ['禅', 'ZEN OS', 'eye'],
];
const PAL = [['#ff1e8c', '#2a003a'], ['#00d0ff', '#001a33'], ['#9a3dff', '#14002e'], ['#ff8a1a', '#2e0a00'], ['#00ffa8', '#00261c']];

function rng(seed) {
	let s = seed >>> 0;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function createPosterAtlas() {
	if (document.fonts) {
		await Promise.allSettled([
			document.fonts.load('900 64px "Noto Sans JP"', DESIGNS.map((d) => d[0]).join('')),
			document.fonts.load('800 32px "Orbitron"', 'ABC'),
			document.fonts.load('700 16px "Rajdhani"', 'ABC'),
		]);
	}
	const { cols, rows, w, h } = POSTER;
	const c = document.createElement('canvas');
	c.width = cols * w;
	c.height = rows * h;
	const g = c.getContext('2d');
	DESIGNS.forEach(([kanji, brand, motif], i) => {
		const r = rng(i * 7919 + 13);
		const x0 = (i % cols) * w, y0 = Math.floor(i / cols) * h;
		const [hi, lo] = PAL[i % PAL.length];
		const [hi2] = PAL[(i + 2) % PAL.length];
		g.save();
		g.beginPath();
		g.rect(x0, y0, w, h);
		g.clip();
		const bg = g.createLinearGradient(x0, y0, x0, y0 + h);
		bg.addColorStop(0, lo);
		bg.addColorStop(0.55, '#05030a');
		bg.addColorStop(1, lo);
		g.fillStyle = bg;
		g.fillRect(x0, y0, w, h);
		const cx = x0 + w / 2, cy = y0 + h * 0.36;
		g.lineCap = 'round';
		g.shadowColor = hi;
		g.shadowBlur = 18;
		if (motif === 'sun') {
			const sg = g.createLinearGradient(0, cy - 80, 0, cy + 80);
			sg.addColorStop(0, '#ffe066');
			sg.addColorStop(1, hi);
			g.fillStyle = sg;
			g.beginPath();
			g.arc(cx, cy, 82, 0, Math.PI * 2);
			g.fill();
			g.fillStyle = lo;
			for (let k = 0; k < 6; k++) g.fillRect(x0, cy + 6 + k * 13, w, 3 + k * 1.3);
		} else if (motif === 'rings') {
			g.strokeStyle = hi;
			for (let k = 0; k < 6; k++) {
				g.lineWidth = 2 + (k % 2) * 4;
				g.beginPath();
				g.arc(cx, cy, 20 + k * 16, r() * 6, r() * 6 + 4.2);
				g.stroke();
			}
		} else if (motif === 'eye') {
			g.strokeStyle = hi;
			g.lineWidth = 6;
			g.beginPath();
			g.moveTo(cx - 100, cy);
			g.quadraticCurveTo(cx, cy - 90, cx + 100, cy);
			g.quadraticCurveTo(cx, cy + 90, cx - 100, cy);
			g.stroke();
			g.fillStyle = hi2;
			g.beginPath();
			g.arc(cx, cy, 34, 0, Math.PI * 2);
			g.fill();
			g.fillStyle = '#000';
			g.beginPath();
			g.arc(cx, cy, 14, 0, Math.PI * 2);
			g.fill();
		} else if (motif === 'waves') {
			g.strokeStyle = hi;
			for (let k = 0; k < 7; k++) {
				g.lineWidth = 3;
				g.beginPath();
				for (let x = 0; x <= w; x += 6) g.lineTo(x0 + x, cy - 60 + k * 20 + Math.sin(x * 0.05 + k) * 12);
				g.stroke();
			}
		} else if (motif === 'grid') {
			g.strokeStyle = hi;
			g.lineWidth = 2;
			for (let k = 0; k < 12; k++) {
				const y = cy + 10 + k * k * 1.6;
				g.beginPath();
				g.moveTo(x0, y);
				g.lineTo(x0 + w, y);
				g.stroke();
			}
			for (let k = -8; k <= 8; k++) {
				g.beginPath();
				g.moveTo(cx + k * 6, cy + 10);
				g.lineTo(cx + k * 40, cy + 240);
				g.stroke();
			}
			g.fillStyle = hi2;
			g.beginPath();
			g.moveTo(cx, cy - 90);
			g.lineTo(cx + 60, cy);
			g.lineTo(cx - 60, cy);
			g.fill();
		} else {
			for (let k = 0; k < 14; k++) {
				g.fillStyle = k % 3 ? hi : hi2;
				const bh = 20 + r() * 150;
				g.fillRect(x0 + 18 + k * 16, cy + 70 - bh, 10, bh);
			}
		}
		// vertical kanji down the right edge
		g.shadowBlur = 22;
		g.fillStyle = '#fff';
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		const ks = Math.min(84, 300 / kanji.length);
		g.font = `900 ${ks}px "Noto Sans JP", sans-serif`;
		[...kanji].forEach((ch, k) => g.fillText(ch, x0 + w - 40, y0 + h * 0.6 + k * ks * 1.02 - (kanji.length - 1) * ks * 0.2));
		// brand + small print
		g.shadowBlur = 14;
		g.fillStyle = hi;
		g.textAlign = 'left';
		g.font = '800 26px "Orbitron", sans-serif';
		const words = brand.split(' ');
		words.forEach((wd, k) => g.fillText(wd, x0 + 16, y0 + h * 0.66 + k * 30));
		g.shadowBlur = 0;
		g.fillStyle = 'rgba(255,255,255,0.7)';
		g.font = '700 13px "Rajdhani", sans-serif';
		for (let k = 0; k < 4; k++) g.fillText(['24H · 全館営業', 'NOW IN NEURAL', '第' + (k + 3) + '世代', 'ACCESS ' + Math.floor(r() * 9000 + 1000)][k], x0 + 16, y0 + h * 0.8 + k * 16);
		// frame + scanlines
		g.strokeStyle = hi;
		g.lineWidth = 4;
		g.strokeRect(x0 + 6, y0 + 6, w - 12, h - 12);
		g.fillStyle = 'rgba(0,0,0,0.18)';
		for (let y = 0; y < h; y += 4) g.fillRect(x0, y0 + y, w, 1);
		g.restore();
	});
	const tex = new CanvasTexture(c);
	tex.colorSpace = SRGBColorSpace;
	tex.minFilter = LinearMipmapLinearFilter;
	tex.magFilter = LinearFilter;
	tex.anisotropy = 8;
	return tex;
}
