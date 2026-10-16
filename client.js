/**
 * Client half of the Ctrl + Wheel Zoom bundle.
 *
 * CTRL (or ⌘ on macOS) + mouse wheel zooms the whole Web UI around the pointer;
 * CTRL + `+` / `-` / `0` do the same from the keyboard, and a chip pinned at the
 * frame's bottom-right corner reports the level whenever it is not 100% and
 * returns to 100% in one click.
 *
 * Why CSS `zoom` on the document element: it scales layout, text and fixed
 * overlay layers together, exactly like the browser's own page zoom, while the
 * app's own scroll containers keep working. A `transform: scale()` wrapper
 * cannot scroll its oversized content and a font-size change would only touch
 * text, so both were rejected.
 *
 * The wheel listener is registered in the capture phase on `window`: it sees the
 * gesture before the app's scroll containers, and while CTRL is held it always
 * blocks those containers from scrolling. A handler that already called
 * `preventDefault()` (an embedded editor or map with its own CTRL+wheel zoom)
 * wins, because we never steal an already-handled gesture.
 *
 * All zoom state lives in one store instance that both registered surfaces and
 * the apply-world writer share, so the chip, the settings stepper and the wheel
 * listener can never disagree. Everything the plugin registers lives inside
 * `ctx.effect`, so unloading it removes both slot entries, both listeners, the
 * stylesheets and the zoom value it applied.
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-ctrl-wheel-zoom',
	factory(require) {
		const React = require('react');
		const { defineStore } = require('@deepseek-ai/dsh-client-store');
		const h = React.createElement;

		/** This package's id: the module-loader id, also the stylesheet tag owner. */
		const PLUGIN_ID = '@local/dsh-ctrl-wheel-zoom';

		/** Locale namespace and dictionaries (the zh key set is the source of truth). */
		const NS = 'ctrl-wheel-zoom';
		const ZH = {
			'chip.fit': '适合宽度',
			'chip.label': '页面缩放',
			'chip.percent': '{percent}%',
			'chip.reset': '恢复 100%',
			'chip.title': '页面缩放 {percent}%',
			'fit.title': '缩放以适合宽度',
			'reset.title': '恢复 100%',
			'row.decrease': '缩小页面',
			'row.description': '按住 Ctrl 并滚动鼠标滚轮即可缩放整个页面',
			'row.fit': '适合宽度',
			'row.increase': '放大页面',
			'row.reset': '恢复 100%',
			'row.title': '页面缩放',
			'row.unit': '%',
		};
		const EN = {
			'chip.fit': 'Fit to width',
			'chip.label': 'Page zoom',
			'chip.percent': '{percent}%',
			'chip.reset': 'Reset to 100%',
			'chip.title': 'Page zoom {percent}%',
			'fit.title': 'Zoom to fit width',
			'reset.title': 'Reset to 100%',
			'row.decrease': 'Zoom out',
			'row.description': 'Hold Ctrl and roll the mouse wheel to zoom the whole page',
			'row.fit': 'Fit to width',
			'row.increase': 'Zoom in',
			'row.reset': 'Reset to 100%',
			'row.title': 'Page zoom',
			'row.unit': '%',
		};

		/** Zoom bounds and step, in percent. */
		const MIN = 50;
		const MAX = 200;
		const DEFAULT = 100;
		const STEP = 10;
		/** Wheel deltas below this accumulate instead of stepping, so trackpads feel right. */
		const WHEEL_THRESHOLD = 45;
		/** Browser-local zoom memory (display state, not durable profile settings). */
		const STORAGE_KEY = 'dsh.ctrl-wheel-zoom.value';

		/** The document element, or undefined outside a browser. */
		function root() {
			return typeof document === 'undefined' ? undefined : document.documentElement;
		}

		/** Clamp into the zoom range; anything unusable resolves to 100%. */
		function clamp(value) {
			if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT;
			return Math.min(MAX, Math.max(MIN, Math.round(value)));
		}

		/**
		 * Read the remembered zoom. An unreadable or out-of-range entry resolves to
		 * 100%, so corrupted storage can never trap the UI at an unreadable scale.
		 */
		function loadValue() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (raw === null) return DEFAULT;
				const value = Number(raw);
				return Number.isFinite(value) ? clamp(value) : DEFAULT;
			} catch (error) {
				return DEFAULT;
			}
		}

		/** Persist the zoom; storage failures (quota, private mode) only lose memory. */
		function saveValue(value) {
			try {
				window.localStorage.setItem(STORAGE_KEY, String(value));
			} catch (error) {
				/* best effort: the zoom still applies for this page */
			}
		}

		/**
		 * Apply a level to the document. 100% removes the property entirely, which
		 * restores the untouched layout instead of pinning `zoom: 1`.
		 */
		function applyZoom(value) {
			const element = root();
			if (element === undefined) return;
			if (value === DEFAULT) element.style.removeProperty('zoom');
			else element.style.setProperty('zoom', String(value / 100));
		}

		/**
		 * Re-anchor the viewport so the content the pointer rested on stays under the
		 * pointer. Only an already-scrolling viewport is corrected: inside an app
		 * whose columns scroll themselves this is a no-op, so zooming never moves
		 * content the user did not point at.
		 */
		function keepAnchor(element, clientX, clientY, beforeZoom, afterZoom) {
			const top = element.scrollTop;
			const left = element.scrollLeft;
			if (top === 0 && left === 0) return;
			const ratio = afterZoom / beforeZoom;
			element.scrollTop = (top + clientY) * ratio - clientY;
			element.scrollLeft = (left + clientX) * ratio - clientX;
		}

		/**
		 * Chip styles: one floating pill anchored to the frame's bottom-right corner
		 * through a fixed wrapper, which stays correct whatever containing block the
		 * overlay layer establishes. Host tokens only.
		 */
		const CHIP_CSS = `
.dshZoomChip_anchor{position:fixed;right:16px;bottom:16px;z-index:4}
.dshZoomChip_root{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;padding:4px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.dshZoomChip_button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:24px;min-width:44px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;font:inherit;font-size:12px;line-height:16px;font-variant-numeric:tabular-nums;cursor:pointer}
.dshZoomChip_button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshZoomChip_button:focus-visible{outline-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-width:var(--dsw-focus-ring-width)}
.dshZoomChip_value{font-weight:500}
.dshZoomChip_divider{width:.5px;height:16px;background:var(--dsw-alias-border-l3)}
`;

		/** General-row styles: the Appearance section's row and stepper geometry. */
		const ROW_CSS = `
.dshZoomRow_row{box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dshZoomRow_rowText{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}
.dshZoomRow_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.dshZoomRow_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.dshZoomRow_control{display:inline-flex;align-items:center;gap:8px}
.dshZoomRow_stepper{box-sizing:border-box;display:inline-flex;position:relative;align-items:center;justify-content:center;min-width:72px;height:36px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform)}
.dshZoomRow_value{min-width:18px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;font-variant-numeric:tabular-nums;text-align:center}
.dshZoomRow_unit{color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.dshZoomRow_arrows{display:flex;position:absolute;right:8px;flex-direction:column;gap:2px;opacity:0}
.dshZoomRow_stepper:hover .dshZoomRow_arrows,.dshZoomRow_stepper:focus-within .dshZoomRow_arrows{opacity:1}
.dshZoomRow_arrow{display:inline-flex;align-items:center;justify-content:center;width:17px;height:12px;padding:0;border:none;border-radius:var(--dsw-radius-xs);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 75%, transparent);color:var(--dsw-alias-label-primary);cursor:pointer}
.dshZoomRow_arrow:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.dshZoomRow_arrow:disabled{color:var(--dsw-alias-label-caption);cursor:default}
.dshZoomRow_arrow:focus-visible{outline-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-width:var(--dsw-focus-ring-width)}
.dshZoomRow_fit{height:36px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dshZoomRow_fit:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshZoomRow_fit:focus-visible{outline-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-width:var(--dsw-focus-ring-width)}
`;

		/**
		 * The zoom chip (`shell.overlay`). It renders only while the level is not
		 * 100%, which keeps the frame untouched in the default state; clicking the
		 * percentage returns to 100%.
		 */
		function ZoomChip({ actions, t, useStore }) {
			const zoom = useStore((state) => state.zoom);
			if (zoom === DEFAULT) return null;
			return h(
				'div',
				{ className: 'dshZoomChip_anchor' },
				h(
					'div',
					{ className: 'dshZoomChip_root', role: 'group', 'aria-label': t('chip.label') },
					h(
						'button',
						{
							type: 'button',
							className: 'dshZoomChip_button',
							title: t('chip.title', { percent: zoom }),
							onClick: actions.reset,
						},
						h('span', { className: 'dshZoomChip_value' }, t('chip.percent', { percent: zoom })),
					),
					h('span', { className: 'dshZoomChip_divider', 'aria-hidden': true }),
					h(
						'button',
						{
							type: 'button',
							className: 'dshZoomChip_button',
							title: t('fit.title'),
							onClick: actions.fit,
						},
						t('chip.fit'),
					),
				),
			);
		}

		/**
		 * Stepper glyphs. The host's chevron geometry, drawn locally: a plugin must
		 * not load a Client package such as ui-primitives as a module.
		 */
		function Chevron({ direction }) {
			const up = direction === 'up';
			return h(
				'svg',
				{
					width: 9,
					height: 9,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true,
				},
				h('path', { d: up ? 'M4 10L8 6L12 10' : 'M4 6L8 10L12 6' }),
			);
		}

		/**
		 * The General settings row: the Appearance section's stepper pattern, for
		 * users who never discover the wheel gesture.
		 */
		function ZoomRow({ t, setZoom, useStore }) {
			const zoom = useStore((state) => state.zoom);
			return h(
				'div',
				{ className: 'dshZoomRow_row' },
				h(
					'div',
					{ className: 'dshZoomRow_rowText' },
					h('div', { className: 'dshZoomRow_title' }, t('row.title')),
					h('div', { className: 'dshZoomRow_desc' }, t('row.description')),
				),
				h(
					'div',
					{ className: 'dshZoomRow_control' },
					h(
						'div',
						{ className: 'dshZoomRow_stepper' },
						h('span', { className: 'dshZoomRow_value' }, zoom),
						h(
							'span',
							{ className: 'dshZoomRow_arrows' },
							h(
								'button',
								{
									type: 'button',
									className: 'dshZoomRow_arrow',
									'aria-label': t('row.increase'),
									disabled: zoom >= MAX,
									onClick: () => {
										setZoom(zoom + STEP);
									},
								},
								h(Chevron, { direction: 'up' }),
							),
							h(
								'button',
								{
									type: 'button',
									className: 'dshZoomRow_arrow',
									'aria-label': t('row.decrease'),
									disabled: zoom <= MIN,
									onClick: () => {
										setZoom(zoom - STEP);
									},
								},
								h(Chevron, { direction: 'down' }),
							),
						),
					),
					h('span', { className: 'dshZoomRow_unit' }, t('row.unit')),
					h(
						'button',
						{
							type: 'button',
							className: 'dshZoomRow_fit',
							title: t('fit.title'),
							onClick: () => {
								setZoom(DEFAULT);
							},
						},
						t('row.reset'),
					),
				),
			);
		}

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				const element = root();
				if (element === undefined) return;

				ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'ctrl-wheel-zoom: locale dictionaries');

				/**
				 * Mount one plugin-owned global stylesheet for exactly the owning plugin
				 * lifetime. An installed client bundle has NO `styles` builtin — that symbol
				 * belongs to the dynamic package runner — so the tag is created here and
				 * removed by the same effect's cleanup, the pattern ui-theme uses for its own
				 * sheets. Getting this wrong throws inside `apply`, which the Web boot
				 * reports as a failed entry and refuses to mount the application.
				 *
				 * @param name - stylesheet name, used for the tag's `data-plugin-css`
				 * @param css - raw CSS text
				 */
				function installStyle(name, css) {
					return ctx.effect(() => {
						const tag = document.createElement('style');
						tag.dataset.plugin = PLUGIN_ID;
						tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`;
						tag.textContent = css;
						document.head.appendChild(tag);
						return () => {
							tag.remove();
						};
					}, `ctrl-wheel-zoom: ${name} stylesheet`);
				}

				installStyle('chip.css', CHIP_CSS);
				installStyle('row.css', ROW_CSS);

				/**
				 * The store handle plus the one root instance every surface reads: the
				 * renderer keys resolved instances per handle and per registration, so the
				 * first registration publishes the instance this writer also mutates and
				 * both entries thereafter share it. Zoom can therefore never be reported
				 * twice with two different values.
				 */
				const store = defineStore({
					init: () => ({ zoom: loadValue() }),
					actions: {
						set: (draft, value) => {
							draft.zoom = clamp(value);
						},
					},
				});
				const instance = store.create();

				const current = () => instance.getSnapshot().zoom;

				/* Restore the remembered level before any surface mounts. */
				applyZoom(current());

				let pendingWheel = 0;
				let lastWheelAt = 0;
				let selfScrollAt = 0;

				/**
				 * The single write path: re-anchor for a pointer gesture, remember the
				 * level, publish it, then apply it to the document.
				 *
				 * @param value - requested level in percent
				 * @param anchor - pointer position for a wheel gesture; omit for keyboard
				 * @returns the effective level
				 */
				function setZoom(value, anchor) {
					const before = current();
					const next = clamp(value);
					if (next !== before) {
						if (anchor !== undefined) keepAnchor(element, anchor.x, anchor.y, before, next);
						saveValue(next);
						instance.actions.set(next);
					}
					applyZoom(next);
					return next;
				}

				/** The level at which the layout exactly fills the window width. */
				function fitValue() {
					const width = element.clientWidth;
					const scrollWidth = element.scrollWidth;
					if (!width || !scrollWidth) return DEFAULT;
					return clamp((width / scrollWidth) * 100);
				}

				/** One wheel notch, in the gesture's direction, anchored at the pointer. */
				function onWheel(event) {
					if (!event.ctrlKey && !event.metaKey) return;
					if (event.defaultPrevented) return;
					if (event.timeStamp - selfScrollAt < 50) return;
					event.preventDefault();
					if (event.timeStamp - lastWheelAt < 20) return;
					lastWheelAt = event.timeStamp;
					pendingWheel += event.deltaY;
					if (Math.abs(pendingWheel) < WHEEL_THRESHOLD) return;
					const direction = pendingWheel < 0 ? 1 : -1;
					pendingWheel = 0;
					setZoom(current() + direction * STEP, { x: event.clientX, y: event.clientY });
				}

				/** CTRL/⌘ + `+`, `-`, `0`: keyboard parity with the wheel gesture. */
				function onKeydown(event) {
					if (event.defaultPrevented || event.isComposing) return;
					if (!event.ctrlKey && !event.metaKey) return;
					if (event.altKey) return;
					const key = event.key;
					let wanted;
					if (key === '0' || key === ')') wanted = DEFAULT;
					else if (key === '=' || key === '+') wanted = current() + STEP;
					else if (key === '-' || key === '_') wanted = current() - STEP;
					else return;
					/* Swallow the chord even at a bound, so the page's own zoom never drifts from ours. */
					event.preventDefault();
					if (clamp(wanted) !== current()) setZoom(wanted);
					pendingWheel = 0;
				}

				/** A scroll right after a zoom is our own correction, never a user gesture. */
				function onScroll() {
					selfScrollAt = performance.now();
				}

				ctx.effect(() => {
					window.addEventListener('wheel', onWheel, { capture: true, passive: false });
					window.addEventListener('keydown', onKeydown, true);
					element.addEventListener('scroll', onScroll, { passive: true });
					applyZoom(current());
					return () => {
						window.removeEventListener('wheel', onWheel, { capture: true });
						window.removeEventListener('keydown', onKeydown, true);
						element.removeEventListener('scroll', onScroll);
						element.style.removeProperty('zoom');
					};
				}, 'ctrl-wheel-zoom: gestures');

				/* Service registration goes through an effect: nothing in `apply` itself may throw. */
				ctx.effect(() => ctx.provide('ctrlWheelZoom', {
					getZoom: current,
					setZoom: (value) => setZoom(value),
					stepZoom: (direction) => setZoom(current() + direction * STEP),
					resetZoom: () => setZoom(DEFAULT),
					fitToWidth: () => setZoom(fitValue()),
					store,
				}), 'ctrl-wheel-zoom: service');

				ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
					name: 'shell.overlay',
					id: 'ctrl-wheel-zoom-chip',
					order: 60,
					store: instance,
					locale: NS,
					inject: () => ({
						actions: {
							reset: () => setZoom(DEFAULT),
							fit: () => setZoom(fitValue()),
						},
					}),
				}, ZoomChip)), 'ctrl-wheel-zoom: zoom chip');

				ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
					name: 'settings.general.item',
					id: 'ctrl-wheel-zoom',
					order: 12,
					store: instance,
					locale: NS,
					inject: () => ({ setZoom: (value) => setZoom(value) }),
				}, ZoomRow)), 'ctrl-wheel-zoom: settings row');
			},
		};
	},
});
