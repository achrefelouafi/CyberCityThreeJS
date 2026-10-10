// Live cockpit displays for the KX-11: one 1024x1024 canvas mapped onto the three
// dashboard screens (UV rects baked by blender/car.py):
//   cluster   (0,0)-(1024,320)    speed arc, altitude tape, throttle / boost
//   centre    (0,320)-(410,832)   moving street-grid map with heading
//   passenger (420,320)-(1024,470) radio marquee + spectrum
import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three/webgpu';

const CYAN = '#18d6ff', PINK = '#ff2fa0', AMBER = '#ffa03a', DIM = 'rgba(150,200,255,0.35)';
const STATIONS = ['NEO//KYOTO FM 88.3', 'NIGHT CITY WAVES', 'RYUJIN AIR · TRAFFIC', 'SYNTH SAKE RADIO'];
const TRACKS = ['TEARS IN RAIN (EXTENDED)', 'NEON CANYON — ONI ENERGY MIX', 'KESTREL // AFTERBURN', 'MIDNIGHT ON SECTOR 7'];

export class CockpitScreens {
	constructor(atlas) {
		this.r = atlas ?? { cluster: [0, 0, 1024, 320], centre: [0, 320, 410, 832], passenger: [420, 320, 1024, 470] };
		this.canvas = document.createElement('canvas');
		this.canvas.width = this.canvas.height = 1024;
		this.g = this.canvas.getContext('2d');
		this.texture = new CanvasTexture(this.canvas);
		this.texture.colorSpace = SRGBColorSpace;
		this.texture.flipY = false; // glTF UV convention
		this.texture.generateMipmaps = false;
		this.texture.minFilter = LinearFilter;
		this.acc = 1;
		this.t = 0;
		this.station = 0;
		this.spec = new Float32Array(24);
	}

	/** state: { speed (m/s), alt, boost, throttle, heading (rad), x, z (absolute), pitch, street, mode } */
	update(dt, s) {
		this.t += dt;
		this.acc += dt;
		if (this.acc < 1 / 15) return;
		this.acc = 0;
		const g = this.g;
		g.fillStyle = '#000';
		g.fillRect(0, 0, 1024, 1024);
		this.cluster(g, s);
		this.map(g, s);
		this.radio(g);
		this.texture.needsUpdate = true;
	}

	frame(g, [x0, y0, x1, y1], tint) {
		const grd = g.createLinearGradient(0, y0, 0, y1);
		grd.addColorStop(0, '#071c2e');
		grd.addColorStop(1, '#120828');
		g.fillStyle = grd;
		g.fillRect(x0, y0, x1 - x0, y1 - y0);
		g.strokeStyle = tint;
		g.globalAlpha = 0.35;
		g.lineWidth = 2;
		g.strokeRect(x0 + 6, y0 + 6, x1 - x0 - 12, y1 - y0 - 12);
		g.globalAlpha = 0.07;
		g.fillStyle = tint;
		for (let y = y0; y < y1; y += 4) g.fillRect(x0, y, x1 - x0, 1);
		g.globalAlpha = 1;
	}

