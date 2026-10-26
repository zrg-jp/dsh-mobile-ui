// docs/spec.md §5.3 `TerminalInputReachesOnce`（T311 / KI-12、ADR-20261027-0020）を、本物の xterm.js 6.0.0 で検査する。
// xterm は devDependency の @xterm/xterm@6.0.0（MIT。DSH sidebar-terminal 0.2.0-rc.2 が同梱する版と入力処理が同じことを
// 空白・括弧の差を除いて照合した）。本プラグインと同じ happy-dom のページで Terminal を開き、onData に届いた列を数える。
// iOS のイベント列は実機で記録できないので、xterm.js issue #5835 の記録（keydown 229 → beforeinput → input(composed) → keyup、
// input は keydown から約 10ms 後）を合成する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mount } from "./harness.mjs";

const require = createRequire(import.meta.url);
const XTERM_PATH = require.resolve("@xterm/xterm");

/** 本物の xterm 6.0.0 を happy-dom の window で評価する（UMD を window のグローバルで包んで実行）。 */
function loadXterm(w) {
	const { readFileSync } = require("node:fs");
	const source = readFileSync(XTERM_PATH, "utf8");
	// xterm は matchMedia の結果に addListener を使う（旧 API）。ハーネスの置換は addEventListener しか持たないので補う。
	const mm = w.matchMedia;
	w.matchMedia = (q) => {
		const m = mm(q);
		m.addListener ??= () => {};
		m.removeListener ??= () => {};
		return m;
	};
	w.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
	w.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };
	const module = { exports: {} };
	// UMD は globalThis・window・self・document を素で参照する。
	new Function("module", "exports", "globalThis", "window", "self", "document", "navigator", source)(module, module.exports, w, w, w, w.document, w.navigator);
	return module.exports;
}

/**
 * 右パネルのターミナルを模した DOM に xterm を開く。
 * @returns {{ h, term, ta, sent: string[], wait: (ms?: number) => Promise<void>, close: () => void }}
 */
function openTerminal({ coarse = true, plugin = true } = {}) {
	const h = mount({ coarse, withFrame: true });
	if (!plugin) h.dispose();
	const w = h.window;
	const { Terminal } = loadXterm(w);
	h.el("right").innerHTML = `<section data-sidebar-terminal><div id="screen" style="width:300px;height:200px"></div></section>`;
	const term = new Terminal({});
	term.open(h.el("screen"));
	const sent = [];
	term.onData((d) => sent.push(d));
	const ta = h.document.querySelector("[data-sidebar-terminal] textarea.xterm-helper-textarea");
	ta.focus();
	const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
	return { h, term, ta, sent, wait, close: () => { term.dispose(); h.close(); } };
}

/** keyCode / which を持つ KeyboardEvent（happy-dom は init の keyCode を反映しない）。 */
function key(w, type, init, keyCode) {
	const e = new w.KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
	Object.defineProperty(e, "keyCode", { get: () => keyCode });
	Object.defineProperty(e, "which", { get: () => keyCode });
	return e;
}

/** UA が出す input（composed:true）と同じ形で、textarea の値をカーソル位置に挿入してから input を送る。 */
function uaInsert(w, ta, data, inputType = "insertText", extra = {}, { beforeinput = true } = {}) {
	if (beforeinput) ta.dispatchEvent(new w.InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, data, inputType, ...extra }));
	if (inputType === "deleteContentBackward") {
		const end = ta.selectionEnd;
		ta.value = ta.value.slice(0, end - 1) + ta.value.slice(end);
		ta.setSelectionRange(end - 1, end - 1);
	} else {
		// 選択範囲を data で置き換える（実ブラウザと同じ）。
		const start = ta.selectionStart ?? ta.value.length;
		const end = ta.selectionEnd ?? ta.value.length;
		ta.value = ta.value.slice(0, start) + data + ta.value.slice(end);
		ta.setSelectionRange(start + data.length, start + data.length);
	}
	ta.dispatchEvent(new w.InputEvent("input", { bubbles: true, composed: true, data: inputType === "deleteContentBackward" ? null : data, inputType, ...extra }));
}

