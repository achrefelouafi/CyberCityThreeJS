// On-screen flight controls for touch screens: a thumb stick on the left (steer +
// throttle, push past the ring to boost), climb / dive on the right, and the
// camera keys (V, F, C) as buttons. Dragging anywhere else on the city still looks
// around (Director.attachMouse). Shown on coarse pointers, or from the first touch
// on a hybrid laptop.

const R = 52; // stick travel, px
const DEAD = 0.12;

const MARKUP = `
	<div class="stick-zone">
		<div class="stick-base"><span class="stick-boost">BOOST</span><div class="stick-knob"></div></div>
	</div>
	<div class="touch-pad">
		<div class="touch-acts">
			<button class="tbtn" data-act="cam" type="button">CAM</button>
			<button class="tbtn" data-act="cockpit" type="button">COCKPIT</button>
			<button class="tbtn" data-act="fly" type="button">AUTO</button>
		</div>
		<div class="touch-lift">
			<button class="tbtn tbtn--lift" data-lift="1" type="button" aria-label="Climb">▲</button>
			<button class="tbtn tbtn--lift" data-lift="-1" type="button" aria-label="Dive">▼</button>
		</div>
	</div>`;

// dead zone, then a gentle curve so small thumb movements stay precise
const shape = (v) => {
	const a = Math.max(0, Math.min(1, (Math.abs(v) - DEAD) / (1 - DEAD)));
	return Math.sign(v) * a ** 1.4;
};

// (pointer: coarse) alone misses phones that misreport a fine, hovering pointer, and
// iPadOS, which poses as a Mac
export const isTouchFirst = () => window.matchMedia('(pointer: coarse)').matches
	|| /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
	|| (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export class TouchControls {
	constructor(parent, input, actions) {
		this.input = input;
		this.el = document.createElement('div');
		this.el.className = 'touch';
		this.el.innerHTML = MARKUP;
		parent.appendChild(this.el);
		this.state = '';

		if (isTouchFirst()) document.body.classList.add('touchscreen');
		window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') document.body.classList.add('touchscreen'); }, { capture: true });
		this.el.addEventListener('contextmenu', (e) => e.preventDefault());

		this._stick();
		for (const b of this.el.querySelectorAll('[data-lift]')) this._hold(b, (on) => { input.touch.lift = on ? +b.dataset.lift : 0; });
		for (const b of this.el.querySelectorAll('[data-act]')) b.addEventListener('click', () => actions[b.dataset.act]?.());
		this.fly = this.el.querySelector('[data-act="fly"]');
		this.cockpit = this.el.querySelector('[data-act="cockpit"]');
	}

	_stick() {
		const t = this.input.touch;
		const zone = this.el.querySelector('.stick-zone'), base = zone.firstElementChild, knob = base.querySelector('.stick-knob');
		let id = null, cx = 0, cy = 0;
		const move = (e) => {
			const dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
			knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
			t.steer = shape(dx / R);
			t.throttle = shape(-dy / R);
			// overdrive: dragging well past the ring, forwards, lights the boost
			t.boost = d > R * 1.5 && -dy > d * 0.7;
			base.classList.toggle('boost', t.boost);
			this.input.lastActive = performance.now();
		};
		zone.addEventListener('pointerdown', (e) => {
			if (id !== null) return;
			id = e.pointerId;
			zone.setPointerCapture(id);
			// the stick comes to the thumb
			const r = zone.getBoundingClientRect();
			cx = e.clientX; cy = e.clientY;
			base.style.left = `${cx - r.left}px`;
			base.style.top = `${cy - r.top}px`;
			base.classList.add('held');
			t.held++;
			move(e);
		});
		zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
		const end = (e) => {
			if (e.pointerId !== id) return;
			id = null;
			t.held = Math.max(0, t.held - 1);
			t.steer = t.throttle = 0;
			t.boost = false;
			base.style.left = base.style.top = knob.style.transform = '';
			base.classList.remove('held', 'boost');
		};
		zone.addEventListener('pointerup', end);
		zone.addEventListener('pointercancel', end);
	}

	_hold(btn, set) {
		const t = this.input.touch;
		let id = null;
		btn.addEventListener('pointerdown', (e) => {
			if (id !== null) return;
			id = e.pointerId;
			btn.setPointerCapture(id);
			btn.classList.add('held');
			t.held++;
			this.input.lastActive = performance.now();
			set(true);
		});
		const end = (e) => {
			if (e.pointerId !== id) return;
			id = null;
			btn.classList.remove('held');
			t.held = Math.max(0, t.held - 1);
			set(false);
		};
		btn.addEventListener('pointerup', end);
		btn.addEventListener('pointercancel', end);
	}

	/** Reflect who is flying and the camera on the buttons (cheap: only touches the DOM on change). */
	sync(pilot, cockpit) {
		const s = `${pilot}${cockpit}`;
		if (s === this.state) return;
		this.state = s;
		this.fly.textContent = pilot ? 'AUTO' : 'FLY';
		this.fly.classList.toggle('on', !pilot);
		this.cockpit.classList.toggle('on', cockpit);
	}
}
