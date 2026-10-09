// Art-directed looks. Each preset rewrites the GN palette inputs (Neon 1-4),
// the atmosphere and the grade. ?look=<name> selects one from the URL.
export const LOOKS = {
	'Neon Noir': {
		palette: [[1.0, 0.08, 0.58], [0.0, 0.8, 1.0], [0.55, 0.18, 1.0], [1.0, 0.5, 0.08]],
		atmo: { horizon: [0.075, 0.022, 0.1], glow: [0.45, 0.07, 0.26], fogColor: [0.042, 0.022, 0.075], zenith: [0.004, 0.004, 0.014] },
		post: { shadows: [0.42, 0.3, 0.75], highlights: [1.0, 0.82, 0.9], anaTint: [0.35, 0.55, 1.0], saturation: 1.18 },
	},
	'Replicant Amber': {
		palette: [[1.0, 0.42, 0.06], [1.0, 0.12, 0.08], [0.1, 0.75, 0.8], [1.0, 0.75, 0.4]],
		atmo: { horizon: [0.16, 0.06, 0.02], glow: [0.55, 0.2, 0.05], fogColor: [0.07, 0.03, 0.012], zenith: [0.01, 0.006, 0.006] },
		post: { shadows: [0.25, 0.45, 0.55], highlights: [1.0, 0.78, 0.55], anaTint: [1.0, 0.6, 0.3], saturation: 1.05 },
	},
	'Synthwave': {
		palette: [[1.0, 0.1, 0.75], [0.25, 0.4, 1.0], [0.0, 1.0, 0.85], [1.0, 0.85, 0.1]],
		atmo: { horizon: [0.14, 0.02, 0.16], glow: [0.75, 0.05, 0.5], fogColor: [0.05, 0.01, 0.08], zenith: [0.01, 0.0, 0.03] },
		post: { shadows: [0.35, 0.2, 0.85], highlights: [1.0, 0.75, 0.95], anaTint: [0.8, 0.4, 1.0], saturation: 1.3 },
	},
	'Akira Red': {
		palette: [[1.0, 0.04, 0.06], [1.0, 0.95, 0.9], [0.0, 0.85, 1.0], [1.0, 0.3, 0.1]],
		atmo: { horizon: [0.12, 0.012, 0.02], glow: [0.6, 0.03, 0.05], fogColor: [0.05, 0.008, 0.015], zenith: [0.006, 0.002, 0.004] },
		post: { shadows: [0.3, 0.35, 0.6], highlights: [1.0, 0.85, 0.82], anaTint: [1.0, 0.35, 0.35], saturation: 1.1 },
	},
	'Ghost Shell': {
		palette: [[0.1, 1.0, 0.55], [0.0, 0.7, 1.0], [0.6, 1.0, 0.2], [1.0, 0.2, 0.6]],
		atmo: { horizon: [0.02, 0.07, 0.07], glow: [0.05, 0.35, 0.3], fogColor: [0.012, 0.035, 0.035], zenith: [0.002, 0.008, 0.01] },
		post: { shadows: [0.25, 0.55, 0.55], highlights: [0.85, 1.0, 0.92], anaTint: [0.3, 1.0, 0.8], saturation: 1.1 },
	},
};