/**
 * キーボードの物理キー（または入力メソッドを通らないソフトキー）の 1 打鍵。UA と同じく、keydown が preventDefault されたら
 * keypress と挿入（beforeinput / input）を出さない。
 */
function physicalKey(t, ch, keyCode, mods = {}) {
	const w = t.h.window;
	const down = key(w, "keydown", { key: ch, ...mods }, keyCode);
	t.ta.dispatchEvent(down);
	if (!down.defaultPrevented) {
		const press = key(w, "keypress", { key: ch, ...mods }, ch.charCodeAt(0));
		Object.defineProperty(press, "charCode", { get: () => ch.charCodeAt(0) });
		t.ta.dispatchEvent(press);
		if (!press.defaultPrevented) uaInsert(w, t.ta, ch);
	}
	t.ta.dispatchEvent(key(w, "keyup", { key: ch, ...mods }, keyCode));
}

/**
 * iOS（Gboard・IME）の 1 打鍵: keydown(229) → [約 10ms 後] beforeinput/input(insertText, composed) → keyup(keyUpCode)。
 * xterm の差分検出（keydown で予約される setTimeout(0)）は input より先に走る（issue #5835 の時刻差）。
 */
async function iosKey(t, data, { keyUpCode = 0, keyName = "Unidentified" } = {}) {
	const w = t.h.window;
	t.ta.dispatchEvent(key(w, "keydown", { key: keyName }, 229));
	await t.wait(10);
	uaInsert(w, t.ta, data);
	t.ta.dispatchEvent(key(w, "keyup", { key: keyName }, keyUpCode));
	await t.wait(5);
}