	cluster(g, s) {
		const [x0, y0, x1, y1] = this.r.cluster;
		this.frame(g, this.r.cluster, CYAN);
		const kmh = Math.abs(s.speed) * 3.6;
		// speed arc
		const cx = x0 + 250, cy = y0 + 200, R = 150;
		const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, f = Math.min(kmh / 400, 1);
		g.lineCap = 'round';
		g.lineWidth = 14;
		g.strokeStyle = 'rgba(24,214,255,0.12)';
		g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
		g.strokeStyle = s.boost > 0.1 ? PINK : CYAN;
		g.shadowColor = g.strokeStyle; g.shadowBlur = 18;
		g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * f); g.stroke();
		g.shadowBlur = 0;
		for (let k = 0; k <= 8; k++) {
			const a = a0 + (a1 - a0) * k / 8;
			g.strokeStyle = DIM; g.lineWidth = 3;
			g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); g.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); g.stroke();
		}
		g.fillStyle = '#e8f6ff';
		g.textAlign = 'center';
		g.font = '800 92px Orbitron, sans-serif';
		g.fillText(String(Math.round(kmh)).padStart(3, '0'), cx, cy + 22);
		g.font = '700 26px Rajdhani, sans-serif';
		g.fillStyle = CYAN;
		g.fillText('KM/H', cx, cy + 62);
		// altitude tape
		const ax = x1 - 170;
		g.fillStyle = 'rgba(24,214,255,0.06)';
		g.fillRect(ax - 60, y0 + 30, 160, y1 - y0 - 60);
		g.font = '700 22px Rajdhani, sans-serif';
		g.textAlign = 'right';
		for (let k = -4; k <= 4; k++) {
			const v = Math.round(s.alt / 10) * 10 + k * 10;
			const y = y0 + 160 - (v - s.alt) * 2.6;
			if (y < y0 + 36 || y > y1 - 36) continue;
			g.fillStyle = DIM;
			g.fillRect(ax - 50, y, k % 2 ? 14 : 26, 2);
			g.fillText(String(v), ax + 60, y + 8);
		}
		g.fillStyle = AMBER;
		g.font = '800 40px Orbitron, sans-serif';
		g.fillText(String(Math.round(s.alt)), ax + 70, y0 + 174);
		g.font = '700 20px Rajdhani, sans-serif';
		g.fillText('ALT M', ax + 70, y0 + 60);
		// throttle + boost bars
		const bx = x0 + 470, bw = 280;
		g.textAlign = 'left';
		g.font = '700 22px Rajdhani, sans-serif';
		g.fillStyle = DIM;
		g.fillText('THRUST', bx, y0 + 96);
		g.fillText('BOOST', bx, y0 + 176);
		for (let k = 0; k < 20; k++) {
			const on = k / 20 < s.throttle;
			g.fillStyle = on ? CYAN : 'rgba(24,214,255,0.1)';
			g.fillRect(bx + k * (bw / 20), y0 + 108, bw / 20 - 4, 22);
			g.fillStyle = k / 20 < s.boost ? PINK : 'rgba(255,47,160,0.1)';
			g.fillRect(bx + k * (bw / 20), y0 + 188, bw / 20 - 4, 22);
		}
		g.fillStyle = '#e8f6ff';
		g.font = '800 26px Orbitron, sans-serif';
		g.fillText('KX-11 KESTREL', bx, y0 + 58);
		g.fillStyle = s.mode === 'drive' ? CYAN : AMBER;
		g.font = '700 22px Rajdhani, sans-serif';
		g.fillText(s.mode === 'drive' ? '● MANUAL' : '● AUTOPILOT', bx, y0 + 262);
		const d = new Date();
		g.fillStyle = DIM;
		g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, bx + 210, y0 + 262);
	}

	map(g, s) {
		const [x0, y0, x1, y1] = this.r.centre;
		this.frame(g, this.r.centre, PINK);
		const w = x1 - x0, h = y1 - y0, cx = x0 + w / 2, cy = y0 + h * 0.58;
		g.save();
		g.beginPath();
		g.rect(x0 + 8, y0 + 8, w - 16, h - 16);
		g.clip();
		const scale = 0.9; // px per metre
		g.translate(cx, cy);
		g.rotate(s.heading - Math.PI / 2);
		const P = s.pitch || 86, SW = s.street || 28;
		const ox = ((s.x % P) + P) % P, oz = ((s.z % P) + P) % P;
		// blocks
		for (let i = -4; i <= 4; i++) {
			for (let j = -4; j <= 4; j++) {
				const bx = (i * P - ox + SW / 2) * scale, bz = (j * P - oz + SW / 2) * scale;
				const sz = (P - SW) * scale;
				g.fillStyle = 'rgba(255,47,160,0.28)';
				g.fillRect(bx, bz, sz, sz);
				g.strokeStyle = 'rgba(255,120,200,0.95)';
				g.lineWidth = 3;
				g.strokeRect(bx, bz, sz, sz);
			}
		}
		g.restore();
		// car + heading cone
		g.fillStyle = 'rgba(24,214,255,0.22)';
		g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 160, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45); g.fill();
		g.fillStyle = CYAN;
		g.shadowColor = CYAN; g.shadowBlur = 12;
		g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx + 11, cy + 12); g.lineTo(cx, cy + 6); g.lineTo(cx - 11, cy + 12); g.fill();
		g.shadowBlur = 0;
		// compass + labels
		const deg = ((90 - s.heading * 180 / Math.PI) % 360 + 360) % 360;
		g.fillStyle = '#e8f6ff';
		g.textAlign = 'center';
		g.font = '800 30px Orbitron, sans-serif';
		g.fillText(`${String(Math.round(deg)).padStart(3, '0')}°`, cx, y0 + 50);
		g.font = '700 20px Rajdhani, sans-serif';
		g.fillStyle = PINK;
		g.fillText(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8], cx, y0 + 76);
		g.fillStyle = DIM;
		g.fillText('SECTOR NAV · LIVE', cx, y1 - 22);
	}

	radio(g) {
		const [x0, y0, x1, y1] = this.r.passenger;
		this.frame(g, this.r.passenger, AMBER);
		if (Math.floor(this.t / 14) % STATIONS.length !== this.station) this.station = Math.floor(this.t / 14) % STATIONS.length;
		g.fillStyle = AMBER;
		g.textAlign = 'left';
		g.font = '800 24px Orbitron, sans-serif';
		g.fillText(STATIONS[this.station], x0 + 22, y0 + 44);
		g.save();
		g.beginPath();
		g.rect(x0 + 14, y0 + 56, x1 - x0 - 200, 50);
		g.clip();
		const txt = `NOW PLAYING · ${TRACKS[this.station]} · `;
		g.font = '700 30px Rajdhani, sans-serif';
		g.fillStyle = '#ffe7cc';
		const tw = g.measureText(txt).width;
		const off = (this.t * 70) % tw;
		g.fillText(txt + txt + txt, x0 + 22 - off, y0 + 94);
		g.restore();
		for (let k = 0; k < this.spec.length; k++) {
			const target = 0.2 + 0.8 * Math.abs(Math.sin(this.t * (2 + k * 0.37) + k * 1.7)) * Math.abs(Math.sin(this.t * 0.9 + k));
			this.spec[k] += (target - this.spec[k]) * 0.5;
			const bh = this.spec[k] * 90;
			g.fillStyle = k % 3 ? AMBER : PINK;
			g.fillRect(x1 - 170 + k * 6.5, y1 - 22 - bh, 4.5, bh);
		}
	}
}
