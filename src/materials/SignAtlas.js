// Runtime-generated neon sign artwork.
// The atlas is a data texture, not a colour image:
//   R = primary neon tubes (text), G = accent tubes (frames, logos), B = backlit panel.
// The uber-shader colours R and G with two palette colours per sign, so 64 designs
// x 4 palette pairs give plenty of variety from one 2048^2 texture.
//
// Layout (canvas pixels):  y 0..1023     -> 16 x 2 tall cells (128 x 512)
//                          y 1024..2047  -> 4 x 8 wide cells (512 x 128)
import { CanvasTexture, LinearMipmapLinearFilter, LinearFilter, NoColorSpace } from 'three/webgpu';

export const ATLAS = { size: 2048, tall: { w: 128, h: 512, cols: 16, rows: 2 }, wide: { w: 512, h: 128, cols: 4, rows: 8, y0: 1024 } };

const TALL = ['ラーメン', '東京', '新宿', '電脳', '未来', '居酒屋', '寿司', '酒場', '薬局', 'ホテル', 'カラオケ', 'ゲーム',
	'夜城', '龍', '夢', '光', '銀河', '電気街', '侍', '忍者', '天国', '自由', '映画館', '喫茶', '中華', '焼肉', '漫画', '占い',
	'神社', '未来都市', '電子', '麺'];
const WIDE = [['RAMEN', 'M'], ['NEO TOKYO', 'O'], ['CYBERNETICS', 'O'], ['HOTEL', 'M'], ['ARCADE', 'M'], ['SUSHI BAR', 'R'],
	['KARAOKE', 'O'], ['NOODLES 24H', 'R'], ['BAR 2087', 'M'], ['NIGHT CITY', 'O'], ['GENOME LABS', 'R'], ['SYNTH DRINK', 'O'],
	['DATA HAVEN', 'O'], ['OPEN 24/7', 'M'], ['HOLO VIDEO', 'R'], ['CLINIC', 'O'], ['ネオン', 'J'], ['ラーメン', 'J'],
	['サイバー', 'J'], ['DREAMS', 'M'], ['PACHINKO', 'O'], ['VOID', 'M'], ['NEXUS', 'O'], ['ZAIBATSU', 'O'], ['LOVE', 'M'],
	['MOTEL', 'M'], ['KOI', 'M'], ['TECH NOIR', 'R'], ['STAY AWAKE', 'R'], ['PHARMA', 'O'], ['AUGMENT', 'O'], ['ネオ京都', 'J']];

const FONTS = {
	J: '900 {s}px "Noto Sans JP", "Yu Gothic", "Hiragino Sans", sans-serif',
	M: '400 {s}px "Monoton", "Orbitron", sans-serif',
	O: '800 {s}px "Orbitron", sans-serif',
	R: '700 {s}px "Rajdhani", sans-serif',
};
const font = (k, s) => FONTS[k].replace('{s}', Math.round(s));

const R = (a = 255) => `rgba(255,0,0,${a / 255})`;
const G = (a = 255) => `rgba(0,255,0,${a / 255})`;
const B = (a = 255) => `rgba(0,0,255,${a / 255})`;

