// lib/client.js を happy-dom 上で読み込み、DSH の ModuleLoader / ctx を最小限で偽装する試験用ハーネス。
// 方式の比較は docs/adr/20261024-0410-dsh-mobile-ui-test-harness.md を参照（ADR-20261024-0410）。
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

// DSH_MOBILE_UI_CLIENT: 変異テスト（壊した版で赤になるかの確認）用に読込元を差し替える。
const source = readFileSync(process.env.DSH_MOBILE_UI_CLIENT ?? new URL("../lib/client.js", import.meta.url), "utf8");

/**
 * DSH AppFrame の DOM 形（frame > sidebarCol, centerCol, rightbarCol）を再現する。
 * 実物は 0.2.0-rc.2 の ui-layout AppFrame（docs/spec.md §3）。
 */
const FRAME_HTML = `<div id="root"><div id="frame" data-sidebar-collapsed>
<div id="side"><button id="side-btn">s</button></div>
<div id="center"><p id="msg">hello</p><div id="hscroll" style="overflow-x:auto;width:100px"><div style="width:400px">wide</div></div><textarea id="ta"></textarea></div>
<div data-rightbar-col id="right"></div>
<div data-side="sidebar" id="handle"></div>
</div></div>`;

/**
 * @param {object} opt
 * @param {number} [opt.width=390] innerWidth
 * @param {boolean} [opt.coarse=true] (pointer:coarse) の真偽
 * @param {boolean} [opt.withFrame=true] AppFrame を描画するか
 * @param {boolean} [opt.reducedMotion=false] prefers-reduced-motion:reduce を CSS の media で一致させるか
 */