test("[§5.3 TerminalInputReachesOnce] iOS の keyCode 229 → input(composed) の英字・数字・空白が onData に 1 回ずつ届く（KI-12）", async () => {
	const t = openTerminal();
	try {
		for (const ch of ["l", "s", " ", "-", "a", "1"]) await iosKey(t, ch, { keyName: ch, keyUpCode: ch === " " ? 32 : 0 });
		await t.wait(5);
		assert.deepEqual(t.sent, ["l", "s", " ", "-", "a", "1"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 入力が keydown より先に値へ入っていた場合（差分検出が拾う列）も 1 回だけ届く", async () => {
	// iOS の時刻差が小さく、xterm の差分検出（setTimeout(0)）が input の後に走る場合。差分検出が送るので、
	// 送り直しと重なれば二重になる。本プラグインは送り直す前に textarea の値から data を戻す。
	const t = openTerminal();
	const w = t.h.window;
	try {
		for (const ch of ["x", "y"]) {
			t.ta.dispatchEvent(key(w, "keydown", { key: ch }, 229));
			uaInsert(w, t.ta, ch);
			t.ta.dispatchEvent(key(w, "keyup", { key: ch }, 0));
			await t.wait(5);
		}
		assert.deepEqual(t.sent, ["x", "y"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] Enter（keyCode 13）と Backspace（keyCode 8）は xterm の keydown 経路のまま 1 回", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		await iosKey(t, "a", { keyName: "a" });
		t.ta.dispatchEvent(key(w, "keydown", { key: "Enter" }, 13));
		t.ta.dispatchEvent(key(w, "keyup", { key: "Enter" }, 13));
		t.ta.dispatchEvent(key(w, "keydown", { key: "Backspace" }, 8));
		t.ta.dispatchEvent(key(w, "keyup", { key: "Backspace" }, 8));
		await t.wait(5);
		assert.deepEqual(t.sent, ["a", "\r", "\x7f"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] iOS 中国語 IME の空白 2 回 → 。（削除して挿入）は 。だけを送り、textarea 全体を送らない", async () => {
	// issue #5835 の Special case: keydown(229) → input(deleteContentBackward) → input(insertText "。") → keyup。
	const t = openTerminal();
	const w = t.h.window;
	try {
		await iosKey(t, " ", { keyName: " ", keyUpCode: 32 });
		t.ta.dispatchEvent(key(w, "keydown", { key: " " }, 229));
		await t.wait(10);
		uaInsert(w, t.ta, null, "deleteContentBackward");
		uaInsert(w, t.ta, "。");
		t.ta.dispatchEvent(key(w, "keyup", { key: " " }, 32));
		await t.wait(5);
		// 削除（deleteContentBackward）は xterm に任せる（差分検出は値の比較なので、この時刻差では何も送らない）。
		assert.deepEqual(t.sent, [" ", "。"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 日本語の変換確定（composition）は CompositionHelper が 1 回だけ送る", async () => {
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	try {
		t.ta.dispatchEvent(key(w, "keydown", { key: "k" }, 229));
		comp("compositionstart", "");
		uaInsert(w, t.ta, "k", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "k");
		t.ta.dispatchEvent(key(w, "keyup", { key: "k" }, 0));
		await t.wait(5);
		t.ta.dispatchEvent(key(w, "keydown", { key: "a" }, 229));
		t.ta.value = t.ta.value.slice(0, -1);
		uaInsert(w, t.ta, "か", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "か");
		t.ta.dispatchEvent(key(w, "keyup", { key: "a" }, 0));
		await t.wait(5);
		// 確定。Safari は compositionend の後に insertText（isComposing:false）を出すことがある（PR #5614 の絵文字の例）。
		comp("compositionend", "か");
		t.ta.dispatchEvent(new w.InputEvent("input", { bubbles: true, composed: true, data: "か", inputType: "insertText" }));
		await t.wait(10);
		assert.deepEqual(t.sent, ["か"]);
		// 確定後の次の打鍵は通常どおり届く。
		await iosKey(t, "b", { keyName: "b" });
		assert.deepEqual(t.sent, ["か", "b"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] デスクトップ（fine pointer）の keydown → keypress → input は 1 回（介入しない）", async () => {
	const t = openTerminal({ coarse: false });
	const w = t.h.window;
	try {
		// Chrome / Safari デスクトップの英字: keydown(65) で xterm が送って preventDefault し、UA は keypress と挿入を出さない。
		physicalKey(t, "a", 65);
		// 修飾キーとの組合せ等で xterm が keydown で送らない場合（keypress → input の経路）も 1 回。
		const w2 = t.h.window;
		const down = key(w2, "keydown", { key: "é" }, 0);
		t.ta.dispatchEvent(down);
		assert.equal(down.defaultPrevented, false);
		const press = key(w2, "keypress", { key: "é" }, 233);
		Object.defineProperty(press, "charCode", { get: () => 233 });
		t.ta.dispatchEvent(press);
		if (!press.defaultPrevented) uaInsert(w2, t.ta, "é");
		t.ta.dispatchEvent(key(w2, "keyup", { key: "é" }, 0));
		await t.wait(5);
		assert.deepEqual(t.sent, ["a", "é"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] COARSE でも keydown が文字を送った打鍵（標準キーボードの keyCode 65）は二重にならない", async () => {
	// iOS 標準キーボードの英字（入力メソッドを通らない場合）: keydown(65, key "a") → keypress → input → keyup。
	const t = openTerminal();
	const w = t.h.window;
	try {
		physicalKey(t, "a", 65);
		physicalKey(t, "B", 66, { shiftKey: true });
		// keydown の preventDefault を無視して挿入を出す UA を仮定しても、keyCode 229 でなければ値は戻さず、
		// 送り直しは xterm の _keyPressHandled / 自身の判定に従う（ここでは keypress が無いので 1 回送られる）。
		void w;
		await t.wait(5);
		assert.deepEqual(t.sent, ["a", "B"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] プラグイン無しの同じ列では文字が落ちる（再現の確認）", async () => {
	// 修正の前提（xterm 6.0.0 が捨てる列であること）を固定する。xterm が直れば赤になり、本プラグインの介入を見直す合図になる。
	const t = openTerminal({ plugin: false });
	try {
		for (const ch of ["l", "s"]) await iosKey(t, ch, { keyName: ch });
		await t.wait(5);
		assert.deepEqual(t.sent, []);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] readOnly（disableStdin）と dispose 後は送らない", async () => {
	const t = openTerminal();
	try {
		t.term.options.disableStdin = true;
		await iosKey(t, "r", { keyName: "r" });
		t.term.options.disableStdin = false;
		t.h.dispose();
		await iosKey(t, "d", { keyName: "d" });
		assert.deepEqual(t.sent, []);
	} finally {
		t.close();
	}
});

/** window の bubble 段階まで元の input が届いたか（本プラグインが止めていないか）を記録する。 */
function watchInputs(t) {
	const seen = [];
	t.h.window.addEventListener("input", (e) => { if (e.target === t.ta) seen.push(`${e.inputType}:${e.data}:${e.composed}`); });
	return seen;
}

test("[§5.3 TerminalInputReachesOnce] 介入しない入力（fine pointer・readOnly・insertText 以外）は元の input をそのまま通す", async () => {
	const desktop = openTerminal({ coarse: false });
	try {
		const seen = watchInputs(desktop);
		await iosKey(desktop, "q", { keyName: "q" });
		// fine pointer では止めない（composed:true の元の input が window まで届く）。
		assert.deepEqual(seen, ["insertText:q:true"]);
	} finally {
		desktop.close();
	}
	const t = openTerminal();
	const w = t.h.window;
	try {
		const seen = watchInputs(t);
		t.term.options.disableStdin = true;
		uaInsert(w, t.ta, "r");
		t.term.options.disableStdin = false;
		// 自動修正の置換など insertText 以外の挿入は xterm に任せる（xterm は捨てる）。
		uaInsert(w, t.ta, "z", "insertReplacementText");
		await t.wait(5);
		assert.deepEqual(seen, ["insertText:r:true", "insertReplacementText:z:true"]);
		assert.deepEqual(t.sent, []);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 変換中に isComposing:false の insertText が来ても送らない（確定文字だけ）", async () => {
	// iOS は変換中にも insertText（isComposing:false）を出しうる（gadzan/xacpx PR #318 の e2e の記録）。
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	try {
		comp("compositionstart", "");
		t.ta.dispatchEvent(key(w, "keydown", { key: "Unidentified" }, 229));
		uaInsert(w, t.ta, "nihao");
		comp("compositionupdate", "nihao");
		t.ta.dispatchEvent(key(w, "keyup", { key: "o" }, 0));
		await t.wait(5);
		assert.deepEqual(t.sent, []);
		t.ta.value = t.ta.value.slice(0, -"nihao".length) + "你好";
		comp("compositionend", "你好");
		await t.wait(10);
		assert.deepEqual(t.sent, ["你好"]);
	} finally {
		t.close();
	}
});

// DSH が同梱する xterm と、このテストが使う npm の @xterm/xterm@6.0.0 の入力処理が同じことを照合する。
// 配布物は DSH の導入先にしか無いので、見つからなければ skip する（CI では skip）。場所は環境変数で差し替えられる。
// 既定は pnpm のグローバル導入先（macOS: ~/Library/pnpm/global）から 0.2.0-rc.2 を探す。
const { existsSync, readFileSync, globSync } = await import("node:fs");
const { homedir } = await import("node:os");
const BUNDLE = process.env.DSH_SIDEBAR_TERMINAL_JS ??
	globSync("Library/pnpm/global/*/*/node_modules/.pnpm/@deepseek-ai+dsh-client-ui-sidebar-terminal@0.2.0-rc.2*/node_modules/@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.terminal.js", { cwd: homedir() })
		.map((rel) => `${homedir()}/${rel}`)[0] ?? "";
test("[§5.3 TerminalInputReachesOnce] DSH 同梱の xterm と npm の 6.0.0 で入力処理が同じ（配布物がある環境のみ）", { skip: existsSync(BUNDLE) ? false : "DSH の配布物が無い" }, () => {
	// 空白・末尾のセミコロン・アロー関数の引数の括弧だけを正規化して比べる（バンドラの整形差）。
	const norm = (s) => s.replace(/\s+/g, "").replace(/;}/g, "}").replace(/\(\(([\w,]*)\)=>/g, "($1=>");
	const bundle = norm(readFileSync(BUNDLE, "utf8"));
	const npm = norm(readFileSync(XTERM_PATH, "utf8"));
	const take = (s, start, end) => {
		const i = s.indexOf(start);
		assert.ok(i >= 0, `${start} が見つからない`);
		return s.slice(i, s.indexOf(end, i));
	};
	for (const [start, end] of [["_keyDown(e){", "_isThirdLevelShift(e,t){"], ["_keyUp(e){", "_keyPress(e){"], ["_keyPress(e){", "_inputEvent(e){"], ["_inputEvent(e){", "resize(e,t){"], ["compositionstart(){", "updateCompositionElements(e){"]]) {
		assert.equal(take(bundle, start, end), take(npm, start, end), start);
	}
});

// ---- 独立レビュー（codex / gpt-6.1-sol）が挙げた反例の列 ----

test("[§5.3 TerminalInputReachesOnce] keyup の後に input が来ても、差分検出と二重にならない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		// keydown(229) → keyup → 値へ挿入 → input → 差分検出の timer（同じタスク内）。
		t.ta.dispatchEvent(key(w, "keydown", { key: "x" }, 229));
		t.ta.dispatchEvent(key(w, "keyup", { key: "x" }, 0));
		uaInsert(w, t.ta, "x");
		// 別キーの keydown が挟まる: keydown(229, y) → keydown(229, z) → input(y) → input(z) → 両方の timer。
		t.ta.dispatchEvent(key(w, "keydown", { key: "y" }, 229));
		t.ta.dispatchEvent(key(w, "keydown", { key: "z" }, 229));
		uaInsert(w, t.ta, "y");
		uaInsert(w, t.ta, "z");
		t.ta.dispatchEvent(key(w, "keyup", { key: "z" }, 0));
		await t.wait(5);
		assert.deepEqual(t.sent, ["x", "y", "z"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 選択範囲の置換・カーソル途中への挿入でも、値を挿入前へ戻して DEL や余計な文字を送らない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		t.ta.value = "abc";
		t.ta.setSelectionRange(1, 2);
		t.ta.dispatchEvent(key(w, "keydown", { key: "x" }, 229));
		uaInsert(w, t.ta, "x");
		t.ta.dispatchEvent(key(w, "keyup", { key: "x" }, 0));
		await t.wait(5);
		assert.equal(t.ta.value, "abc", "選択範囲の置換は置換前の値へ戻る（差分検出が DEL を送らない）");
		assert.deepEqual([t.ta.selectionStart, t.ta.selectionEnd], [1, 2], "選択範囲も戻る");
		t.ta.setSelectionRange(1, 1);
		t.ta.dispatchEvent(key(w, "keydown", { key: "😀" }, 229));
		uaInsert(w, t.ta, "😀");
		t.ta.dispatchEvent(key(w, "keyup", { key: "😀" }, 0));
		await t.wait(5);
		assert.deepEqual(t.sent, ["x", "😀"]);
		assert.equal(t.ta.value, "abc", "値は挿入前へ戻る");
		assert.deepEqual([t.ta.selectionStart, t.ta.selectionEnd], [1, 1]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 変換確定の送信後に来た独立の文字は落とさない。送信待ちを非 229 の keydown で解いた後も同じ", async () => {
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	// compositionupdate と確定の間は 1 tick 空ける（xterm は update の setTimeout(0) で変換の終端を控える。実機でも打鍵の間がある）。
	const compose = async (text) => {
		comp("compositionstart", "");
		uaInsert(w, t.ta, text, "insertCompositionText", { isComposing: true });
		comp("compositionupdate", text);
		await t.wait(1);
		comp("compositionend", text);
	};
	try {
		await compose("か");
		// xterm の確定 timer が走った直後（0ms の timer 1 段の後）に来る独立の打鍵。
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		await iosKey(t, "b", { keyName: "b" });
		// 送信待ちの間に Enter（keyCode 13）: xterm は確定文字をその場で送って待ちを解く。その後の文字は落とさない。
		await compose("き");
		t.ta.dispatchEvent(key(w, "keydown", { key: "Enter" }, 13));
		t.ta.dispatchEvent(key(w, "keyup", { key: "Enter" }, 13));
		t.ta.dispatchEvent(key(w, "keydown", { key: "c" }, 229));
		uaInsert(w, t.ta, "c");
		t.ta.dispatchEvent(key(w, "keyup", { key: "c" }, 0));
		await t.wait(10);
		assert.deepEqual(t.sent, ["か", "b", "き", "\r", "c"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 変換中に外れたターミナルの状態を、次のターミナルへ持ち越さない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		t.ta.dispatchEvent(new w.CompositionEvent("compositionstart", { bubbles: true, composed: true, data: "" }));
		// compositionend の無いまま、DSH がターミナルを作り直す（セッション切替等）。
		t.term.dispose();
		const { Terminal } = loadXterm(w);
		t.h.el("right").innerHTML = `<section data-sidebar-terminal><div id="screen2" style="width:300px;height:200px"></div></section>`;
		const term2 = new Terminal({});
		term2.open(t.h.el("screen2"));
		const sent2 = [];
		term2.onData((d) => sent2.push(d));
		const ta2 = t.h.document.querySelector("[data-sidebar-terminal] textarea.xterm-helper-textarea");
		ta2.focus();
		await iosKey({ ...t, ta: ta2 }, "n", { keyName: "n" });
		assert.deepEqual(sent2, ["n"]);
		term2.dispose();
	} finally {
		t.h.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] keydown が送って preventDefault した打鍵に UA が挿入も出しても、二重にしない", async () => {
	// preventDefault を無視して挿入を出す UA を仮定する（keypress なし）。xterm の _inputEvent は _keyDownHandled を見ないので、送り直すと二重になる。
	const t = openTerminal();
	const w = t.h.window;
	try {
		const down = key(w, "keydown", { key: "a" }, 65);
		t.ta.dispatchEvent(down);
		assert.equal(down.defaultPrevented, true);
		uaInsert(w, t.ta, "a");
		t.ta.dispatchEvent(key(w, "keyup", { key: "a" }, 65));
		await t.wait(5);
		assert.deepEqual(t.sent, ["a"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 変換確定の送信待ちの間に入った文字は、xterm が確定文字と一緒に順序どおり送る（送り直さない）", async () => {
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	try {
		comp("compositionstart", "");
		uaInsert(w, t.ta, "か", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "か");
		await t.wait(1);
		comp("compositionend", "か");
		// 同じタスクのうちに次の文字が入る（xterm の確定 timer より前）。送り直すと「x」が「か」より先に出る。
		uaInsert(w, t.ta, "x");
		await t.wait(5);
		assert.deepEqual(t.sent, ["かx"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 送信待ちを Enter が解いた直後（同じタスク）の insertText は落とさない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	try {
		comp("compositionstart", "");
		uaInsert(w, t.ta, "き", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "き");
		await t.wait(1);
		comp("compositionend", "き");
		t.ta.dispatchEvent(key(w, "keydown", { key: "Enter" }, 13));
		t.ta.dispatchEvent(key(w, "keyup", { key: "Enter" }, 13));
		// keydown を伴わない insertText（候補バーの記号・貼り付けに近い列）。xterm は待ちを解いたので、これを送るのは本プラグインだけ。
		uaInsert(w, t.ta, "c");
		await t.wait(5);
		assert.deepEqual(t.sent, ["き", "\r", "c"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] beforeinput の無い UA の選択範囲の置換は、keydown の時点の値へ戻して二重・DEL を出さない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		t.ta.value = "abc";
		t.ta.setSelectionRange(1, 2);
		t.ta.dispatchEvent(key(w, "keydown", { key: "x" }, 229));
		uaInsert(w, t.ta, "x", "insertText", {}, { beforeinput: false });
		t.ta.dispatchEvent(key(w, "keyup", { key: "x" }, 0));
		await t.wait(5);
		assert.deepEqual(t.sent, ["x"]);
		assert.equal(t.ta.value, "abc");
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] keydown で送った打鍵の後、keydown を伴わない同じ文字の独立した入力は落とさない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		physicalKey(t, "a", 65);
		// 候補バーの記号・貼り付けに近い、keydown の無い insertText。
		uaInsert(w, t.ta, "a");
		await t.wait(5);
		assert.deepEqual(t.sent, ["a", "a"]);
		// blur をはさんだ場合も同じ（keyup が来ないまま外れた keydown を持ち越さない）。
		t.ta.dispatchEvent(key(w, "keydown", { key: "b" }, 66));
		t.ta.blur();
		t.ta.focus();
		uaInsert(w, t.ta, "b");
		await t.wait(5);
		assert.deepEqual(t.sent, ["a", "a", "b", "b"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 古い確定の解除が、続けて始まった新しい確定の送信待ちを解かない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	try {
		comp("compositionstart", "");
		uaInsert(w, t.ta, "か", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "か");
		await t.wait(1);
		comp("compositionend", "か");
		// 同じタスクで次の変換が始まり、確定する（古い解除 timer より前）。
		comp("compositionstart", "");
		uaInsert(w, t.ta, "き", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "き");
		comp("compositionend", "き");
		// 新しい送信待ちの間の insertText は、xterm が確定文字と一緒に送るので送り直さない。
		uaInsert(w, t.ta, "y");
		await t.wait(10);
		assert.deepEqual(t.sent, ["かきy"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] compositionend の配送が途中で止まっても、送信待ちは次のタスクで解け、dispose で残りを外す", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		t.ta.dispatchEvent(new w.CompositionEvent("compositionstart", { bubbles: true, composed: true, data: "" }));
		// 本プラグインの後（textarea の手前）で配送を止める。
		const stop = (e) => e.stopPropagation();
		t.ta.parentElement.addEventListener("compositionend", stop, true);
		t.ta.dispatchEvent(new w.CompositionEvent("compositionend", { bubbles: true, composed: true, data: "" }));
		t.ta.parentElement.removeEventListener("compositionend", stop, true);
		await t.wait(5);
		await iosKey(t, "z", { keyName: "z" });
		assert.deepEqual(t.sent, ["z"]);
		// 解除前に dispose しても、例外や送り直しが起きない。
		t.ta.dispatchEvent(new w.CompositionEvent("compositionstart", { bubbles: true, composed: true, data: "" }));
		t.ta.dispatchEvent(new w.CompositionEvent("compositionend", { bubbles: true, composed: true, data: "" }));
		t.h.dispose();
		await t.wait(5);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] keydown を伴わない選択範囲の置換は、beforeinput の時点の値と選択範囲へ戻す", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		await iosKey(t, "q", { keyName: "q" });
		t.ta.value = "abc";
		t.ta.setSelectionRange(1, 2);
		uaInsert(w, t.ta, "x");
		await t.wait(5);
		assert.deepEqual(t.sent, ["q", "x"]);
		assert.equal(t.ta.value, "abc");
		assert.deepEqual([t.ta.selectionStart, t.ta.selectionEnd], [1, 2]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 戻し先が無い 2 つ目の挿入（beforeinput 無し）も、差分検出と二重にならない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		t.ta.dispatchEvent(key(w, "keydown", { key: "y" }, 229));
		uaInsert(w, t.ta, "y", "insertText", {}, { beforeinput: false });
		uaInsert(w, t.ta, "z", "insertText", {}, { beforeinput: false });
		t.ta.dispatchEvent(key(w, "keyup", { key: "z" }, 0));
		await t.wait(5);
		assert.deepEqual(t.sent, ["y", "z"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 古い確定の解除 timer の後、新しい確定の送信前に来た文字は送り直さない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	try {
		comp("compositionstart", "");
		uaInsert(w, t.ta, "か", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "か");
		await t.wait(1);
		comp("compositionend", "か");
		// 古い送信・解除の timer の後、新しい送信の timer の前に走る timer で文字を入れる。
		setTimeout(() => uaInsert(w, t.ta, "y"), 0);
		comp("compositionstart", "");
		uaInsert(w, t.ta, "き", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "き");
		comp("compositionend", "き");
		await t.wait(10);
		assert.deepEqual(t.sent, ["かき", "y"]);
	} finally {
		t.close();
	}
});

test("[§5.3 TerminalInputReachesOnce] 古い確定の解除 timer が、後の確定の送信待ちを先に解かない", async () => {
	// 1 つ目の確定の解除 timer（xterm の 1 つ目の送信 timer の後）と、2 つ目の確定の xterm 送信 timer の間に insertText を入れる。
	const t = openTerminal();
	const w = t.h.window;
	const comp = (type, data) => t.ta.dispatchEvent(new w.CompositionEvent(type, { bubbles: true, composed: true, data }));
	try {
		comp("compositionstart", "");
		uaInsert(w, t.ta, "か", "insertCompositionText", { isComposing: true });
		comp("compositionupdate", "か");
		await t.wait(1);
		comp("compositionend", "か");
		// ここで 1 つ目の xterm 送信 timer → 1 つ目の解除 timer が予約済み。次のタスクで 2 つ目を確定する（同じ timer の列の後ろへ予約される）。
		setTimeout(() => {
			comp("compositionstart", "");
			uaInsert(w, t.ta, "き", "insertCompositionText", { isComposing: true });
			comp("compositionupdate", "き");
			comp("compositionend", "き");
		}, 0);
		// 1 つ目の解除 timer の直後・2 つ目の送信 timer の前に走るよう、同じ 0ms で 2 つ目より後に予約する。
		await new Promise((r) => setTimeout(r, 0));
		uaInsert(w, t.ta, "y");
		await t.wait(10);
		assert.deepEqual(t.sent, ["か", "きy"]);
	} finally {
		t.close();
	}
});


test("[§5.3 TerminalInputReachesOnce] keydown の後に別の削除が入った場合、keydown の時点の値へ巻き戻さない", async () => {
	const t = openTerminal();
	const w = t.h.window;
	try {
		t.ta.value = "abc";
		t.ta.setSelectionRange(1, 2);
		t.ta.dispatchEvent(key(w, "keydown", { key: "x" }, 229));
		// 選択範囲を消す削除（xterm に任せる）→ beforeinput の無い insertText(x)。最終値 axc は keydown の時点の選択置換と同じ形になる。
		t.ta.dispatchEvent(new w.InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "deleteContentBackward" }));
		t.ta.value = "ac";
		t.ta.setSelectionRange(1, 1);
		t.ta.dispatchEvent(new w.InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
		uaInsert(w, t.ta, "x", "insertText", {}, { beforeinput: false });
		t.ta.dispatchEvent(key(w, "keyup", { key: "x" }, 0));
		await t.wait(5);
		assert.notEqual(t.ta.value, "abc", "削除された b を戻さない");
		assert.ok(t.sent.includes("x"));
	} finally {
		t.close();
	}
});