function rng(seed) {
	let s = seed >>> 0;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function preloadFonts() {
	if (!document.fonts) return;
	const jp = TALL.join('') + WIDE.filter((w) => w[1] === 'J').map((w) => w[0]).join('') + '新京都';
	await Promise.allSettled([
		document.fonts.load(font('J', 64), jp),
		document.fonts.load(font('M', 64), 'RAMEN'),
		document.fonts.load(font('O', 64), 'NEO'),
		document.fonts.load(font('R', 64), 'BAR'),
		document.fonts.load('700 16px "Rajdhani"', 'HUD'),
		document.fonts.load('800 16px "Orbitron"', 'HUD'),
	]);
}

function glowText(ctx, text, x, y, color, blur) {
	ctx.shadowColor = color;
	ctx.shadowBlur = blur;
	ctx.fillStyle = color;
	ctx.fillText(text, x, y);
	ctx.shadowBlur = blur * 0.35;
	ctx.fillText(text, x, y);
	ctx.shadowBlur = 0;
	ctx.fillText(text, x, y);
}

function glowRect(ctx, x, y, w, h, r, color, lw, blur) {
	ctx.shadowColor = color;
	ctx.shadowBlur = blur;
	ctx.strokeStyle = color;
	ctx.lineWidth = lw;
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
	ctx.stroke();
	ctx.shadowBlur = 0;
	ctx.stroke();
}

function panel(ctx, x, y, w, h, rnd) {
	const gr = ctx.createLinearGradient(x, y, x, y + h);
	const a = 40 + rnd() * 50;
	gr.addColorStop(0, B(a));
	gr.addColorStop(0.5, B(a * 0.6));
	gr.addColorStop(1, B(a));
	ctx.fillStyle = gr;
	ctx.fillRect(x, y, w, h);
}

function drawTall(ctx, i, x, y, w, h) {
	const rnd = rng(i * 7919 + 13);
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.clip();
	panel(ctx, x, y, w, h, rnd);
	const word = TALL[i % TALL.length];
	const chars = [...word];
	const variant = Math.floor(rnd() * 3);
	const pad = 12;
	if (variant !== 2) glowRect(ctx, x + pad, y + pad, w - pad * 2, h - pad * 2, 10, G(), 4, 14);
	let top = y + 30;
	if (variant === 1) {
		// circular logo above the characters
		ctx.shadowColor = G(); ctx.shadowBlur = 12; ctx.strokeStyle = G(); ctx.lineWidth = 5;
		ctx.beginPath(); ctx.arc(x + w / 2, y + 62, 34, 0, Math.PI * 2); ctx.stroke();
		ctx.font = font('O', 30); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		glowText(ctx, String(Math.floor(rnd() * 90 + 10)), x + w / 2, y + 64, R(), 10);
		top = y + 112;
	}
	const avail = y + h - 26 - top;
	const size = Math.min(w - 34, avail / chars.length * 0.92);
	ctx.font = font('J', size);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	chars.forEach((c, k) => glowText(ctx, c, x + w / 2, top + (k + 0.5) * (avail / chars.length), R(), 16));
	if (variant === 2) {
		// side rails instead of a frame
		ctx.shadowColor = G(); ctx.shadowBlur = 12; ctx.fillStyle = G();
		ctx.fillRect(x + 8, y + 20, 5, h - 40);
		ctx.fillRect(x + w - 13, y + 20, 5, h - 40);
	}
	ctx.restore();
}

function drawWide(ctx, i, x, y, w, h) {
	const rnd = rng(i * 104729 + 7);
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.clip();
	panel(ctx, x, y, w, h, rnd);
	const [word, fk] = WIDE[i % WIDE.length];
	const frame = rnd() < 0.6;
	if (frame) glowRect(ctx, x + 10, y + 10, w - 20, h - 20, 14, G(), 4, 14);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	let size = fk === 'J' ? 76 : fk === 'M' ? 74 : 62;
	ctx.font = font(fk, size);
	const maxW = w - (frame ? 70 : 40);
	const mw = ctx.measureText(word).width;
	if (mw > maxW) { size *= maxW / mw; ctx.font = font(fk, size); }
	const sub = rnd() < 0.35;
	glowText(ctx, word, x + w / 2, y + h / 2 + (sub ? -10 : 2), R(), 18);
	if (sub) {
		ctx.font = font('R', 20);
		glowText(ctx, ['OPEN ALL NIGHT', '— SECTOR 7 —', 'EST. 2071', '24 HOURS', 'NO SIGNAL'][Math.floor(rnd() * 5)], x + w / 2, y + h - 26, G(), 8);
	}
	if (!frame && rnd() < 0.5) {
		// underline sweep
		ctx.shadowColor = G(); ctx.shadowBlur = 12; ctx.fillStyle = G();
		ctx.fillRect(x + 40, y + h - 16, w - 80, 4);
	}
	ctx.restore();
}

export function createSignAtlas() {
	const { size, tall, wide } = ATLAS;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, size, size);
	ctx.globalCompositeOperation = 'lighter';
	for (let r = 0; r < tall.rows; r++) {
		for (let c = 0; c < tall.cols; c++) drawTall(ctx, r * tall.cols + c, c * tall.w, r * tall.h, tall.w, tall.h);
	}
	for (let r = 0; r < wide.rows; r++) {
		for (let c = 0; c < wide.cols; c++) drawWide(ctx, r * wide.cols + c, c * wide.w, wide.y0 + r * wide.h, wide.w, wide.h);
	}
	const tex = new CanvasTexture(canvas);
	tex.colorSpace = NoColorSpace;
	tex.generateMipmaps = true;
	tex.minFilter = LinearMipmapLinearFilter;
	tex.magFilter = LinearFilter;
	tex.anisotropy = 8;
	tex.flipY = false; // pixel row 0 = v 0
	tex.needsUpdate = true;
	tex.userData.canvas = canvas;
	return tex;
}
