"use strict";
(() => {
  // src/shared/version.ts
  var EXT_VERSION = "0.3.8";
  var CAPABILITIES = [
    "snapshot",
    "click",
    "fill",
    "find",
    "wait",
    "pointer",
    "keys",
    "send_keys",
    "mouse_click",
    "screenshot",
    "iframe",
    "open_frame",
    "find_tab",
    "run",
    "evaluate",
    "read_page",
    "upload",
    "network",
    "shadow_dom",
    "closed_shadow",
    "select",
    "select_option",
    "drag",
    "ref_retry",
    "session",
    "tab_group",
    "close_session",
    "workflow",
    "popup",
    "record"
  ];

  // src/shared/types.ts
  function fail(message, code = "error") {
    return { ok: false, error: message, code };
  }
  function ok(data) {
    return { ok: true, data };
  }

  // src/background/debugger.ts
  async function withDebugger(tabId, fn) {
    const target = { tabId };
    let attachedHere = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attachedHere = true;
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/Already attached/i.test(msg)) throw e;
    }
    try {
      return await fn(target);
    } finally {
      if (attachedHere) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  async function debuggerMouseClick(tabId, box) {
    await withDebugger(tabId, async (target) => {
      const x = Math.round(Number(box.x));
      const y = Math.round(Number(box.y));
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none"
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1
      });
    });
  }
  async function debuggerMouseDrag(tabId, from, to, steps = 12) {
    await withDebugger(tabId, async (target) => {
      const x0 = Math.round(Number(from.x));
      const y0 = Math.round(Number(from.y));
      const x1 = Math.round(Number(to.x));
      const y1 = Math.round(Number(to.y));
      const n = Math.min(Math.max(Number(steps) || 12, 3), 40);
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: x0,
        y: y0,
        button: "none"
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: x0,
        y: y0,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = Math.round(x0 + (x1 - x0) * t);
        const y = Math.round(y0 + (y1 - y0) * t);
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          button: "left",
          buttons: 1
        });
      }
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: x1,
        y: y1,
        button: "left",
        buttons: 0,
        clickCount: 1
      });
    });
  }
  async function cdpResolveBox(tabId, args) {
    return withDebugger(tabId, async (target) => {
      const selector = String(args.selector || "").trim();
      if (selector) {
        try {
          const search = await chrome.debugger.sendCommand(target, "DOM.performSearch", {
            query: selector,
            includeUserAgentShadowDOM: true
          });
          if (search?.resultCount > 0) {
            const results = await chrome.debugger.sendCommand(target, "DOM.getSearchResults", {
              searchId: search.searchId,
              fromIndex: 0,
              toIndex: Math.min(search.resultCount, 5)
            });
            await chrome.debugger.sendCommand(target, "DOM.discardSearchResults", { searchId: search.searchId }).catch(() => {
            });
            for (const nodeId of results?.nodeIds || []) {
              try {
                const box2 = await chrome.debugger.sendCommand(target, "DOM.getBoxModel", { nodeId });
                const c2 = box2?.model?.content;
                if (!c2 || c2.length < 8) continue;
                const xs2 = [c2[0], c2[2], c2[4], c2[6]];
                const ys2 = [c2[1], c2[3], c2[5], c2[7]];
                const x = (xs2[0] + xs2[1] + xs2[2] + xs2[3]) / 4;
                const y = (ys2[0] + ys2[1] + ys2[2] + ys2[3]) / 4;
                return {
                  x,
                  y,
                  width: Math.max(xs2) - Math.min(xs2),
                  height: Math.max(ys2) - Math.min(ys2),
                  via: "cdp_search"
                };
              } catch {
              }
            }
          }
        } catch {
        }
      }
      const name = String(args.name || args.query || args.text || "").trim();
      if (!name) return null;
      const ax = await chrome.debugger.sendCommand(target, "Accessibility.getFullAXTree", {});
      const want = name.toLowerCase();
      const nodes = ax.nodes || [];
      const hit = nodes.find((n) => (n.name?.value || "").trim() === name) || nodes.find((n) => (n.name?.value || "").trim().toLowerCase() === want) || nodes.find((n) => {
        const nname = (n.name?.value || "").trim().toLowerCase();
        return !!nname && nname.includes(want);
      });
      if (!hit?.backendDOMNodeId) return null;
      const box = await chrome.debugger.sendCommand(target, "DOM.getBoxModel", {
        backendNodeId: hit.backendDOMNodeId
      });
      const c = box?.model?.content;
      if (!c || c.length < 8) return null;
      const xs = [c[0], c[2], c[4], c[6]];
      const ys = [c[1], c[3], c[5], c[7]];
      return {
        x: (xs[0] + xs[1] + xs[2] + xs[3]) / 4,
        y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        via: "cdp_ax",
        label: hit.name?.value
      };
    });
  }

  // src/background/state.ts
  var attachedTabId = null;
  function getAttachedTabId() {
    return attachedTabId;
  }
  async function loadAttached() {
    try {
      const got = await chrome.storage.session.get(["attachedTabId"]);
      if (got?.attachedTabId) attachedTabId = Number(got.attachedTabId) || null;
    } catch {
    }
  }
  async function saveAttached(tabId) {
    attachedTabId = tabId || null;
    try {
      if (attachedTabId) await chrome.storage.session.set({ attachedTabId });
      else await chrome.storage.session.remove("attachedTabId");
    } catch {
    }
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // src/background/tabs.ts
  async function ensureOffscreen() {
    const contexts = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen.html")]
    });
    if (contexts && contexts.length > 0) return;
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Maintain WebSocket to WWorkbench local browser bridge"
      });
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/Already exists|Only a single/i.test(msg)) {
        console.warn("offscreen create", e);
      }
    }
  }
  var EXPECT_CONTENT_VER = 20;
  async function ensureContent(tabId, force = false) {
    if (!force) {
      const ping = await sendToTab(tabId, "ping", {});
      const ver = Number(ping?.data?.ver || 0);
      if (ping?.ok && ver >= EXPECT_CONTENT_VER) return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      await sleep(30);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/chrome:\/\/|edge:\/\/|about:|chrome-extension:\/\/|Cannot access contents|Cannot access a chrome/i.test(msg)) {
        throw new Error("\u6B64\u9875\u65E0\u6CD5\u6CE8\u5165\u811A\u672C\uFF08\u7CFB\u7EDF\u9875/\u6269\u5C55\u9875\uFF09\uFF0C\u8BF7\u6539\u5F00\u666E\u901A https \u7F51\u9875\u540E\u518D\u9644\u7740");
      }
    }
  }
  function wantActivateWindow(args) {
    return args?.activate === true;
  }
  async function focusTab(tabId, activateWindow = false) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      if (activateWindow && tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch {
    }
  }
  function sendToTab(tabId, action, args) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { channel: "ww-browser", action, args }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message, code: "no_receiver" });
          return;
        }
        resolve(res || { ok: false, error: "\u65E0\u54CD\u5E94", code: "empty" });
      });
    });
  }
  async function resolveTabId() {
    await loadAttached();
    let tid = getAttachedTabId();
    if (tid) {
      try {
        await chrome.tabs.get(tid);
        return tid;
      } catch {
        await saveAttached(null);
        tid = null;
      }
    }
    const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (active?.id) {
      await saveAttached(active.id);
      return active.id;
    }
    return null;
  }
  async function waitTabComplete(tabId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 15e3);
    while (Date.now() < deadline) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return;
      } catch {
        return;
      }
      await sleep(120);
    }
  }

  // src/background/retry.ts
  var STALE_RE = /未找到|无法定位|not_found|stale|no.?ref|Receiving end|Could not establish|no_receiver/i;
  async function sendWithRefRetry(tabId, action, args = {}) {
    await ensureContent(tabId);
    let res = await sendToTab(tabId, action, args);
    if (res?.ok) return res;
    if (!STALE_RE.test(res?.error || res?.code || "")) return res;
    await ensureContent(tabId, /Receiving end|Could not establish|no_receiver/i.test(res?.error || ""));
    await sendToTab(tabId, "snapshot", {
      maxNodes: Number(args?.maxNodes) || 200,
      frame: args?.frame,
      format: "json"
    });
    await sleep(40);
    res = await sendToTab(tabId, action, args);
    if (res) res.retried = true;
    return res;
  }

  // src/background/click.ts
  async function handleClick(tid, args = {}) {
    const mode = String(args?.mode || "auto").toLowerCase();
    await focusTab(tid, wantActivateWindow(args));
    await ensureContent(tid);
    if (mode === "dom") {
      const res = await sendWithRefRetry(tid, "click", args);
      return res?.ok ? ok({ ...res.data || {}, mode: "dom", retried: res.retried }) : fail(res?.error || "\u70B9\u51FB\u5931\u8D25", res?.code || "click_failed");
    }
    let box = await sendWithRefRetry(tid, "resolve_box", args);
    let via = "content";
    if (!box?.ok) {
      const cdpBox = await cdpResolveBox(tid, {
        selector: String(args?.selector || ""),
        name: String(args?.name || args?.query || args?.text || args?.ref || "")
      }).catch(() => null);
      if (cdpBox) {
        box = { ok: true, data: cdpBox };
        via = cdpBox.via;
      }
    }
    if (!box?.ok) {
      if (mode === "pointer") {
        return fail(box?.error || "\u65E0\u6CD5\u5B9A\u4F4D\u5143\u7D20\uFF08\u542B CDP \u515C\u5E95\uFF09", "not_found");
      }
      const syn = await sendWithRefRetry(tid, "click", args);
      if (syn?.ok) return ok({ ...syn.data || {}, mode: "dom" });
      return fail(box?.error || syn?.error || "\u65E0\u6CD5\u5B9A\u4F4D\u5143\u7D20", "not_found");
    }
    try {
      await debuggerMouseClick(tid, box.data);
      return ok({ ...box.data || {}, mode: "pointer", via, retried: box.retried });
    } catch (e) {
      const err = String(e?.message || e);
      if (mode === "pointer") {
        return fail("\u771F\u6307\u9488\u70B9\u51FB\u5931\u8D25: " + err, "pointer_failed");
      }
      const syn = await sendWithRefRetry(tid, "click", args);
      if (syn?.ok) {
        return ok({ ...syn.data || {}, mode: "dom", pointerError: err });
      }
      return fail(syn?.error || err, "click_failed");
    }
  }
  async function handleDrag(tid, args = {}) {
    await focusTab(tid, wantActivateWindow(args));
    await ensureContent(tid);
    const fromArgs = {
      ref: args.fromRef || args.ref,
      selector: args.fromSelector || args.selector,
      frame: args.frame
    };
    const toArgs = {
      ref: args.toRef,
      selector: args.toSelector,
      frame: args.toFrame || args.frame
    };
    if (!fromArgs.ref && !fromArgs.selector && args.fromX == null) {
      return fail("\u8BF7\u63D0\u4F9B fromRef/fromSelector \u6216 fromX/fromY", "invalid_arg");
    }
    if (!toArgs.ref && !toArgs.selector && args.toX == null) {
      return fail("\u8BF7\u63D0\u4F9B toRef/toSelector \u6216 toX/toY", "invalid_arg");
    }
    let fromBox = args.fromX != null ? { ok: true, data: { x: Number(args.fromX), y: Number(args.fromY) } } : await sendWithRefRetry(tid, "resolve_box", fromArgs);
    if (!fromBox?.ok) {
      const cdp = await cdpResolveBox(tid, {
        selector: String(fromArgs.selector || ""),
        name: String(fromArgs.ref || "")
      }).catch(() => null);
      if (cdp) fromBox = { ok: true, data: cdp };
    }
    if (!fromBox?.ok) return fail(fromBox?.error || "\u65E0\u6CD5\u5B9A\u4F4D\u62D6\u62FD\u8D77\u70B9", "not_found");
    let toBox = args.toX != null ? { ok: true, data: { x: Number(args.toX), y: Number(args.toY) } } : await sendWithRefRetry(tid, "resolve_box", toArgs);
    if (!toBox?.ok) {
      const cdp = await cdpResolveBox(tid, {
        selector: String(toArgs.selector || ""),
        name: String(toArgs.ref || "")
      }).catch(() => null);
      if (cdp) toBox = { ok: true, data: cdp };
    }
    if (!toBox?.ok) return fail(toBox?.error || "\u65E0\u6CD5\u5B9A\u4F4D\u62D6\u62FD\u7EC8\u70B9", "not_found");
    try {
      await debuggerMouseDrag(tid, fromBox.data, toBox.data, Number(args.steps) || 12);
      await sleep(80);
      return ok({
        from: fromBox.data,
        to: toBox.data,
        mode: "pointer_drag"
      });
    } catch (e) {
      return fail("\u62D6\u62FD\u5931\u8D25: " + String(e?.message || e), "drag_failed");
    }
  }
  async function handleWait(tid, args = {}) {
    const timeoutMs = Math.min(Math.max(Number(args?.timeoutMs) || 8e3, 200), 4e4);
    const pollMs = Math.min(Math.max(Number(args?.pollMs) || 120, 50), 1e3);
    const started = Date.now();
    let last = null;
    let injected = false;
    while (Date.now() - started < timeoutMs) {
      if (!injected) {
        await ensureContent(tid);
        injected = true;
      }
      const res = await sendToTab(tid, "probe", args);
      last = res;
      if (res?.ok && res.data?.matched) {
        return ok({
          matched: true,
          timedOut: false,
          waitedMs: Date.now() - started,
          observation: res.data
        });
      }
      if (res && res.ok === false && /Receiving end|Could not establish|no_receiver/i.test(res.error || "")) {
        injected = false;
      }
      await sleep(pollMs);
    }
    return ok({
      matched: false,
      timedOut: true,
      waitedMs: Date.now() - started,
      observation: last?.data || null,
      error: last?.ok === false ? last.error : void 0
    });
  }

  // src/background/widget.ts
  function settleMs(args, fallback = 280) {
    return Math.min(Math.max(Number(args?.openWaitMs) || fallback, 80), 2e3);
  }
  async function prepareWidgetTab(tid, args = {}) {
    await focusTab(tid, wantActivateWindow(args));
    await ensureContent(tid);
  }

  // src/background/date.ts
  function parseYMD(raw) {
    const s = String(raw || "").trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, mo, d, iso: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }
  async function handleDateFill(tid, args = {}) {
    const want = parseYMD(args?.value);
    if (!want) return fail("\u8BF7\u63D0\u4F9B value\uFF08YYYY-MM-DD\uFF09", "invalid_arg");
    await prepareWidgetTab(tid, args);
    const opened = await sendWithRefRetry(tid, "fill", { ...args, value: want.iso, phase: "open" });
    if (opened?.ok && (opened.data?.needPick === false || opened.data?.mode === "date_native")) {
      return ok({ ...opened.data || {}, mode: opened.data?.mode || "date_native" });
    }
    if (!opened?.ok) {
      return fail(opened?.error || "\u65E0\u6CD5\u6253\u5F00\u65E5\u671F\u9762\u677F\uFF08\u53EF snapshot \u540E\u70B9\u65E5\u5386\uFF09", opened?.code || "date_open_failed");
    }
    await sleep(settleMs(args, 320));
    for (let i = 0; i < 36; i++) {
      const st = await sendWithRefRetry(tid, "fill", { ...args, value: want.iso, phase: "panel_state" });
      const curY = Number(st?.data?.y || 0);
      const curMo = Number(st?.data?.mo || 0);
      if (st?.ok && curY === want.y && curMo === want.mo) break;
      if (!st?.ok || !curY || !curMo) break;
      const dir = curY * 12 + curMo > want.y * 12 + want.mo ? "prev" : "next";
      const nav = await sendWithRefRetry(tid, "fill", {
        ...args,
        value: want.iso,
        phase: "nav_month",
        dir
      });
      if (!nav?.ok) {
        return fail(nav?.error || "\u7FFB\u6708\u5931\u8D25\uFF08\u53EF snapshot \u70B9\u300C\u4E0A\u4E2A\u6708/\u4E0B\u4E2A\u6708\u300D\uFF09", nav?.code || "date_nav_failed");
      }
      await sleep(140);
    }
    const picked = await sendWithRefRetry(tid, "fill", {
      ...args,
      value: want.iso,
      phase: "pick"
    });
    if (!picked?.ok) {
      return fail(picked?.error || "\u672A\u70B9\u5230\u65E5\u683C\uFF08\u53EF snapshot \u540E\u70B9 gridcell\uFF09", picked?.code || "no_date_cell");
    }
    return ok({
      ...picked.data || {},
      opened: true,
      value: picked.data?.value || want.iso
    });
  }

  // src/background/select.ts
  async function handleSelectOption(tid, args = {}) {
    const value = args?.value ?? args?.option ?? args?.label;
    if (value == null || String(value) === "") {
      return fail("\u8BF7\u63D0\u4F9B value/option\uFF08\u9009\u9879\u6587\u6848\u6216\u503C\uFF09", "invalid_arg");
    }
    await prepareWidgetTab(tid, args);
    const probe = await sendWithRefRetry(tid, "resolve_box", args);
    const opened = await sendWithRefRetry(tid, "select_option", { ...args, value, phase: "open" });
    if (opened?.ok && opened.data?.mode === "select") {
      return ok(opened.data);
    }
    if (!opened?.ok && opened?.code !== "custom_select") {
      if (probe?.ok) {
        const filled = await sendWithRefRetry(tid, "fill", { ...args, value });
        if (filled?.ok) return ok({ ...filled.data || {}, mode: filled.data?.mode || "value" });
      }
      if (!opened?.ok) {
        return fail(opened?.error || "\u65E0\u6CD5\u6253\u5F00\u4E0B\u62C9\uFF08\u53EF snapshot \u540E\u70B9\uFF09", opened?.code || "select_failed");
      }
    }
    await sleep(settleMs(args, 280));
    const picked = await sendWithRefRetry(tid, "select_option", {
      ...args,
      value,
      phase: "pick"
    });
    if (!picked?.ok) {
      return fail(picked?.error || "\u6253\u5F00\u4E86\u4E0B\u62C9\u4F46\u672A\u5339\u914D\u5230\u9009\u9879\uFF08\u53EF snapshot \u540E\u70B9 option\uFF09", picked?.code || "no_option");
    }
    if (picked.data?.x != null && picked.data?.y != null) {
      try {
        await debuggerMouseClick(tid, picked.data);
      } catch {
      }
    }
    return ok({
      ...picked.data || {},
      opened: true,
      selected: picked.data?.label || value
    });
  }

  // src/background/sessions.ts
  var COLOR_CYCLE = [
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange"
  ];
  var STORE_KEY = "wwSessions";
  var ledgers = {};
  var colorIdx = 0;
  async function loadSessions() {
    try {
      const got = await chrome.storage.session.get([STORE_KEY, "wwSessionColorIdx"]);
      ledgers = got?.[STORE_KEY] || {};
      colorIdx = Number(got?.wwSessionColorIdx) || 0;
    } catch {
      ledgers = {};
    }
  }
  async function persist() {
    try {
      await chrome.storage.session.set({ [STORE_KEY]: ledgers, wwSessionColorIdx: colorIdx });
    } catch {
    }
  }
  function ensureLedger(session, groupTitle) {
    const name = session.trim();
    if (!ledgers[name]) {
      ledgers[name] = {
        name,
        groupId: null,
        groupTitle: (groupTitle || name).trim() || name,
        windowId: null,
        ownedTabIds: [],
        borrowedTabIds: []
      };
    } else if (groupTitle && groupTitle.trim()) {
      ledgers[name].groupTitle = groupTitle.trim();
    }
    return ledgers[name];
  }
  function getLedger(session) {
    if (!session?.trim()) return null;
    return ledgers[session.trim()] || null;
  }
  function uniqPush(arr, id) {
    if (!arr.includes(id)) arr.push(id);
  }
  function stripId(arr, id) {
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
  }
  function resolveSessionName(session, groupTitle) {
    const s = (session || "").trim();
    if (s) return s;
    const t = (groupTitle || "").trim();
    if (!t) return "";
    return "g-" + t.toLowerCase().replace(/\s+/g, "-").replace(/[^\w\u4e00-\u9fff-]+/g, "").slice(0, 32);
  }
  async function bindTabToSession(session, tabId, opts) {
    const sessionName = resolveSessionName(session, opts?.groupTitle);
    if (!sessionName || !tabId) return null;
    if (typeof chrome.tabGroups === "undefined" || !chrome.tabs.group) {
      console.warn("tabGroups API unavailable \u2014 reload extension with tabGroups permission");
      return null;
    }
    await loadSessions();
    const ledger = ensureLedger(sessionName, opts?.groupTitle || sessionName);
    const borrowed = !!opts?.borrowed;
    if (borrowed) {
      uniqPush(ledger.borrowedTabIds, tabId);
      stripId(ledger.ownedTabIds, tabId);
    } else {
      uniqPush(ledger.ownedTabIds, tabId);
      stripId(ledger.borrowedTabIds, tabId);
    }
    if (opts?.createGroup === false) {
      await persist();
      return { groupId: ledger.groupId, groupTitle: ledger.groupTitle, borrowed, session: sessionName };
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      ledger.windowId = tab.windowId ?? ledger.windowId;
      let groupId = ledger.groupId;
      if (groupId != null) {
        try {
          const g = await chrome.tabGroups.get(groupId);
          if (g.windowId !== tab.windowId) {
            groupId = null;
            ledger.groupId = null;
          }
        } catch {
          groupId = null;
          ledger.groupId = null;
        }
      }
      if (groupId == null) {
        groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
        ledger.groupId = groupId;
        const color = COLOR_CYCLE[colorIdx % COLOR_CYCLE.length];
        colorIdx += 1;
        await chrome.tabGroups.update(groupId, {
          title: ledger.groupTitle.slice(0, 50),
          color,
          collapsed: false
        });
      } else {
        await chrome.tabs.group({ tabIds: [tabId], groupId });
        await chrome.tabGroups.update(groupId, {
          title: ledger.groupTitle.slice(0, 50),
          collapsed: false
        });
      }
      await persist();
      return { groupId: ledger.groupId, groupTitle: ledger.groupTitle, borrowed, session: sessionName };
    } catch (e) {
      console.warn("tab group bind failed", e);
      await persist();
      return { groupId: ledger.groupId, groupTitle: ledger.groupTitle, borrowed, session: sessionName };
    }
  }
  async function groupMatchingTabs(session, groupTitle, urlIncludes, opts) {
    const sessionName = resolveSessionName(session, groupTitle) || "task";
    const needle = (urlIncludes || "").toLowerCase();
    const tabs = await chrome.tabs.query({});
    const matched = tabs.filter(
      (t) => t.id != null && t.url && !t.url.startsWith("chrome://") && (!needle || t.url.toLowerCase().includes(needle))
    );
    const tabIds = [];
    let groupId = null;
    let title = groupTitle || sessionName;
    for (const t of matched) {
      const g = await bindTabToSession(sessionName, t.id, {
        borrowed: opts?.borrowed !== false,
        groupTitle: title,
        createGroup: true
      });
      if (g) {
        groupId = g.groupId;
        title = g.groupTitle;
        tabIds.push(t.id);
      }
    }
    return { session: sessionName, groupId, groupTitle: title, tabIds };
  }
  async function closeSession(session) {
    await loadSessions();
    const name = session.trim();
    const ledger = ledgers[name];
    if (!ledger) return { closed: 0, kept: [], groupTitle: name };
    const borrowed = new Set(ledger.borrowedTabIds);
    let closed = 0;
    for (const id of [...ledger.ownedTabIds]) {
      if (borrowed.has(id)) continue;
      try {
        await chrome.tabs.remove(id);
        closed += 1;
      } catch {
      }
    }
    const kept = [...ledger.borrowedTabIds];
    delete ledgers[name];
    await persist();
    return { closed, kept, groupTitle: ledger.groupTitle };
  }
  async function listSessionSummary() {
    await loadSessions();
    return Object.values(ledgers).map((l) => ({
      session: l.name,
      groupId: l.groupId,
      groupTitle: l.groupTitle,
      owned: l.ownedTabIds.length,
      borrowed: l.borrowedTabIds.length
    }));
  }
  async function groupMetaForTab(tabId) {
    await loadSessions();
    for (const l of Object.values(ledgers)) {
      if (l.ownedTabIds.includes(tabId) || l.borrowedTabIds.includes(tabId)) {
        return { groupId: l.groupId || void 0, groupTitle: l.groupTitle, session: l.name };
      }
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.groupId != null && tab.groupId >= 0) {
        const g = await chrome.tabGroups.get(tab.groupId);
        return { groupId: g.id, groupTitle: g.title || void 0 };
      }
    } catch {
    }
    return {};
  }

  // src/background/network.ts
  var byTab = /* @__PURE__ */ new Map();
  var listenerBound = false;
  function ensureListener() {
    if (listenerBound) return;
    listenerBound = true;
    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source.tabId;
      if (tabId == null) return;
      const state2 = byTab.get(tabId);
      if (!state2) return;
      if (method === "Network.requestWillBeSent") {
        const id = String(params.requestId);
        const req = params.request || {};
        const entry = {
          requestId: id,
          url: String(req.url || ""),
          method: String(req.method || "GET"),
          completed: false,
          requestHeaders: req.headers || void 0,
          requestBody: typeof req.postData === "string" ? req.postData.slice(0, 8e3) : void 0
        };
        state2.entries.set(id, entry);
        state2.order.push(id);
        if (state2.order.length > 400) {
          const drop = state2.order.shift();
          if (drop) state2.entries.delete(drop);
        }
      } else if (method === "Network.responseReceived") {
        const id = String(params.requestId);
        const entry = state2.entries.get(id);
        if (!entry) return;
        const res = params.response || {};
        entry.status = Number(res.status) || void 0;
        entry.mimeType = res.mimeType || void 0;
        entry.responseHeaders = res.headers || void 0;
      } else if (method === "Network.loadingFinished") {
        const id = String(params.requestId);
        const entry = state2.entries.get(id);
        if (entry) entry.completed = true;
      }
    });
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId != null) byTab.delete(source.tabId);
    });
  }
  async function attachNet(tabId) {
    ensureListener();
    let state2 = byTab.get(tabId);
    if (state2) return state2;
    const target = { tabId };
    let attachedHere = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attachedHere = true;
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/Already attached/i.test(msg)) throw e;
    }
    await chrome.debugger.sendCommand(target, "Network.enable", {
      maxResourceBufferSize: 5 * 1024 * 1024,
      maxTotalBufferSize: 10 * 1024 * 1024
    });
    state2 = { attachedHere, entries: /* @__PURE__ */ new Map(), order: [] };
    byTab.set(tabId, state2);
    return state2;
  }
  async function detachNet(tabId) {
    const state2 = byTab.get(tabId);
    byTab.delete(tabId);
    if (!state2) return { stopped: true, detached: false };
    if (state2.attachedHere) {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Network.disable", {});
      } catch {
      }
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
      }
    }
    return { stopped: true, detached: state2.attachedHere };
  }
  async function handleNetwork(tabId, args = {}) {
    const cmd = String(args?.cmd || args?.action || "list").toLowerCase();
    try {
      if (cmd === "start") {
        await attachNet(tabId);
        return ok({ capturing: true, tabId, note: "\u5F00\u59CB\u6355\u83B7\u672C\u6807\u7B7E\u7F51\u7EDC\uFF1Blist \u67E5\u770B\uFF0Cdetail \u53D6 body\uFF0Cstop \u7ED3\u675F" });
      }
      if (cmd === "stop") {
        const r = await detachNet(tabId);
        return ok(r);
      }
      if (cmd === "list") {
        const state2 = byTab.get(tabId);
        if (!state2) return fail("\u5C1A\u672A network start", "not_started");
        const filter = String(args?.filter || "").toLowerCase();
        const list = state2.order.map((id) => state2.entries.get(id)).filter(Boolean).filter((e) => !filter || e.url.toLowerCase().includes(filter)).slice(-(Number(args?.limit) || 80)).map((e) => ({
          requestId: e.requestId,
          url: e.url.slice(0, 300),
          method: e.method,
          status: e.status,
          mimeType: e.mimeType,
          completed: e.completed
        }));
        return ok({ count: list.length, capturing: true, requests: list });
      }
      if (cmd === "detail") {
        const state2 = byTab.get(tabId);
        if (!state2) return fail("\u5C1A\u672A network start", "not_started");
        const requestId = String(args?.requestId || "").trim();
        if (!requestId) return fail("\u8BF7\u63D0\u4F9B requestId", "invalid_arg");
        const entry = state2.entries.get(requestId);
        if (!entry) return fail("\u672A\u77E5 requestId", "not_found");
        const out = { ...entry };
        if (entry.completed) {
          try {
            const bodyRes = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
              requestId
            });
            let body = bodyRes?.body || "";
            if (bodyRes?.base64Encoded) {
              out.bodyError = "body \u4E3A base64\uFF08\u4E8C\u8FDB\u5236\uFF09\uFF0C\u5DF2\u7701\u7565";
            } else {
              if (body.length > 1e5) body = body.slice(0, 1e5) + "\n\u2026[truncated]";
              out.body = body;
            }
          } catch (e) {
            out.bodyError = String(e?.message || e);
          }
        } else {
          out.bodyError = "\u8BF7\u6C42\u672A\u5B8C\u6210\uFF0C\u7A0D\u540E detail";
        }
        return ok(out);
      }
      return fail("\u672A\u77E5 network cmd: " + cmd + "\uFF08start|stop|list|detail\uFF09", "invalid_arg");
    } catch (e) {
      return fail("network \u5931\u8D25: " + String(e?.message || e), "network_failed");
    }
  }

  // src/background/upload.ts
  async function withDebugger2(tabId, fn) {
    const target = { tabId };
    let attachedHere = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attachedHere = true;
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/Already attached/i.test(msg)) throw e;
    }
    try {
      return await fn(target);
    } finally {
      if (attachedHere) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
  }
  async function handleUpload(tid, args = {}) {
    const filesRaw = args?.files ?? args?.paths ?? args?.file;
    const files = Array.isArray(filesRaw) ? filesRaw.map((x) => String(x).trim()).filter(Boolean) : String(filesRaw || "").split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    if (!files.length) return fail("\u8BF7\u63D0\u4F9B files\uFF08\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\u6570\u7EC4\uFF09", "invalid_arg");
    await focusTab(tid, wantActivateWindow(args));
    await ensureContent(tid);
    const located = await sendWithRefRetry(tid, "resolve_file_input", args);
    if (!located?.ok) {
      return fail(located?.error || "\u672A\u627E\u5230\u6587\u4EF6\u8F93\u5165\u6846", located?.code || "not_found");
    }
    try {
      const result = await withDebugger2(tid, async (target) => {
        const expr = located.data?.ref ? `document.querySelector('[data-ww-ref="${String(located.data.ref).replace(/"/g, '\\"')}"]')` : `document.querySelector('input[type=file][data-ww-upload="1"], input[type=file]')`;
        const evalRes = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
          expression: expr,
          objectGroup: "ww-upload",
          includeCommandLineAPI: false
        });
        const objectId = evalRes?.result?.objectId;
        if (!objectId) throw new Error("CDP \u65E0\u6CD5\u62FF\u5230 file input objectId");
        const nodeRes = await chrome.debugger.sendCommand(target, "DOM.requestNode", {
          objectId
        });
        const nodeId = nodeRes?.nodeId;
        if (!nodeId) throw new Error("CDP \u65E0\u6CD5\u62FF\u5230 nodeId");
        await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", {
          files,
          nodeId
        });
        try {
          await chrome.debugger.sendCommand(target, "Runtime.releaseObjectGroup", {
            objectGroup: "ww-upload"
          });
        } catch {
        }
        return { nodeId, fileCount: files.length };
      });
      return ok({
        ...located.data,
        files,
        fileCount: files.length,
        ...result,
        mode: "cdp"
      });
    } catch (e) {
      return fail("\u4E0A\u4F20\u5931\u8D25: " + String(e?.message || e), "upload_failed");
    }
  }

  // src/background/record.ts
  var state = {
    recording: false,
    session: "",
    tabId: null,
    title: "",
    url: "",
    startedAt: 0
  };
  var navListenerInstalled = false;
  var lastNavURL = "";
  function getRecordState() {
    return { ...state };
  }
  function pushEvent(action, data) {
    chrome.runtime.sendMessage({ channel: "ww-bridge", kind: "push-event", action, data }).catch(() => {
    });
  }
  function pushRecordStep(step) {
    if (!state.recording || !state.session) return;
    pushEvent("record_step", {
      session: state.session,
      action: step.action,
      summary: step.summary || step.action,
      locator: step.locator || {},
      args: step.args || {},
      url: step.url || state.url || "",
      ok: step.ok !== false,
      error: step.error || ""
    });
  }
  async function enableOnTab(tabId) {
    await ensureContent(tabId, true);
    const res = await sendToTab(tabId, "record_enable", { session: state.session });
    if (!res?.ok) {
      await ensureContent(tabId, true);
      await sendToTab(tabId, "record_enable", { session: state.session });
    }
  }
  async function disableOnTab(tabId) {
    if (!tabId) return;
    try {
      await sendToTab(tabId, "record_disable", {});
    } catch {
    }
  }
  function installNavListener() {
    if (navListenerInstalled) return;
    navListenerInstalled = true;
    chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
      if (!state.recording || state.tabId !== tabId) return;
      if (info.status === "complete" && tab.url) {
        const url = tab.url;
        if (url && url !== lastNavURL && !url.startsWith("chrome://") && !url.startsWith("chrome-extension://")) {
          lastNavURL = url;
          state.url = url;
          if (tab.title) state.title = tab.title;
          pushRecordStep({
            action: "navigate",
            summary: `\u5BFC\u822A ${url}`,
            locator: { url },
            args: { url },
            url
          });
          void enableOnTab(tabId);
        }
      }
    });
  }
  async function startRecording(opts) {
    await ensureOffscreen();
    await loadAttached();
    let tabId = opts?.tabId || await resolveTabId();
    if (!tabId) {
      const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      tabId = active?.id || null;
    }
    if (!tabId) {
      return { ok: false, error: "\u6CA1\u6709\u53EF\u5F55\u5236\u7684\u6807\u7B7E\uFF0C\u8BF7\u5148\u6253\u5F00\u666E\u901A\u7F51\u9875", code: "no_tab" };
    }
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return { ok: false, error: "\u6807\u7B7E\u5DF2\u5173\u95ED", code: "no_tab" };
    }
    if (state.recording) {
      await stopRecording();
    }
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";
    if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://")) {
      return { ok: false, error: "\u7CFB\u7EDF\u9875\u65E0\u6CD5\u5F55\u5236\uFF0C\u8BF7\u6539\u5F00\u666E\u901A https \u7F51\u9875", code: "invalid_url" };
    }
    await saveAttached(tabId);
    const session = `rec-${Date.now().toString(36)}-${tabId}`;
    const title = (opts?.title || tab.title || "\u7F51\u9875\u5F55\u5236").trim() || "\u7F51\u9875\u5F55\u5236";
    state = {
      recording: true,
      session,
      tabId,
      title,
      url,
      startedAt: Date.now()
    };
    lastNavURL = url;
    installNavListener();
    await enableOnTab(tabId);
    pushEvent("record_start", {
      session,
      tabId,
      url,
      title
    });
    return {
      ok: true,
      data: {
        recording: true,
        session,
        tabId,
        url,
        title
      }
    };
  }
  async function stopRecording() {
    const prev = { ...state };
    await disableOnTab(state.tabId);
    state = {
      recording: false,
      session: "",
      tabId: null,
      title: "",
      url: "",
      startedAt: 0
    };
    if (prev.session) {
      pushEvent("record_stop", { session: prev.session });
    }
    return {
      ok: true,
      data: {
        recording: false,
        session: prev.session || "",
        tabId: prev.tabId
      }
    };
  }
  function handleContentRecordStep(step, senderTabId) {
    if (!state.recording) return;
    if (state.tabId && senderTabId && senderTabId !== state.tabId) return;
    pushRecordStep({
      action: String(step.action || ""),
      summary: typeof step.summary === "string" ? step.summary : void 0,
      locator: step.locator || {},
      args: step.args || {},
      url: typeof step.url === "string" ? step.url : void 0,
      ok: step.ok !== false,
      error: typeof step.error === "string" ? step.error : void 0
    });
  }
  function recordStatusExtra() {
    return {
      recording: state.recording,
      recordingSession: state.session || void 0,
      attachedTabId: state.tabId ?? getAttachedTabId()
    };
  }

  // src/background/commands.ts
  var READ_ACTIONS = /* @__PURE__ */ new Set([
    "snapshot",
    "find",
    "probe",
    "frames",
    "viewport",
    "evaluate",
    "ping",
    "read_page"
  ]);
  var PAGE_ACTIONS = /* @__PURE__ */ new Set([
    "snapshot",
    "fill",
    "find",
    "probe",
    "keys",
    "send_keys",
    "frames",
    "viewport",
    "evaluate",
    "read_page"
  ]);
  var RETRY_ACTIONS = /* @__PURE__ */ new Set(["fill", "keys", "click", "resolve_box"]);
  function normalizeAction(action, args) {
    let a = action;
    const nextArgs = { ...args };
    if (a === "send_keys") a = "keys";
    if (a === "mouse_click") {
      a = "click";
      if (!nextArgs.mode) nextArgs.mode = "pointer";
    }
    return { action: a, args: nextArgs };
  }
  async function withPage(action, args, opts) {
    const tid = await resolveTabId();
    if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
    if (opts?.focus) await focusTab(tid, wantActivateWindow(args));
    const act = action === "send_keys" ? "keys" : action;
    await ensureContent(tid);
    const res = RETRY_ACTIONS.has(act) || act === "fill" || act === "keys" ? await sendWithRefRetry(tid, act, args) : await sendToTab(tid, act, args);
    if (!res?.ok && /Receiving end|Could not establish|no_receiver/i.test(res?.error || "")) {
      await ensureContent(tid, true);
      await sleep(40);
      const again = RETRY_ACTIONS.has(act) || act === "fill" || act === "keys" ? await sendWithRefRetry(tid, act, args) : await sendToTab(tid, act, args);
      return again?.ok ? ok(again.data) : fail(again?.error || "\u5931\u8D25", again?.code || "page_error");
    }
    return res?.ok ? ok(res.data) : fail(res?.error || "\u5931\u8D25", res?.code || "page_error");
  }
  async function handleFindTab(args, session) {
    await loadAttached();
    const tabs = await chrome.tabs.query({});
    const usable = tabs.filter(
      (t) => t.id != null && t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("edge://") && !t.url.startsWith("about:")
    );
    const finish = async (tab) => {
      await saveAttached(tab.id);
      await ensureContent(tab.id);
      const groupTitle = String(args?.group_title || args?.groupTitle || "");
      const sessionName = resolveSessionName(session, groupTitle);
      const g = await bindTabToSession(sessionName, tab.id, {
        borrowed: true,
        createGroup: args?.joinGroup === false ? false : !!sessionName,
        groupTitle: groupTitle || void 0
      });
      return ok({
        tabId: tab.id,
        url: tab.url,
        title: tab.title || "",
        borrowed: true,
        attached: true,
        session: g?.session || sessionName || void 0,
        groupId: g?.groupId ?? void 0,
        groupTitle: g?.groupTitle
      });
    };
    if (args?.active) {
      const active = usable.find((t) => t.active) || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!active?.id || !usable.some((t) => t.id === active.id)) {
        return fail("\u5F53\u524D\u6CA1\u6709\u53EF\u9644\u7740\u7684\u6D3B\u52A8\u6807\u7B7E", "no_active_tab");
      }
      return finish(active);
    }
    const query = String(args?.url || args?.query || "").trim().toLowerCase();
    if (!query) return fail("\u8BF7\u63D0\u4F9B url/query\uFF0C\u6216 active:true", "invalid_arg");
    const hit = usable.find((t) => {
      const u = (t.url || "").toLowerCase();
      const title = (t.title || "").toLowerCase();
      try {
        const host = new URL(t.url || "").host.toLowerCase();
        return u.includes(query) || host.includes(query) || title.includes(query);
      } catch {
        return u.includes(query) || title.includes(query);
      }
    });
    if (!hit?.id) return fail("\u672A\u627E\u5230\u5339\u914D\u6807\u7B7E: " + query, "tab_not_found");
    return finish(hit);
  }
  async function handleRun(args, session) {
    const steps = Array.isArray(args?.steps) ? args.steps : [];
    if (!steps.length) return fail("run \u9700\u8981 steps[]", "invalid_arg");
    if (steps.length > 12) return fail("run \u6700\u591A 12 \u6B65", "too_many_steps");
    const results = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] || {};
      const action = String(step.action || "").trim();
      if (!action) return fail(`steps[${i}] \u7F3A action`, "invalid_arg");
      const norm = normalizeAction(action, step.args || {});
      if (!READ_ACTIONS.has(norm.action) && norm.action !== "wait" && norm.action !== "list_tabs" && norm.action !== "status" && norm.action !== "find_tab" && norm.action !== "read_page") {
        return fail(`run \u4EC5\u5141\u8BB8\u53EA\u8BFB/\u5B9A\u4F4D\uFF1A${norm.action} \u8BF7\u5355\u72EC\u8C03\u7528`, "write_in_run");
      }
      const res = await handleCommand({ action: norm.action, args: norm.args, session });
      results.push({ action: norm.action, ...res });
      if (!res.ok) {
        return ok({ stoppedAt: i, results, ok: false });
      }
    }
    return ok({ stoppedAt: null, results, ok: true });
  }
  async function handleCommand(msg) {
    const rawAction = String(msg.action || "");
    const { action, args } = normalizeAction(rawAction, msg.args || {});
    if (action === "list_tabs") {
      await loadAttached();
      await loadSessions();
      const attachedTabId2 = getAttachedTabId();
      const tabs = await chrome.tabs.query({});
      const data = [];
      for (const t of tabs) {
        if (t.id == null || !t.url || t.url.startsWith("chrome://") || t.url.startsWith("chrome-extension://") || t.url.startsWith("edge://") || t.url.startsWith("about:")) {
          continue;
        }
        const meta = await groupMetaForTab(t.id);
        const ledger = meta.session ? getLedger(meta.session) : null;
        data.push({
          tabId: t.id,
          windowId: t.windowId,
          url: t.url,
          title: t.title || "",
          active: !!t.active,
          attached: t.id === attachedTabId2,
          groupId: meta.groupId,
          groupTitle: meta.groupTitle,
          session: meta.session,
          borrowed: ledger ? ledger.borrowedTabIds.includes(t.id) : void 0
        });
      }
      return ok({ tabs: data, attachedTabId: attachedTabId2, sessions: await listSessionSummary() });
    }
    if (action === "find_tab") return handleFindTab(args, msg.session);
    if (action === "run") return handleRun(args, msg.session);
    if (action === "close_session") {
      const name = String(args?.session || msg.session || "").trim();
      if (!name) return fail("\u8BF7\u63D0\u4F9B session\uFF08\u4EFB\u52A1\u540D\uFF09", "invalid_arg");
      const res = await closeSession(name);
      return ok(res);
    }
    if (action === "list_sessions") {
      return ok({ sessions: await listSessionSummary() });
    }
    if (action === "group_session" || action === "ensure_group") {
      const groupTitle = String(args?.group_title || args?.groupTitle || msg.session || "\u821E\u53F0\u4EFB\u52A1").trim();
      const sessionName = resolveSessionName(String(args?.session || msg.session || ""), groupTitle) || "ww-task";
      const urlIncludes = String(args?.urlIncludes || args?.url || "").trim();
      if (Array.isArray(args?.tabIds) && args.tabIds.length) {
        const ids = args.tabIds.map((x) => Number(x)).filter((n) => n > 0);
        let groupId = null;
        const tabIds = [];
        for (const id of ids) {
          const g = await bindTabToSession(sessionName, id, {
            borrowed: args?.borrowed !== false,
            groupTitle,
            createGroup: true
          });
          if (g) {
            groupId = g.groupId;
            tabIds.push(id);
          }
        }
        return ok({ session: sessionName, groupId, groupTitle, tabIds });
      }
      if (!urlIncludes) {
        return fail("\u8BF7\u63D0\u4F9B urlIncludes\uFF08\u5982 xiaohongshu.com\uFF09\u6216 tabIds[]", "invalid_arg");
      }
      const res = await groupMatchingTabs(sessionName, groupTitle, urlIncludes, {
        borrowed: args?.borrowed !== false
      });
      return ok(res);
    }
    if (action === "attach") {
      const tabId = Number(args?.tabId);
      if (!tabId) return fail("\u8BF7\u63D0\u4F9B tabId", "invalid_arg");
      const tab = await chrome.tabs.get(tabId);
      await saveAttached(tabId);
      await ensureContent(tabId);
      await focusTab(tabId, wantActivateWindow(args));
      const borrowed = args?.borrowed !== false;
      const g = await bindTabToSession(msg.session, tabId, {
        borrowed,
        createGroup: !!args?.joinGroup,
        groupTitle: String(args?.group_title || args?.groupTitle || "")
      });
      return ok({
        tabId,
        url: tab.url,
        title: tab.title || "",
        attached: true,
        borrowed,
        session: msg.session || void 0,
        groupId: g?.groupId ?? void 0,
        groupTitle: g?.groupTitle
      });
    }
    if (action === "navigate") {
      const url = String(args?.url || "").trim();
      if (!url) return fail("\u8BF7\u63D0\u4F9B url", "invalid_arg");
      let tab;
      const current = await resolveTabId();
      const openedNew = !!args?.newTab || !current;
      if (args?.newTab) {
        tab = await chrome.tabs.create({ url, active: true });
      } else if (current) {
        tab = await chrome.tabs.update(current, { url, active: true });
      } else {
        tab = await chrome.tabs.create({ url, active: true });
      }
      await saveAttached(tab.id);
      if (args?.wait !== false) await waitTabComplete(tab.id, Number(args?.timeoutMs) || 15e3);
      const groupTitle = String(args?.group_title || args?.groupTitle || "").trim() || (openedNew ? "\u821E\u53F0\u4EFB\u52A1" : "");
      const sessionName = resolveSessionName(msg.session, groupTitle) || (openedNew ? "ww-task" : "");
      const g = sessionName ? await bindTabToSession(sessionName, tab.id, {
        borrowed: false,
        createGroup: true,
        groupTitle: groupTitle || sessionName
      }) : null;
      return ok({
        tabId: tab.id,
        url: tab.url || url,
        title: tab.title || "",
        newTab: openedNew,
        session: g?.session || sessionName || void 0,
        groupId: g?.groupId ?? void 0,
        groupTitle: g?.groupTitle
      });
    }
    if (action === "select_option") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      return handleSelectOption(tid, args);
    }
    if (action === "drag") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      return handleDrag(tid, args);
    }
    if (PAGE_ACTIONS.has(action)) {
      const needFocus = action === "fill" || action === "keys";
      const res = await withPage(action, args, { focus: needFocus });
      if (action === "fill" && !res.ok && res.code === "custom_select") {
        const tid = await resolveTabId();
        if (tid) return handleSelectOption(tid, args);
      }
      if (action === "fill" && res.ok && res.data?.mode === "date_picker" && res.data?.needPick) {
        const tid = await resolveTabId();
        if (tid) return handleDateFill(tid, args);
      }
      return res;
    }
    if (action === "click") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      return handleClick(tid, args);
    }
    if (action === "upload") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      return handleUpload(tid, args);
    }
    if (action === "network") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      return handleNetwork(tid, args);
    }
    if (action === "wait") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      return handleWait(tid, args);
    }
    if (action === "screenshot") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      await focusTab(tid, wantActivateWindow(args));
      try {
        const tab = await chrome.tabs.get(tid);
        await ensureContent(tid);
        const vp = await sendToTab(tid, "viewport", {});
        const format = String(args?.format || "jpeg").toLowerCase() === "png" ? "png" : "jpeg";
        const quality = Math.min(100, Math.max(40, Number(args?.quality) || 62));
        const opts = format === "png" ? { format: "png" } : { format: "jpeg", quality };
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, opts);
        return ok({
          dataUrl,
          format,
          quality: format === "jpeg" ? quality : void 0,
          url: tab.url || "",
          title: tab.title || "",
          tabId: tid,
          viewport: vp?.ok ? vp.data : void 0
        });
      } catch (e) {
        return fail("\u622A\u56FE\u5931\u8D25: " + String(e?.message || e), "screenshot_failed");
      }
    }
    if (action === "open_frame") {
      const tid = await resolveTabId();
      if (!tid) return fail("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u6807\u7B7E\uFF1A\u8BF7\u5148 attach / find_tab / navigate", "no_tab");
      const frameId = String(args?.frame || args?.id || "").trim();
      if (!frameId) return fail("\u8BF7\u63D0\u4F9B frame\uFF08\u5982 #f1\uFF09", "invalid_arg");
      await ensureContent(tid);
      const framesRes = await sendToTab(tid, "frames", {});
      if (!framesRes?.ok) return fail(framesRes?.error || "\u65E0\u6CD5\u8BFB\u53D6 frames", "frames_failed");
      const list = framesRes.data?.frames || [];
      const f = list.find((x) => x.id === frameId);
      if (!f) return fail("\u672A\u627E\u5230 " + frameId + "\uFF0C\u8BF7\u5148 snapshot", "not_found");
      if (f.root) return fail("#f0 \u5DF2\u662F\u4E3B\u6587\u6863\uFF0C\u65E0\u9700 open_frame", "invalid_arg");
      if (f.sameOrigin && !args?.forceNewTab) {
        return ok({
          opened: false,
          sameOrigin: true,
          frame: f.id,
          url: f.url,
          note: "\u540C\u57DF iframe\uFF1A\u76F4\u63A5 snapshot/click \u65F6\u4F20 frame=" + f.id
        });
      }
      const url = String(f.url || "").trim();
      if (!url || url.startsWith("about:") || url.startsWith("javascript:")) {
        return fail("\u8BE5 frame \u65E0\u53EF\u7528 http(s) URL\uFF0C\u65E0\u6CD5\u65B0\u5F00\u6807\u7B7E", "invalid_url");
      }
      const tab = await chrome.tabs.create({ url, active: true });
      await saveAttached(tab.id);
      await waitTabComplete(tab.id, 15e3);
      await ensureContent(tab.id);
      const g = await bindTabToSession(msg.session, tab.id, {
        borrowed: false,
        createGroup: true,
        groupTitle: String(args?.group_title || args?.groupTitle || "")
      });
      return ok({
        opened: true,
        tabId: tab.id,
        url: tab.url || url,
        title: tab.title || "",
        fromFrame: frameId,
        attached: true,
        session: msg.session || void 0,
        groupId: g?.groupId ?? void 0,
        groupTitle: g?.groupTitle
      });
    }
    if (action === "record_start") {
      const res = await startRecording({
        title: typeof args?.title === "string" ? args.title : "",
        tabId: typeof args?.tabId === "number" ? args.tabId : void 0
      });
      if (!res.ok) return fail(res.error, res.code || "record_failed");
      return ok(res.data);
    }
    if (action === "record_stop") {
      const res = await stopRecording();
      return ok(res.data);
    }
    if (action === "record_status") {
      return ok(getRecordState());
    }
    if (action === "status") {
      await loadAttached();
      const rec = recordStatusExtra();
      return ok({
        extensionConnected: true,
        attachedTabId: rec.attachedTabId ?? getAttachedTabId(),
        version: EXT_VERSION,
        capabilities: [...CAPABILITIES],
        session: msg.session || void 0,
        sessions: await listSessionSummary(),
        recording: rec.recording,
        recordingSession: rec.recordingSession
      });
    }
    return fail("\u672A\u77E5\u52A8\u4F5C: " + action, "unknown_action");
  }

  // src/background/main.ts
  void loadAttached();
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.channel === "ww-record" && msg.kind === "step") {
      handleContentRecordStep(msg, sender.tab?.id);
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.channel === "ww-popup") {
      if (msg.kind === "status") {
        handleCommand({ action: "status" }).then((res) => sendResponse(res)).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
        void ensureOffscreen();
        return true;
      }
      if (msg.kind === "record_start") {
        startRecording({ title: typeof msg.title === "string" ? msg.title : "" }).then((res) => sendResponse(res)).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
        return true;
      }
      if (msg.kind === "record_stop") {
        stopRecording().then((res) => sendResponse(res)).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
        return true;
      }
      if (msg.kind === "wake") {
        void ensureOffscreen();
        sendResponse({ ok: true });
        return true;
      }
      if (msg.kind === "reload") {
        chrome.runtime.reload();
        return false;
      }
      return false;
    }
    if (msg?.channel !== "ww-bridge") return false;
    if (msg.kind === "command") {
      handleCommand(msg.msg || {}).then((res) => sendResponse(res)).catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    }
    return false;
  });
  chrome.runtime.onInstalled.addListener(() => {
    void ensureOffscreen();
  });
  chrome.runtime.onStartup.addListener(() => {
    void ensureOffscreen();
  });
  void ensureOffscreen();
  chrome.alarms.create("ww-offscreen-keepalive", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === "ww-offscreen-keepalive") void ensureOffscreen();
  });
})();
