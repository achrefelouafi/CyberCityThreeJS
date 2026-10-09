// Title card rendered into the WebGPU frame (not the DOM), so canvas recordings
// (R) include it. Drawn once to a canvas texture; Post composites it with an
// animated opacity/scale driven by play()/update().
import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three/webgpu';

export class TitleCard {
	constructor() {
		const c = document.createElement('canvas');
		c.width = 2048;
		c.height = 1024;
		const g = c.getContext('2d');
		g.textAlign = 'center';
		g.textBaseline = 'middle';
		const glow = (text, font, y, color, blur, passes = 3) => {
			g.font = font;
			g.fillStyle = color;
			g.shadowColor = color;
			for (let i = 0; i < passes; i++) {
				g.shadowBlur = blur / (i + 1);
				g.fillText(text, 1024, y);
			}
			g.shadowBlur = 0;
		};
		glow('新京都', '900 300px "Noto Sans JP", "Yu Gothic", sans-serif', 380, '#ff2fa0', 90, 4);
		g.fillStyle = 'rgba(255,220,240,0.9)';
		g.font = '900 300px "Noto Sans JP", "Yu Gothic", sans-serif';
		g.fillText('新京都', 1024, 380);
		g.letterSpacing = '60px';
		glow('NEO//KYOTO', '800 104px "Orbitron", sans-serif', 640, '#9ff0ff', 40, 3);
		const grad = g.createLinearGradient(524, 0, 1524, 0);
		grad.addColorStop(0, 'rgba(24,214,255,0)');
		grad.addColorStop(0.3, '#18d6ff');
		grad.addColorStop(0.7, '#ff2fa0');
		grad.addColorStop(1, 'rgba(255,47,160,0)');
		g.shadowColor = '#18d6ff';
		g.shadowBlur = 20;
		g.fillStyle = grad;
		g.fillRect(524, 735, 1000, 4);
		g.shadowBlur = 0;
		g.letterSpacing = '14px';
		g.font = '700 34px "Rajdhani", sans-serif';
		g.fillStyle = 'rgba(205,225,255,0.85)';
		g.fillText('AN INFINITE CITY  ·  BLENDER GEOMETRY NODES  →  THREE.JS WEBGPU', 1024, 800);
		this.texture = new CanvasTexture(c);
		this.texture.colorSpace = SRGBColorSpace;
		this.texture.minFilter = LinearFilter;
		this.texture.generateMipmaps = false;
		this.t = Infinity;
	}

	play() { this.t = 0; }

	/** Returns { alpha, scale } for this frame. */
	update(dt) {
		this.t += dt;
		const t = this.t, T = 6.2;
		if (t >= T) return { alpha: 0, scale: 1 };
		const ease = (x) => x * x * (3 - 2 * x);
		const alpha = t < 0.9 ? ease(t / 0.9) : t < 4.4 ? 1 : 1 - ease((t - 4.4) / (T - 4.4));
		const scale = t < 0.9 ? 1.06 - 0.06 * ease(t / 0.9) : 1 - 0.02 * Math.max(0, (t - 4.4) / (T - 4.4));
		return { alpha, scale };
	}
}