export function mount({ width = 390, height = 800, coarse = true, withFrame = true, reducedMotion = false, viewport = "width=device-width, initial-scale=1", scale = 1, displayMode = "browser", standalone = undefined, screenSize = null, safeInsets = null, storage = {}, terminal = false, rightExpanded = false } = {}) {
	// prefers-reduced-motion は happy-dom の device 設定で CSS のカスケードに反映される（20.14.6 で確認）。
	const window = new Window({ width, height, url: "http://localhost/", settings: { device: { prefersReducedMotion: reducedMotion ? "reduce" : "no-preference" } } });
	const document = window.document;
	// viewport: 起動前の meta content（既定は DSH 0.2.0-rc.2 の dist/index.html と同じ値）。null なら content 属性なし。
	const metaAttr = viewport === null ? "" : ` content="${viewport}"`;
	document.write(`<!doctype html><html><head><meta name="viewport"${metaAttr}></head><body>${withFrame ? FRAME_HTML : '<div id="root"></div>'}</body></html>`);
	// terminal: 右パネルの sidebar-terminal（0.2.0-rc.2）が描く xterm 6.0 の DOM の要点を rightbarCol に置く。
	if (terminal && withFrame) {
		document.getElementById("right").innerHTML = `<section data-sidebar-terminal><div class="screen"><div class="terminal xterm" id="xterm">
<div class="xterm-scrollable-element" id="xscroll"><div class="xterm-screen" id="xscreen"><div class="xterm-helpers"><textarea class="xterm-helper-textarea" id="xinput"></textarea></div><div class="xterm-rows" id="xrows">$</div></div></div>
</div></div></section>`;
	}

	if (rightExpanded && withFrame) document.getElementById("right").setAttribute("data-sidebar-right-open", "");

	// happy-dom の matchMedia は pointer・display-mode を評価しないため、幅・coarse・表示モードを明示的に解く置換を入れる。
	// カンマ区切り（OR）は各項を解いて論理和を取る。
	const media = new Map();
	const state = { width, coarse, displayMode };
	const evaluateOne = (q) => {
		const max = /max-width:\s*(\d+)px/.exec(q);
		if (max && !(state.width <= Number(max[1]))) return false;
		if (q.includes("pointer:coarse") && !state.coarse) return false;
		const mode = /display-mode:\s*([a-z-]+)/.exec(q);
		if (mode && mode[1] !== state.displayMode) return false;
		return true;
	};
	const evaluate = (q) => q.split(",").some(evaluateOne);
	// iOS 固有の値（navigator.standalone、screen の寸法）と localStorage の偽装。
	if (standalone !== undefined) Object.defineProperty(window.navigator, "standalone", { value: standalone, configurable: true });
	if (screenSize !== null) Object.defineProperty(window, "screen", { value: { width: screenSize[0], height: screenSize[1] }, configurable: true });
	for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
	// env(safe-area-inset-*) は happy-dom では解けないので、probe 要素の computed padding を差し替える。
	const realGetComputedStyle = window.getComputedStyle.bind(window);
	const insets = { top: 0, right: 0, bottom: 0, left: 0, ...(safeInsets ?? {}) };
	const getComputedStyleStub = (el, ...rest) => {
		const style = realGetComputedStyle(el, ...rest);
		if (safeInsets === null || !el.hasAttribute?.("data-dsh-mobile-safe-probe")) return style;
		// padding 以外（position 等）は実物のまま返す。
		const getPropertyValue = (name) => { const m = /^padding-(top|right|bottom|left)$/.exec(name); return m ? `${insets[m[1]]}px` : style.getPropertyValue(name); };
		return new Proxy(style, { get: (target, key) => (key === "getPropertyValue" ? getPropertyValue : Reflect.get(target, key)) });
	};
	window.matchMedia = (q) => {
		if (!media.has(q)) {
			const listeners = new Set();
			media.set(q, {
				get matches() { return evaluate(q); },
				media: q,
				addEventListener: (_t, f) => listeners.add(f),
				removeEventListener: (_t, f) => listeners.delete(f),
				listeners
			});
		}
		return media.get(q);
	};
	// 実ブラウザと同じく、matches が実際に変わった media だけに change を通知する。
	const setViewport = (next) => {
		const before = new Map([...media].map(([q, m]) => [q, m.matches]));
		Object.assign(state, next);
		if (next.width !== undefined) window.happyDOM.setViewport({ width: next.width });
		for (const [q, m] of media) if (m.matches !== before.get(q)) for (const f of m.listeners) f({ matches: m.matches });
	};

	// visualViewport は happy-dom に無いので、resize を発火できる簡易版を置く。
	const vvTarget = new window.EventTarget();
	// scale はピンチズームの倍率（KI-2）。
	const visualViewport = Object.assign(vvTarget, { height, offsetTop: 0, scale });
	window.visualViewport = visualViewport;

	// プラグイン適用前に window の resize を数える（KI-10: 起動時に送らないことの検査に要る）。
	let windowResizes = 0;
	window.addEventListener("resize", () => { windowResizes++; });

	// 公開サービスの偽装: toggleSidebar は AppFrame の data-sidebar-collapsed を反転する
	// （<1024px の narrowExpanded 反転に相当）。呼出回数も記録する。
	const calls = { toggleSidebar: 0, toggleExpanded: 0 };

	const ctx = {
		layout: {
			toggleSidebar() {
				calls.toggleSidebar++;
				const frame = document.getElementById("frame");
				if (frame === null) return;
				if (frame.hasAttribute("data-sidebar-collapsed")) frame.removeAttribute("data-sidebar-collapsed");
				else frame.setAttribute("data-sidebar-collapsed", "");
			}
		},
		sidebarRight: {
			isExpanded: () => rightExpanded,
			toggleExpanded() { calls.toggleExpanded++; rightExpanded = !rightExpanded; }
		},
		effects: [],
		effect(fn) { this.effects.push(fn()); }
	};

	let plugin = null;
	window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(() => { throw new Error("require unused"); }); } };
	// client.js は window のグローバル名を素で参照するため、必要なものを引数として束縛して評価する。
	const globals = ["window", "document", "getComputedStyle", "MutationObserver", "Node", "Element"];
	new Function(...globals, source)(window, document, getComputedStyleStub, window.MutationObserver, window.Node, window.Element);
	plugin.apply(ctx);

	const flush = () => new Promise((r) => setTimeout(r, 0));
	const dispose = () => { for (const d of ctx.effects.splice(0)) d?.(); };
	return {
		window, document, ctx, calls, flush, dispose, setViewport, visualViewport,
		resizeCount: () => windowResizes,
		setRightExpanded: (v) => { rightExpanded = v; },
		/** 右パネルの展開を、DSH と同じく DOM 属性の変化（data-sidebar-right-open）つきで切り替える。 */
		setRightPanel: (v) => {
			rightExpanded = v;
			const right = document.getElementById("right");
			if (v) right?.setAttribute("data-sidebar-right-open", "");
			else right?.removeAttribute("data-sidebar-right-open");
		},
		setInsets: (next) => { Object.assign(insets, next); },
		// DSH の Modal 相当（createPortal(..., document.body) される全画面の前面レイヤ）を body 直下に足し、
		// その中の要素（タッチの起点）を返す。
		addPortal: () => {
			const layer = document.createElement("div");
			layer.setAttribute("role", "dialog");
			layer.setAttribute("aria-modal", "true");
			layer.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;";
			layer.innerHTML = "<p>modal</p>";
			document.body.append(layer);
			return layer.firstElementChild;
		},
		el: (id) => document.getElementById(id),
		close: () => { dispose(); window.happyDOM.close(); }
	};
}

/** 単指の touchstart を target から発火する。終了は返り値の end(to) で発火する（途中に操作を挟む検査用）。 */
export function touchStart(h, target, from) {
	const { window } = h;
	const mk = (x, y) => new window.Touch({ identifier: 1, target, clientX: x, clientY: y });
	const start = mk(from[0], from[1]);
	target.dispatchEvent(new window.TouchEvent("touchstart", { bubbles: true, touches: [start], changedTouches: [start] }));
	return {
		end(to) {
			const end = mk(to[0], to[1]);
			target.dispatchEvent(new window.TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [end] }));
		}
	};
}

/** 単指の touchstart → touchend を target から発火する。 */
export function swipe(h, target, from, to) {
	touchStart(h, target, from).end(to);
}
