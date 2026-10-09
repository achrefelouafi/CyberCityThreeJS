// One-key capture for social posts: R toggles a high-bitrate canvas recording
// (MP4/H.264 when the browser supports it, WebM otherwise); P saves a PNG still.

export class Capture {
	constructor(canvas) {
		this.canvas = canvas;
		this.recorder = null;
		this.chunks = [];
		this.started = 0;
		this.wantPhoto = false;
		this.el = document.getElementById('rec');
		this.timeEl = document.getElementById('rec-time');
	}

	get recording() { return !!this.recorder; }

	toggle() {
		if (this.recorder) return this.stop();
		const types = ['video/mp4;codecs=avc1.640033', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
		const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
		if (!mimeType) return;
		const stream = this.canvas.captureStream(60);
		this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 40_000_000 });
		this.chunks = [];
		this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
		this.recorder.onstop = () => {
			const blob = new Blob(this.chunks, { type: mimeType });
			this._save(blob, `neo-kyoto-${stamp()}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
		};
		this.recorder.start(250);
		this.started = performance.now();
		this.el.classList.remove('hidden');
	}

	stop() {
		this.recorder?.stop();
		this.recorder = null;
		this.el.classList.add('hidden');
	}

	tick() {
		if (!this.recorder) return;
		const s = Math.floor((performance.now() - this.started) / 1000);
		this.timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	}

	/** Call right after a frame was rendered so the drawing buffer is valid. */
	afterRender() {
		if (!this.wantPhoto) return;
		this.wantPhoto = false;
		this.canvas.toBlob((b) => b && this._save(b, `neo-kyoto-${stamp()}.png`), 'image/png');
	}

	_save(blob, name) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	}
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
