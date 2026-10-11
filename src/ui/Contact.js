// Who built the city: a small card in the bottom-left corner, above the gauges
// (bottom-right is the key legend, the right side is the settings panel).
// Collapses to the portrait alone; that choice is remembered, and small windows
// start collapsed. The source link stays out as a pill beside the portrait
// when collapsed, so the code is always one click away.

const SITE_URL = 'https://chirostudio.xyz';
const X_URL = 'https://x.com/chirovisuals';
const REPO_URL = 'https://github.com/achrefelouafi/CyberCityThreeJS';

const ICON_GITHUB = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.936-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128a10.193 10.193 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.221 2.64.111 2.915.701.77 1.127 1.747 1.127 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11Z"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
const ICON_SITE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.4 9h17.2M3.4 15h17.2"/><path d="M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z"/></svg>`;

const link = (href, mod, icon, label, sub) => `
	<a class="contact-link contact-link--${mod}" href="${href}" target="_blank" rel="noopener noreferrer">
		<span class="contact-icon">${icon}</span>
		<span class="contact-link-text"><b>${label}</b><em>${sub}</em></span>
		<span class="contact-go" aria-hidden="true">↗</span>
	</a>`;

const MARKUP = `
	<div class="contact-card">
		<button class="contact-toggle" type="button" aria-label="Hide the contact card" title="Hide"><span></span></button>
		<div class="contact-head">
			<div class="contact-portrait"><img src="./contact/p.jpg" alt="Portrait of Chiro" decoding="async" draggable="false" /></div>
			<div class="contact-who">
				<span class="contact-status"><i></i>AVAILABLE FOR WORK</span>
				<span class="contact-name">CHIRO</span>
				<span class="contact-role">CREATIVE DEV · 3D · GAMES</span>
			</div>
		</div>
		<div class="contact-rule"></div>
		<p class="contact-note">Every block of this city is generated: Blender Geometry Nodes, rebuilt live in WebGPU. Yours could be too.</p>
		<div class="contact-links">
			${link(REPO_URL, 'code', ICON_GITHUB, 'GET THE SOURCE', 'OPEN SOURCE · MIT · GITHUB')}
			${link(X_URL, 'x', ICON_X, '@CHIROVISUALS', 'WORK IN MOTION, DAILY')}
			${link(SITE_URL, 'site', ICON_SITE, 'CHIROSTUDIO.XYZ', 'PORTFOLIO &amp; CONTACT')}
		</div>
	</div>
	<span class="contact-label" aria-hidden="true">WORK WITH ME</span>
	<a class="contact-pill" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" aria-label="Get the source code on GitHub">${ICON_GITHUB}<span>GET THE CODE</span></a>`;

const STORE_KEY = 'chiro.contact.collapsed';
// below this the card would crowd the brand / gauges, so it starts as the portrait alone
const ROOM = '(min-width: 1100px) and (min-height: 720px)';

function readCollapsed() {
	try {
		const v = localStorage.getItem(STORE_KEY);
		if (v !== null) return v === '1';
	} catch { /* private window: fall back to the window size */ }
	return !window.matchMedia(ROOM).matches;
}

export class Contact {
	constructor(parent) {
		this.el = document.createElement('div');
		this.el.className = 'contact';
		this.el.innerHTML = MARKUP;
		parent.appendChild(this.el);
		this.toggle = this.el.querySelector('.contact-toggle');
		this.setCollapsed(readCollapsed(), false);
		this.toggle.addEventListener('click', (e) => {
			this.setCollapsed(!this.collapsed);
			// a mouse click must not leave focus here, or SPACE (climb) would re-press it
			if (e.detail > 0) this.toggle.blur();
		});
	}

	setCollapsed(collapsed, persist = true) {
		this.collapsed = collapsed;
		this.el.classList.toggle('collapsed', collapsed);
		this.toggle.setAttribute('aria-label', collapsed ? 'Show the contact card' : 'Hide the contact card');
		this.toggle.title = collapsed ? 'Work with me' : 'Hide';
		if (persist) try { localStorage.setItem(STORE_KEY, collapsed ? '1' : '0'); } catch { /* forgets between visits */ }
	}

	// entrance waits for the loader to clear, so it isn't played behind it
	reveal() { this.el.classList.add('ready'); }
}
