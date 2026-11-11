"use strict";
(() => {
  // src/content/version.ts
  var CONTENT_VER = 20;

  // src/content/frames.ts
  function listFrames() {
    const frames = [
      {
        id: "#f0",
        url: location.href,
        title: document.title,
        sameOrigin: true,
        root: true
      }
    ];
    document.querySelectorAll("iframe").forEach((iframe, idx) => {
      const id = `#f${idx + 1}`;
      iframe.setAttribute("data-ww-frame", id);
      let sameOrigin = false;
      let url = iframe.getAttribute("src") || "";
      let title = iframe.getAttribute("title") || iframe.name || "";
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          sameOrigin = true;
          url = doc.location?.href || url;
          title = doc.title || title;
        }
      } catch {
        sameOrigin = false;
      }
      frames.push({ id, url, title, sameOrigin, name: iframe.name || "" });
    });
    return frames;
  }
  function resolveContext(args) {
    const frame = String(args?.frame || "#f0").trim() || "#f0";
    if (frame === "#f0" || frame === "root" || frame === "") {
      return { doc: document, win: window, frameEl: null, frame: "#f0" };
    }
    listFrames();
    const iframe = document.querySelector(`iframe[data-ww-frame="${frame.replace(/"/g, '\\"')}"]`);
    if (!iframe) {
      throw new Error("\u672A\u627E\u5230 frame " + frame + "\uFF08\u5148 snapshot \u67E5\u770B frames\uFF09");
    }
    let doc;
    try {
      doc = iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) {
      const src = iframe.getAttribute("src") || "";
      throw new Error(
        "\u8DE8\u57DF iframe \u65E0\u6CD5\u76F4\u63A5\u64CD\u4F5C" + (src ? "\uFF1A\u8BF7\u65B0\u5F00\u6807\u7B7E\u6253\u5F00 " + src + " \u518D\u9644\u7740" : "\uFF08\u65E0 src\uFF09")
      );
    }
    return { doc, win: doc.defaultView || window, frameEl: iframe, frame };
  }

  // src/content/dom.ts
  var INTERACTIVE = 'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="option"],[role="tab"],[role="switch"],[role="gridcell"],[contenteditable=""],[contenteditable="true"],.ant-btn,.el-button,.ant-menu-item,.ProseMirror,.ql-editor,.tox-edit-area,__ww-ce';
  var DATE_CELL = '.el-date-table td.available,.el-date-table td.el-date-table__cell:not(.disabled),.el-month-table td .cell,.el-year-table td .cell,.ant-picker-cell-in-view:not(.ant-picker-cell-disabled),td[class*="available"],.el-picker-panel td.available';
  function visible(el) {
    if (!el || el.hidden) return false;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function labelOf(el) {
    const aria = (el.getAttribute("aria-label") || "").trim();
    if (aria) return aria.slice(0, 80);
    const title = (el.getAttribute("title") || "").trim();
    if (title) return title.slice(0, 80);
    if (el.classList?.contains("ant-picker-cell") || el.closest?.(".el-date-table")) {
      const day = (el.querySelector?.(".ant-picker-cell-inner, span, .cell") || el).textContent || "";
      const d = day.replace(/\s+/g, " ").trim();
      if (title) return title.slice(0, 80);
      if (d) return d.slice(0, 80);
    }
    const ph = (el.getAttribute("placeholder") || "").trim();
    if (ph) return ph.slice(0, 80);
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.classList?.contains("ProseMirror") || el.classList?.contains("ql-editor")) {
      const t2 = (el.innerText || "").replace(/\s+/g, " ").trim();
      return (t2 || "\u5BCC\u6587\u672C").slice(0, 80);
    }
    const ant = el.querySelector?.(".ant-btn-icon + span, .ant-menu-title-content, span:not(.anticon)");
    if (ant) {
      const t2 = (ant.innerText || ant.textContent || "").replace(/\s+/g, " ").trim();
      if (t2 && t2.toLowerCase() !== "button") return t2.slice(0, 80);
    }
    const name = (el.getAttribute("name") || "").trim();
    if (name) return name.slice(0, 80);
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (t && t.toLowerCase() !== "button") return t.slice(0, 80);
    return el.tagName.toLowerCase();
  }
  function roleOf(el) {
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.classList?.contains("ProseMirror") || el.classList?.contains("ql-editor")) {
      return "textbox";
    }
    if (el.classList?.contains("ant-picker-cell") || el.classList?.contains("available") || el.closest?.(".el-date-table") || el.getAttribute("role") === "gridcell") {
      return "gridcell";
    }
    return el.getAttribute("role") || (el.tagName === "A" ? "link" : el.tagName === "BUTTON" ? "button" : el.tagName === "INPUT" ? el.type || "input" : el.tagName === "TEXTAREA" ? "textbox" : el.tagName.toLowerCase());
  }
  function deepQueryAll(root, selector) {
    const out = [];
    const visit = (node) => {
      if (!node) return;
      try {
        if (node.querySelectorAll) {
          node.querySelectorAll(selector).forEach((el) => out.push(el));
        }
      } catch {
      }
      let children;
      try {
        children = node.querySelectorAll ? node.querySelectorAll("*") : [];
      } catch {
        children = [];
      }
      for (const el of children) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  }
  function deepQuery(root, selector) {
    const all = deepQueryAll(root, selector);
    return all[0] || null;
  }
  function pushInteractive(out, seen, el) {
    if (!el || !visible(el) || seen.has(el)) return;
    for (const prev of out) {
      try {
        if (prev.contains?.(el)) return;
      } catch {
      }
    }
    seen.add(el);
    out.push(el);
  }
  function openOverlayRoots(doc) {
    const sels = [
      '.el-picker__popper:not([aria-hidden="true"])',
      '.el-popper:not([aria-hidden="true"])',
      '.el-select-dropdown:not([style*="display: none"])',
      ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)",
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)"
    ];
    const roots = [];
    for (const sel of sels) {
      try {
        for (const n of [...document.querySelectorAll(sel), ...deepQueryAll(doc, sel)]) {
          if (visible(n)) roots.push(n);
        }
      } catch {
      }
    }
    return roots;
  }
  function interactiveList(doc) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    const selector = INTERACTIVE.replace(",__ww-ce", "");
    for (const root of openOverlayRoots(doc)) {
      for (const el of deepQueryAll(root, selector)) pushInteractive(out, seen, el);
      for (const el of deepQueryAll(root, DATE_CELL)) pushInteractive(out, seen, el);
    }
    for (const el of deepQueryAll(doc, selector)) pushInteractive(out, seen, el);
    for (const el of deepQueryAll(doc, DATE_CELL)) pushInteractive(out, seen, el);
    return out;
  }

  // src/content/snapshot.ts
  function buildSnapshot(args) {
    const ctx = resolveContext(args || {});
    const { doc, frame } = ctx;
    const format = String(args?.format || "json").toLowerCase();
    const hasDateOverlay = !!document.querySelector(
      '.el-picker__popper:not([aria-hidden="true"]) .el-date-table, .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'
    );
    const defaultLimit = format === "aria" ? hasDateOverlay ? 160 : 80 : hasDateOverlay ? 200 : 120;
    const limit = Math.max(20, Math.min(args?.maxNodes || defaultLimit, 400));
    const nodes = [];
    const list = interactiveList(doc);
    deepQueryAll(doc, "[data-ww-ref]").forEach((n) => n.removeAttribute("data-ww-ref"));
    let i = 0;
    for (const el of list) {
      if (nodes.length >= limit) break;
      i += 1;
      const ref = `@e${i}`;
      el.setAttribute("data-ww-ref", ref);
      const node = {
        ref,
        role: roleOf(el),
        name: labelOf(el),
        tag: el.tagName.toLowerCase(),
        type: el.type || void 0,
        value: typeof el.value === "string" ? el.value.slice(0, 60) : void 0,
        frame,
        shadow: !!el.getRootNode?.()?.host
      };
      if (node.role === "gridcell" && el.getAttribute("title")) {
        node.title = String(el.getAttribute("title")).slice(0, 32);
      }
      if (el.tagName === "SELECT") {
        node.options = [...el.options || []].slice(0, 30).map((o) => ({
          value: String(o.value || "").slice(0, 80),
          label: String(o.text || o.label || "").slice(0, 80),
          selected: !!o.selected
        }));
      }
      nodes.push(node);
    }
    const frames = listFrames();
    const base = {
      url: doc.location?.href || location.href,
      title: doc.title || document.title,
      frame,
      frames,
      truncated: list.length > nodes.length
    };
    if (format === "aria" || format === "text") {
      const lines = nodes.map((n) => {
        const bits = [n.ref, n.role, JSON.stringify(n.name || "")];
        if (n.value) bits.push("value=" + JSON.stringify(n.value));
        return bits.join(" ");
      });
      let treeText = lines.join("\n");
      const maxChars = Math.max(200, Math.min(Number(args?.maxChars) || 12e3, 6e4));
      let truncatedText = false;
      if (treeText.length > maxChars) {
        treeText = treeText.slice(0, maxChars);
        truncatedText = true;
      }
      return {
        ...base,
        format: "aria",
        tree_text: treeText,
        nodeCount: nodes.length,
        truncated: base.truncated || truncatedText
      };
    }
    return { ...base, nodes };
  }
  function findByRef(doc, ref) {
    if (!ref) return null;
    const safe = String(ref).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const el = deepQuery(doc, `[data-ww-ref="${safe}"]`);
    if (el) return el;
    const m = String(ref).match(/^@e(\d+)$/);
    if (!m) return null;
    const idx = parseInt(m[1], 10) - 1;
    return interactiveList(doc)[idx] || null;
  }
  function findTarget(doc, args) {
    if (args?.ref) {
      const byRef = findByRef(doc, args.ref);
      if (byRef) return byRef;
    }
    if (args?.selector) {
      try {
        return deepQuery(doc, args.selector) || doc.querySelector(args.selector);
      } catch {
        return null;
      }
    }
    return null;
  }
  function doFind(args) {
    const snap = buildSnapshot(args || {});
    const q = String(args?.query || args?.nameIncludes || "").trim().toLowerCase();
    if (!q) return { ok: false, error: "\u8BF7\u63D0\u4F9B query" };
    const matches = snap.nodes.filter(
      (n) => (n.name || "").toLowerCase().includes(q) || (n.ref || "").toLowerCase().includes(q) || (n.role || "").toLowerCase().includes(q)
    );
    return {
      ok: true,
      data: {
        query: q,
        matches,
        totalMatches: matches.length,
        url: snap.url,
        title: snap.title,
        frame: snap.frame,
        frames: snap.frames
      }
    };
  }
  function pageHasText(doc, text) {
    if (!text) return false;
    try {
      return (doc.body?.innerText || "").includes(text);
    } catch {
      return false;
    }
  }
  function doReadPage(args) {
    const ctx = resolveContext(args || {});
    const { doc, frame } = ctx;
    const maxChars = Math.max(200, Math.min(Number(args?.maxChars) || 8e3, 6e4));
    const start = Math.max(0, Number(args?.start) || 0);
    const raw = (doc.body?.innerText || doc.documentElement?.innerText || "").replace(/\r/g, "");
    const text = raw.slice(start, start + maxChars);
    const next = start + text.length;
    const complete = next >= raw.length;
    return {
      ok: true,
      data: {
        text,
        complete,
        nextStart: complete ? void 0 : next,
        start,
        totalChars: raw.length,
        url: doc.location?.href || location.href,
        title: doc.title || document.title,
        frame,
        note: complete ? void 0 : "\u672A\u8BFB\u5B8C\uFF1A\u628A nextStart \u4F5C\u4E3A start \u7EE7\u7EED read_page"
      }
    };
  }

  // src/content/target.ts
  function clickableTarget(el) {
    if (!el) return null;
    if (el.getAttribute("role") === "menuitem") {
      const menuTitle = el.querySelector?.(".ant-menu-title-content, a, button");
      if (menuTitle && visible(menuTitle)) return menuTitle;
    }
    const btn = el.closest?.('button, [role="button"], .ant-btn, a[href]');
    if (btn && visible(btn)) return btn;
    return el;
  }
  function flash(el) {
    try {
      const prev = el.getAttribute("style") || "";
      el.setAttribute(
        "style",
        prev + ";outline:3px solid #ff4d4f!important;outline-offset:2px!important;box-shadow:0 0 0 4px rgba(255,77,79,.35)!important;"
      );
      setTimeout(() => {
        if (prev) el.setAttribute("style", prev);
        else el.removeAttribute("style");
      }, 900);
    } catch {
    }
  }
  function boxOf(el, frameEl) {
    const r = el.getBoundingClientRect();
    let ox = 0;
    let oy = 0;
    if (frameEl) {
      const fr = frameEl.getBoundingClientRect();
      ox = fr.left;
      oy = fr.top;
    }
    const x = ox + r.left + Math.min(Math.max(r.width / 2, 2), Math.max(r.width - 2, 2));
    const y = oy + r.top + Math.min(Math.max(r.height / 2, 2), Math.max(r.height - 2, 2));
    return { x, y, width: r.width, height: r.height, top: oy + r.top, left: ox + r.left };
  }
  function dispatchPointer(el, win) {
    const b = boxOf(el, null);
    const opts = {
      bubbles: true,
      cancelable: true,
      view: win || window,
      clientX: b.x,
      clientY: b.y,
      buttons: 1
    };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        el.dispatchEvent(new MouseEvent(type, opts));
      } catch {
        el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      }
    }
  }
  function prepareTarget(args) {
    const ctx = resolveContext(args || {});
    const { doc, win, frameEl, frame } = ctx;
    const refSel = args?.ref ? `[data-ww-ref="${String(args.ref).replace(/"/g, '\\"')}"]` : "";
    if (args?.ref && !deepQuery(doc, refSel)) {
      buildSnapshot({ ...args, frame, maxNodes: args?.maxNodes || 200 });
    }
    const raw = findTarget(doc, args);
    if (!raw) return null;
    const el = clickableTarget(raw);
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
    }
    return { el, doc, win, frameEl, frame };
  }

  // src/content/click.ts
  function resolveBox(args) {
    const got = prepareTarget(args);
    if (!got) return { ok: false, error: "\u672A\u627E\u5230\u5143\u7D20 " + (args?.ref || args?.selector || "") };
    const { el, frameEl, frame } = got;
    flash(el);
    const box = boxOf(el, frameEl);
    return {
      ok: true,
      data: {
        ...box,
        tag: el.tagName.toLowerCase(),
        text: labelOf(el),
        url: location.href,
        title: document.title,
        frame,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1
        }
      }
    };
  }
  function doClick(args) {
    const got = prepareTarget(args);
    if (!got) return { ok: false, error: "\u672A\u627E\u5230\u5143\u7D20 " + (args?.ref || args?.selector || "") };
    const { el, win, frameEl, frame } = got;
    flash(el);
    el.focus?.();
    try {
      el.click();
    } catch {
    }
    dispatchPointer(el, win);
    const box = boxOf(el, frameEl);
    return {
      ok: true,
      data: {
        tag: el.tagName.toLowerCase(),
        text: labelOf(el),
        url: location.href,
        mode: "dom",
        frame,
        x: box.x,
        y: box.y,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio || 1
        }
      }
    };
  }

  // src/content/adapters/ant-date.ts
  function isAntDateEditor(el) {
    if (!el?.closest) return false;
    return !!(el.closest(".ant-picker") || el.closest(".ant-picker-input"));
  }
  function findAntDatePanel(doc) {
    const sels = [".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)", ".ant-picker-panel-container"];
    for (const sel of sels) {
      try {
        const nodes = [...document.querySelectorAll(sel), ...doc?.querySelectorAll?.(sel) || []];
        for (const n of nodes) {
          if (visible(n)) return n.closest?.(".ant-picker-dropdown") || n;
        }
      } catch {
      }
    }
    return null;
  }
  function readAntYearMonth(panel) {
    const head = (panel.querySelector(".ant-picker-header-view")?.textContent || "").replace(/\s+/g, "");
    const ym = head.match(/(\d{4})年(\d{1,2})月/) || head.match(/(\d{4})[/-](\d{1,2})/);
    if (!ym) return null;
    return { y: Number(ym[1]), mo: Number(ym[2]) };
  }
  function findAntMonthNavBtn(panel, dir) {
    return dir === "prev" ? panel.querySelector("button.ant-picker-header-prev-btn") : panel.querySelector("button.ant-picker-header-next-btn");
  }
  function pickAntDay(panel, iso) {
    const cell = panel.querySelector(`.ant-picker-cell[title="${iso}"]`) || panel.querySelector(`.ant-picker-cell-in-view[title="${iso}"]`);
    if (!cell) return false;
    const inner = cell.querySelector(".ant-picker-cell-inner") || cell;
    flash(inner);
    inner.click?.();
    cell.click?.();
    dispatchPointer(inner, window);
    return true;
  }
  function isAntDatePanel(panel) {
    return !!(panel?.querySelector?.(".ant-picker-panel, .ant-picker-cell") || panel?.classList?.contains("ant-picker-dropdown"));
  }

  // src/content/adapters/element-date.ts
  function isElementDateEditor(el) {
    if (!el?.closest) return false;
    return !!(el.closest(".el-date-editor") || el.closest(".el-date-picker"));
  }
  function findElementDatePanel(doc) {
    const sels = [
      '.el-picker__popper:not([aria-hidden="true"]) .el-date-picker',
      '.el-picker__popper:not([style*="display: none"]) .el-date-picker',
      '.el-popper:not([aria-hidden="true"]) .el-date-picker',
      ".el-picker-panel",
      ".el-date-picker:not(.el-date-editor)"
    ];
    for (const sel of sels) {
      try {
        const nodes = [...document.querySelectorAll(sel), ...doc?.querySelectorAll?.(sel) || []];
        for (const n of nodes) {
          if (visible(n)) return n.closest?.(".el-picker__popper, .el-popper") || n;
        }
      } catch {
      }
    }
    return null;
  }
  function readElementYearMonth(panel) {
    let y = 0;
    let mo = 0;
    const nodes = [
      ...panel.querySelectorAll(".el-date-picker__header-label"),
      ...panel.querySelectorAll(".el-date-picker__header button, .el-picker-panel__icon-btn")
    ];
    for (const lb of nodes) {
      const t = `${lb.getAttribute("aria-label") || ""}${lb.textContent || ""}`.replace(/\s+/g, "");
      const ym = t.match(/(\d{4})\s*年/);
      const mm = t.match(/(\d{1,2})\s*月/);
      if (ym) y = Number(ym[1]);
      if (mm) mo = Number(mm[1]);
    }
    if (!y || !mo) {
      const head = panel.querySelector(".el-date-picker__header, .el-picker-panel__body-wrapper, .el-date-picker");
      const t = (head?.textContent || "").replace(/\s+/g, "");
      const ym = t.match(/(\d{4})年.*?(\d{1,2})月/);
      if (ym) {
        y = Number(ym[1]);
        mo = Number(ym[2]);
      }
    }
    return y && mo ? { y, mo } : null;
  }
  function findElementMonthNavBtn(panel, dir) {
    const wantPrev = dir === "prev";
    const ariaExact = wantPrev ? ["\u4E0A\u4E2A\u6708", "previous month", "prev month"] : ["\u4E0B\u4E2A\u6708", "next month"];
    const yearAria = ["\u524D\u4E00\u5E74", "\u540E\u4E00\u5E74", "previous year", "next year"];
    const buttons = [...panel.querySelectorAll('button, .el-picker-panel__icon-btn, [role="button"]')];
    for (const btn of buttons) {
      const label = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""} ${btn.textContent || ""}`.replace(/\s+/g, " ").trim().toLowerCase();
      if (yearAria.some((a) => label.includes(a.toLowerCase()))) continue;
      if (ariaExact.some((a) => label === a.toLowerCase() || label.includes(a.toLowerCase()))) return btn;
    }
    for (const btn of buttons) {
      const cls = String(btn.className || "");
      if (/d-arrow/.test(cls)) continue;
      if (wantPrev && /(?:^|[\s_-])arrow-left(?:\s|$)|prev-btn/.test(cls) && !/year/i.test(cls)) return btn;
      if (!wantPrev && /(?:^|[\s_-])arrow-right(?:\s|$)|next-btn/.test(cls) && !/year/i.test(cls)) return btn;
    }
    return null;
  }
  function pickElementDay(panel, day) {
    const cells = [...panel.querySelectorAll("td.available, td.el-date-table__cell")];
    for (const td of cells) {
      if (td.classList?.contains("prev-month") || td.classList?.contains("next-month")) continue;
      if (td.classList?.contains("el-date-table__cell--prev-month") || td.classList?.contains("el-date-table__cell--next-month"))
        continue;
      const span = td.querySelector("span") || td;
      const n = Number((span.textContent || "").trim());
      if (n !== day) continue;
      if (!visible(td) && !visible(span)) continue;
      flash(span);
      span.click?.();
      td.click?.();
      dispatchPointer(span, window);
      return true;
    }
    return false;
  }

  // src/content/adapters/select-dropdown.ts
  var OPTION_SELECTORS = [
    ".ant-select-item-option:not(.ant-select-item-option-disabled)",
    ".ant-select-item-option-content",
    ".el-select-dropdown__item:not(.is-disabled)",
    ".el-vl__window .el-select-dropdown__item",
    '[role="listbox"] [role="option"]',
    '[role="option"]',
    ".rc-virtual-list-holder-inner .ant-select-item-option"
  ].join(",");
  function findDropdownOption(doc, want) {
    const q = String(want || "").trim();
    if (!q) return null;
    const qLower = q.toLowerCase();
    const cands = deepQueryAll(doc, OPTION_SELECTORS);
    const extras = [];
    try {
      document.querySelectorAll(OPTION_SELECTORS).forEach((n) => extras.push(n));
    } catch {
    }
    const scored = [];
    for (const el of [...cands, ...extras]) {
      if (!visible(el)) continue;
      const text = (el.innerText || el.textContent || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
      const val = el.getAttribute("data-value") || el.getAttribute("value") || "";
      if (!text && !val) continue;
      let score = 0;
      if (text === q || val === q) score = 100;
      else if (text.toLowerCase() === qLower) score = 90;
      else if (text.includes(q) || val.includes(q)) score = 60;
      else if (text.toLowerCase().includes(qLower)) score = 40;
      if (score > 0) scored.push({ el, text, val, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }
  function isCustomSelectTrigger(el) {
    if (!el) return false;
    if (el.tagName === "SELECT") return false;
    if (el.getAttribute("role") === "combobox") return true;
    if (el.getAttribute("aria-haspopup") === "listbox") return true;
    if (el.classList?.contains("ant-select-selector") || el.classList?.contains("ant-select-selection-search-input"))
      return true;
    if (el.classList?.contains("el-select") || el.classList?.contains("el-select__wrapper") || el.classList?.contains("el-input__wrapper")) {
      return !!el.closest?.(".el-select") || el.classList.contains("el-select");
    }
    return !!(el.closest?.(".ant-select") || el.closest?.(".el-select") || el.closest?.('[role="combobox"]'));
  }
  function customSelectRoot(el) {
    return el.closest?.(".ant-select") || el.closest?.(".el-select") || el.closest?.('[role="combobox"]') || el;
  }
  function resolveSelectTrigger(el) {
    const root = customSelectRoot(el);
    return root.querySelector?.('.ant-select-selector, .el-select__wrapper, .el-input__wrapper, [role="combobox"]') || (el.classList?.contains("ant-select-selection-search-input") ? root.querySelector(".ant-select-selector") : null) || root;
  }

  // src/content/widgets/meta.ts
  function fillResultMeta(el, extra = {}) {
    const id = (el?.getAttribute?.("id") || "").trim();
    const name = (el?.getAttribute?.("name") || "").trim();
    return {
      tag: el?.tagName?.toLowerCase?.() || "",
      ...id ? { id } : {},
      ...name ? { name } : {},
      ...extra
    };
  }
  var SNAPSHOT_HINT = "snapshot_then_click";

  // src/content/widgets/date.ts
  function parseDateValue(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, mo, d, iso: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }
  function dateEditorRoot(el) {
    if (!el?.closest) return null;
    if (isElementDateEditor(el) || isAntDateEditor(el)) {
      return el.closest(".el-date-editor") || el.closest(".el-date-picker") || el.closest(".ant-picker") || el.closest(".ant-picker-input") || el;
    }
    return null;
  }
  function findOpenDatePanel(doc) {
    return findElementDatePanel(doc) || findAntDatePanel(doc);
  }
  function readPanelYearMonth(panel) {
    if (isAntDatePanel(panel)) return readAntYearMonth(panel);
    return readElementYearMonth(panel);
  }
  function findMonthNavBtn(panel, dir) {
    if (isAntDatePanel(panel)) return findAntMonthNavBtn(panel, dir);
    return findElementMonthNavBtn(panel, dir);
  }
  function doDatePicker(args) {
    const want = parseDateValue(args?.value);
    if (!want && args?.phase !== "panel_state" && args?.phase !== "nav_month") {
      return { ok: false, error: "\u65E5\u671F\u9700 YYYY-MM-DD", code: "bad_date" };
    }
    const ctx = resolveContext(args || {});
    const { doc, frame } = ctx;
    if (args?.phase === "panel_state") {
      const panel = findOpenDatePanel(doc);
      if (!panel) return { ok: false, error: "\u65E5\u671F\u9762\u677F\u672A\u6253\u5F00", code: "no_date_panel", data: { hint: SNAPSHOT_HINT } };
      const cur = readPanelYearMonth(panel);
      if (!cur) return { ok: false, error: "\u8BFB\u4E0D\u5230\u9762\u677F\u5E74\u6708", code: "no_panel_ym", data: { hint: SNAPSHOT_HINT } };
      return { ok: true, data: { phase: "panel_state", mode: "date_picker", y: cur.y, mo: cur.mo, frame } };
    }
    if (args?.phase === "nav_month") {
      const panel = findOpenDatePanel(doc);
      if (!panel) return { ok: false, error: "\u65E5\u671F\u9762\u677F\u672A\u6253\u5F00", code: "no_date_panel", data: { hint: SNAPSHOT_HINT } };
      const dir = args?.dir === "next" ? "next" : "prev";
      const btn = findMonthNavBtn(panel, dir);
      if (!btn) return { ok: false, error: "\u627E\u4E0D\u5230\u7FFB\u6708\u6309\u94AE", code: "no_month_nav", data: { hint: SNAPSHOT_HINT } };
      btn.click?.();
      const cur = readPanelYearMonth(panel);
      return {
        ok: true,
        data: { phase: "nav_month", mode: "date_picker", dir, y: cur?.y, mo: cur?.mo, frame }
      };
    }
    if (args?.phase === "pick") {
      const panel = findOpenDatePanel(doc);
      if (!panel) return { ok: false, error: "\u65E5\u671F\u9762\u677F\u672A\u6253\u5F00", code: "no_date_panel", data: { hint: SNAPSHOT_HINT } };
      const okPick = isAntDatePanel(panel) ? pickAntDay(panel, want.iso) : pickElementDay(panel, want.d);
      if (!okPick) {
        return {
          ok: false,
          error: "\u672A\u70B9\u5230\u65E5\u671F\u683C: " + want.iso,
          code: "no_date_cell",
          data: { hint: SNAPSHOT_HINT }
        };
      }
      return {
        ok: true,
        data: { phase: "pick", mode: "date_picker", value: want.iso, frame }
      };
    }
    const got = prepareTarget(args);
    if (!got) return { ok: false, error: "\u672A\u627E\u5230\u65E5\u671F\u63A7\u4EF6", data: { hint: SNAPSHOT_HINT } };
    const { el, win } = got;
    const root = dateEditorRoot(el) || el;
    const trigger = root.querySelector?.("input") || (el.tagName === "INPUT" ? el : null) || root.querySelector?.(".el-input__wrapper, .ant-picker-input") || root;
    flash(trigger);
    trigger.focus?.();
    try {
      trigger.click?.();
    } catch {
    }
    dispatchPointer(trigger, win);
    const input = trigger.tagName === "INPUT" ? trigger : trigger.querySelector?.("input");
    if (input && input.type === "date") {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, want.iso);
      else input.value = want.iso;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        ok: true,
        data: fillResultMeta(input, { mode: "date_native", value: want.iso, frame, needPick: false })
      };
    }
    const box = boxOf(trigger, got.frameEl);
    return {
      ok: true,
      data: {
        phase: "open",
        mode: "date_picker",
        needPick: true,
        value: want.iso,
        frame,
        x: box.x,
        y: box.y,
        hint: SNAPSHOT_HINT
      }
    };
  }

  // src/content/widgets/text.ts
  function isRichEditable(el) {
    if (!el) return false;
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return true;
    if (el.classList?.contains("ProseMirror") || el.classList?.contains("ql-editor")) return true;
    if (el.getAttribute("role") === "textbox" && el.getAttribute("contenteditable") != null) return true;
    return false;
  }
  function fillRichText(el, value, win, doc) {
    el.focus?.();
    const w = win || window;
    const d = doc || document;
    try {
      const sel = w.getSelection?.();
      if (sel) {
        const range = d.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {
    }
    let mode = "contenteditable";
    let ok = false;
    try {
      ok = d.execCommand?.("insertText", false, value);
    } catch {
      ok = false;
    }
    if (!ok) {
      el.textContent = value;
      mode = "textContent";
    }
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value
        })
      );
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return mode;
  }
  function resolveEditableTarget(el, win, doc) {
    if (isRichEditable(el)) return { el, win, doc };
    const inner = el.querySelector?.('[contenteditable="true"], .ProseMirror, .ql-editor') || el.querySelector?.("iframe");
    if (inner && inner.tagName === "IFRAME") {
      try {
        const idoc = inner.contentDocument;
        const body = idoc?.body;
        if (body && (body.isContentEditable || body.getAttribute("contenteditable") === "true")) {
          return { el: body, win: idoc.defaultView, doc: idoc };
        }
      } catch {
      }
    } else if (inner) {
      return { el: inner, win, doc };
    }
    return { el, win, doc };
  }
  function fillNativeValue(el, value, frame) {
    el.focus?.();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    return {
      ok: true,
      data: fillResultMeta(el, {
        mode: "value",
        value: String(el.value || "").slice(0, 60),
        frame
      })
    };
  }
  function fillNativeSelect(el, value, frame) {
    const want = String(value);
    const opts = [...el.options || []];
    const opt = opts.find((o) => o.value === want) || opts.find((o) => (o.text || "").trim() === want) || opts.find((o) => (o.label || "").trim() === want) || opts.find((o) => (o.text || "").includes(want) || String(o.value || "").includes(want));
    if (!opt && want !== "") {
      return {
        ok: false,
        error: "\u65E0\u5339\u914D option: " + want.slice(0, 40) + "\uFF08\u53EF\u7528 snapshot \u770B options\uFF09",
        code: "no_option",
        data: { hint: "snapshot_then_click" }
      };
    }
    el.focus?.();
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    const nextVal = opt ? opt.value : "";
    if (setter) setter.call(el, nextVal);
    else el.value = nextVal;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      ok: true,
      data: fillResultMeta(el, {
        mode: "select",
        value: String(el.value || "").slice(0, 60),
        label: opt ? String(opt.text || "").slice(0, 80) : "",
        frame
      })
    };
  }

  // src/content/widgets/detect.ts
  function detectWidget(el, value) {
    if (!el) return "unknown";
    const dateVal = parseDateValue(value);
    if (dateVal && (dateEditorRoot(el) || el.type === "date" || isElementDateEditor(el) || isAntDateEditor(el))) {
      return "date";
    }
    if (el.tagName === "SELECT") return "native_select";
    if (isCustomSelectTrigger(el) && value != null && String(value) !== "") return "select";
    if (isRichEditable(el)) return "richtext";
    return "text";
  }

  // src/content/widgets/select.ts
  function doSelectOption(args) {
    const want = args?.value ?? args?.option ?? args?.label ?? "";
    if (want === "" || want == null) return { ok: false, error: "\u8BF7\u63D0\u4F9B value/option\uFF08\u9009\u9879\u6587\u6848\u6216\u503C\uFF09" };
    const ctx = resolveContext(args || {});
    const { doc, frame } = ctx;
    if (args?.phase === "pick") {
      const hit = findDropdownOption(document, want) || findDropdownOption(doc, want);
      if (!hit) {
        return {
          ok: false,
          error: "\u672A\u627E\u5230\u4E0B\u62C9\u9009\u9879: " + String(want).slice(0, 40),
          code: "no_option",
          data: { hint: SNAPSHOT_HINT }
        };
      }
      const el2 = hit.el.closest?.('.ant-select-item-option, .el-select-dropdown__item, [role="option"]') || hit.el;
      flash(el2);
      try {
        el2.scrollIntoView({ block: "nearest" });
      } catch {
      }
      el2.click?.();
      dispatchPointer(el2, window);
      const box2 = boxOf(el2, null);
      return {
        ok: true,
        data: {
          phase: "pick",
          mode: "custom_select",
          label: hit.text.slice(0, 80),
          value: String(hit.val || hit.text).slice(0, 80),
          frame,
          x: box2.x,
          y: box2.y,
          width: box2.width,
          height: box2.height
        }
      };
    }
    const got = prepareTarget(args);
    if (!got) return { ok: false, error: "\u672A\u627E\u5230\u4E0B\u62C9\u89E6\u53D1\u5668", data: { hint: SNAPSHOT_HINT } };
    let { el } = got;
    if (el.tagName === "SELECT") {
      return fillNativeSelect(el, want, frame);
    }
    el = resolveSelectTrigger(el);
    flash(el);
    el.focus?.();
    try {
      el.click();
    } catch {
    }
    dispatchPointer(el, got.win);
    const box = boxOf(el, got.frameEl);
    return {
      ok: true,
      data: {
        phase: "open",
        mode: "custom_select",
        frame,
        x: box.x,
        y: box.y,
        needPick: true,
        option: String(want).slice(0, 80)
      }
    };
  }

  // src/content/fill.ts
  function doFill(args) {
    const dateVal = parseDateValue(args?.value);
    if (args?.phase === "pick" || args?.phase === "panel_state" || args?.phase === "nav_month") {
      return doDatePicker(args);
    }
    if (args?.phase === "open" && dateVal) return doDatePicker(args);
    const got = prepareTarget(args);
    if (!got) return { ok: false, error: "\u672A\u627E\u5230\u5143\u7D20", data: { hint: SNAPSHOT_HINT } };
    let { el, win, doc, frame } = got;
    const kind = detectWidget(el, args?.value);
    if (kind === "date") return doDatePicker(args);
    if (kind === "select") {
      return {
        ok: false,
        error: "custom_select",
        code: "custom_select",
        data: {
          hint: SNAPSHOT_HINT,
          note: "background \u81EA\u52A8\u6539\u9053 select_option\uFF1B\u4ECD\u5931\u8D25\u5219 snapshot \u540E\u70B9 option"
        }
      };
    }
    if (el.getAttribute("role") === "combobox" || el.classList?.contains("ant-select-selector")) {
      el = el.querySelector("input") || el;
    }
    const resolved = resolveEditableTarget(el, win, doc);
    el = resolved.el;
    win = resolved.win;
    doc = resolved.doc;
    const value = args?.value ?? "";
    if (isRichEditable(el)) {
      const mode = fillRichText(el, value, win, doc);
      return {
        ok: true,
        data: {
          tag: el.tagName.toLowerCase(),
          mode,
          frame,
          value: String(value).slice(0, 60)
        }
      };
    }
    if (el.tagName === "SELECT") return fillNativeSelect(el, value, frame);
    return fillNativeValue(el, value, frame);
  }

  // src/content/probe.ts
  function doProbe(args) {
    const ctx = resolveContext(args || {});
    const { doc, frame } = ctx;
    const url = doc.location?.href || location.href;
    const title = doc.title || document.title;
    if (args?.readyState || args?.loadComplete) {
      const ready = (doc.readyState || "") === "complete";
      return { ok: true, data: { matched: ready, kind: "readyState", readyState: doc.readyState, url, title, frame } };
    }
    if (args?.text != null && String(args.text) !== "") {
      return { ok: true, data: { matched: pageHasText(doc, String(args.text)), kind: "text", url, title, frame } };
    }
    if (args?.textGone != null && String(args.textGone) !== "") {
      return {
        ok: true,
        data: { matched: !pageHasText(doc, String(args.textGone)), kind: "textGone", url, title, frame }
      };
    }
    if (args?.nameIncludes) {
      const found = doFind({ ...args, query: args.nameIncludes });
      if (!found.ok) return found;
      return {
        ok: true,
        data: {
          matched: found.data.totalMatches > 0,
          kind: "nameIncludes",
          matches: found.data.matches.slice(0, 12),
          url,
          title,
          frame
        }
      };
    }
    if (args?.ref || args?.selector) {
      buildSnapshot({ ...args, maxNodes: args?.maxNodes || 200 });
      const el = findTarget(doc, args);
      return {
        ok: true,
        data: { matched: !!(el && visible(el)), kind: args.ref ? "ref" : "selector", url, title, frame }
      };
    }
    return { ok: false, error: "wait/probe \u8BF7\u63D0\u4F9B text\u3001textGone\u3001nameIncludes\u3001ref\u3001selector \u6216 readyState" };
  }

  // src/content/keys.ts
  var NAMED_KEYS = {
    Enter: { key: "Enter", code: "Enter", keyCode: 13 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Esc: { key: "Escape", code: "Escape", keyCode: 27 },
    Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    Delete: { key: "Delete", code: "Delete", keyCode: 46 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    Space: { key: " ", code: "Space", keyCode: 32 },
    Home: { key: "Home", code: "Home", keyCode: 36 },
    End: { key: "End", code: "End", keyCode: 35 }
  };
  function dispatchKey(target, def, mods, win) {
    const opts = {
      key: def.key,
      code: def.code,
      keyCode: def.keyCode,
      which: def.keyCode,
      bubbles: true,
      cancelable: true,
      view: win || window,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
      altKey: !!mods.alt,
      shiftKey: !!mods.shift
    };
    for (const type of ["keydown", "keypress", "keyup"]) {
      if (type === "keypress" && def.key.length > 1 && def.key !== "Enter") continue;
      target.dispatchEvent(new KeyboardEvent(type, opts));
    }
  }
  function doKeys(args) {
    const ctx = resolveContext(args || {});
    let target = ctx.doc.activeElement || ctx.doc.body;
    let win = ctx.win;
    if (args?.ref || args?.selector) {
      const got = prepareTarget(args);
      if (!got) return { ok: false, error: "\u672A\u627E\u5230\u8981\u805A\u7126\u7684\u5143\u7D20" };
      got.el.focus?.();
      target = got.el;
      win = got.win;
    }
    const raw = String(args?.keys || "").trim();
    if (!raw) return { ok: false, error: "\u8BF7\u63D0\u4F9B keys\uFF08\u5982 Enter\u3001Escape\u3001Mod+A\uFF09" };
    const repeat = Math.min(Math.max(Number(args?.repeat) || 1, 1), 20);
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
    const mods = { ctrl: false, meta: false, alt: false, shift: false };
    const keyToken = parts[parts.length - 1] || raw;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i].toLowerCase();
      if (p === "mod") {
        if (isMac) mods.meta = true;
        else mods.ctrl = true;
      } else if (p === "meta" || p === "cmd" || p === "command") mods.meta = true;
      else if (p === "ctrl" || p === "control") mods.ctrl = true;
      else if (p === "alt" || p === "option") mods.alt = true;
      else if (p === "shift") mods.shift = true;
    }
    const named = NAMED_KEYS[keyToken];
    const def = named || {
      key: keyToken.length === 1 ? keyToken : keyToken,
      code: keyToken.length === 1 ? "Key" + keyToken.toUpperCase() : keyToken,
      keyCode: keyToken.length === 1 ? keyToken.toUpperCase().charCodeAt(0) : 0
    };
    for (let i = 0; i < repeat; i++) dispatchKey(target, def, mods, win);
    return {
      ok: true,
      data: {
        keys: raw,
        repeat,
        tag: target.tagName?.toLowerCase?.() || "body",
        url: location.href,
        frame: ctx.frame
      }
    };
  }

  // src/content/file.ts
  function resolveFileInput(args) {
    const ctx = resolveContext(args || {});
    const { doc, frame } = ctx;
    if (args?.ref && !deepQuery(doc, `[data-ww-ref="${String(args.ref).replace(/"/g, '\\"')}"]`)) {
      buildSnapshot({ ...args, frame, maxNodes: args?.maxNodes || 200 });
    }
    let el = findTarget(doc, args);
    if (el && el.tagName !== "INPUT") {
      const nested = el.querySelector?.('input[type="file"]') || deepQuery(el, 'input[type="file"]');
      if (nested) el = nested;
      else {
        const lab = el.closest?.("label");
        if (lab) {
          const forId = lab.getAttribute("for");
          if (forId) el = doc.getElementById(forId) || el;
          else el = lab.querySelector('input[type="file"]') || el;
        }
      }
    }
    if (!el) {
      el = deepQuery(doc, 'input[type="file"]');
    }
    if (!el || el.tagName !== "INPUT" || String(el.type).toLowerCase() !== "file") {
      return { ok: false, error: "\u672A\u627E\u5230 input[type=file]\uFF0C\u8BF7\u5148 snapshot/find \u4E0A\u4F20\u63A7\u4EF6", code: "not_found" };
    }
    const ref = el.getAttribute("data-ww-ref") || "";
    if (!ref) {
      el.setAttribute("data-ww-upload", "1");
    }
    return {
      ok: true,
      data: {
        tag: "input",
        type: "file",
        ref: ref || void 0,
        name: el.getAttribute("name") || "",
        accept: el.getAttribute("accept") || "",
        multiple: !!el.multiple,
        frame,
        marked: !ref,
        url: location.href
      }
    };
  }

  // src/content/evaluate.ts
  function doEvaluate(args = {}) {
    const code = String(args?.code || "").trim();
    if (!code) return { ok: false, error: "\u8BF7\u63D0\u4F9B code" };
    const ctx = resolveContext(args || {});
    const win = ctx.win || window;
    let value;
    try {
      value = win.eval(code);
    } catch (e1) {
      try {
        value = new win.Function("return (" + code + ")")();
      } catch {
        return { ok: false, error: String(e1?.message || e1) };
      }
    }
    let out = value;
    try {
      out = JSON.parse(JSON.stringify(value));
    } catch {
      out = String(value);
    }
    return { ok: true, data: { type: typeof value, value: out, frame: ctx.frame } };
  }

  // src/content/record.ts
  var enabled = false;
  var session = "";
  var lastFillAt = 0;
  var lastClickKey = "";
  var lastClickAt = 0;
  function cssEscapeIdent(s) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function stableSelector(el) {
    const html = el;
    const id = html.id?.trim();
    if (id && /^[A-Za-z][\w:-]*$/.test(id)) {
      try {
        if (html.ownerDocument.querySelectorAll(`#${cssEscapeIdent(id)}`).length === 1) {
          return `#${cssEscapeIdent(id)}`;
        }
      } catch {
      }
    }
    const tag = html.tagName.toLowerCase();
    const name = html.getAttribute("name")?.trim();
    if (name) {
      const sel = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
      try {
        if (html.ownerDocument.querySelectorAll(sel).length === 1) return sel;
      } catch {
      }
    }
    for (const attr of ["data-testid", "data_value", "data-id", "aria-label"]) {
      const v = html.getAttribute(attr)?.trim();
      if (!v) continue;
      const sel = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
      try {
        if (html.ownerDocument.querySelectorAll(sel).length === 1) return sel;
      } catch {
      }
    }
    const parts = [];
    let cur = html;
    for (let i = 0; i < 4 && cur && cur.nodeType === 1; i++) {
      const t = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w:-]*$/.test(cur.id)) {
        parts.unshift(`#${cssEscapeIdent(cur.id)}`);
        break;
      }
      const parent = cur.parentElement;
      if (!parent) {
        parts.unshift(t);
        break;
      }
      const siblings = [...parent.children].filter((c) => c.tagName === cur.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        parts.unshift(`${t}:nth-of-type(${idx})`);
      } else {
        parts.unshift(t);
      }
      cur = parent;
      if (t === "body" || t === "html") break;
    }
    return parts.join(" > ");
  }
  function emit(step) {
    if (!enabled) return;
    try {
      chrome.runtime.sendMessage({
        channel: "ww-record",
        kind: "step",
        session,
        ...step,
        url: location.href
      });
    } catch {
    }
  }
  function looksClickable(el) {
    const tag = el.tagName;
    if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "LABEL" || tag === "SUMMARY" || el.isContentEditable) {
      return true;
    }
    const role = el.getAttribute("role") || "";
    if (role === "button" || role === "link" || role === "tab" || role === "menuitem" || role === "option" || role === "checkbox" || role === "radio" || role === "treeitem" || role === "listitem") {
      return true;
    }
    if (el.classList?.contains("ant-btn") || el.classList?.contains("el-button")) return true;
    if (el.hasAttribute("data_value") || el.hasAttribute("data-value") || el.hasAttribute("data-testid")) return true;
    if (tag === "LI" && (el.hasAttribute("data_value") || el.hasAttribute("data-value") || el.onclick)) return true;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex != null && tabindex !== "" && Number(tabindex) >= 0) return true;
    if (el.getAttribute("onclick") || typeof el.onclick === "function") return true;
    try {
      if (getComputedStyle(el).cursor === "pointer") return true;
    } catch {
    }
    return false;
  }
  function interactiveFrom(el) {
    let cur = el;
    let pointerFallback = null;
    let anyFallback = null;
    for (let i = 0; i < 12 && cur; i++) {
      if (cur.nodeType !== 1) {
        cur = cur.parentElement;
        continue;
      }
      if (cur.tagName === "BODY" || cur.tagName === "HTML") break;
      if (!visible(cur)) {
        cur = cur.parentElement;
        continue;
      }
      if (!anyFallback) anyFallback = cur;
      if (cur.hasAttribute("data_value") || cur.hasAttribute("data-value")) {
        return cur;
      }
      if (looksClickable(cur)) {
        try {
          const onlyPointer = getComputedStyle(cur).cursor === "pointer" && !["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "LI"].includes(cur.tagName) && !cur.getAttribute("role") && !cur.hasAttribute("data_value") && !cur.hasAttribute("data-value");
          if (onlyPointer) {
            if (!pointerFallback) pointerFallback = cur;
          } else {
            return cur;
          }
        } catch {
          return cur;
        }
      }
      cur = cur.parentElement;
    }
    return pointerFallback || anyFallback;
  }
  function onClick(ev) {
    if (!enabled || !ev.isTrusted) return;
    const el = interactiveFrom(ev.target);
    if (!el) return;
    const tag = el.tagName;
    const type = el.type || "";
    if (tag === "INPUT" && !["button", "submit", "reset", "checkbox", "radio", "file"].includes(type)) return;
    if (tag === "TEXTAREA" || el.isContentEditable) return;
    const name = labelOf(el);
    const dataValue = el.getAttribute("data_value") || el.getAttribute("data-value") || "";
    if (!name && !dataValue && (tag === "DIV" || tag === "SPAN" || tag === "SECTION")) return;
    const selector = stableSelector(el);
    const key = `${selector}|${name}|${dataValue}`;
    const now = Date.now();
    if (key === lastClickKey && now - lastClickAt < 400) return;
    lastClickKey = key;
    lastClickAt = now;
    const locator = {
      selector,
      name,
      role: roleOf(el),
      url: location.href
    };
    if (dataValue) locator.data_value = dataValue;
    const args = { selector, name };
    if (dataValue) args.data_value = dataValue;
    emit({
      action: "click",
      summary: name ? `\u70B9\u51FB ${name}` : dataValue ? `\u70B9\u51FB ${dataValue}` : `\u70B9\u51FB ${selector}`,
      locator,
      args
    });
  }
  function readValue(el) {
    if (el.tagName === "SELECT") {
      const sel = el;
      const opt = sel.selectedOptions?.[0];
      return (opt?.textContent || sel.value || "").trim().slice(0, 200);
    }
    if (el.isContentEditable) return (el.innerText || "").trim().slice(0, 200);
    return String(el.value || "").slice(0, 200);
  }
  function onChange(ev) {
    if (!enabled || !ev.isTrusted) return;
    const el = interactiveFrom(ev.target) || ev.target;
    if (!el) return;
    const tag = el.tagName;
    const type = el.type || "";
    if (tag === "INPUT" && ["button", "submit", "reset", "file", "checkbox", "radio"].includes(type)) return;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !el.isContentEditable) return;
    const now = Date.now();
    if (now - lastFillAt < 200) return;
    lastFillAt = now;
    const name = labelOf(el);
    const selector = stableSelector(el);
    const value = readValue(el);
    emit({
      action: tag === "SELECT" ? "select_option" : "fill",
      summary: name ? `\u586B\u5199 ${name}` : `\u586B\u5199 ${selector}`,
      locator: { selector, name, role: roleOf(el), url: location.href },
      args: { selector, name, value }
    });
  }
  function onSubmit(ev) {
    if (!enabled || !ev.isTrusted) return;
    const form = ev.target;
    if (!form || form.tagName !== "FORM") return;
    const selector = stableSelector(form);
    emit({
      action: "click",
      summary: "\u63D0\u4EA4\u8868\u5355",
      locator: { selector, name: labelOf(form) || "form", role: "form", url: location.href },
      args: { selector, submit: true }
    });
  }
  function enableRecording(sess) {
    session = sess || "";
    if (enabled) return { ok: true, data: { recording: true, session } };
    enabled = true;
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("submit", onSubmit, true);
    return { ok: true, data: { recording: true, session } };
  }
  function disableRecording() {
    if (!enabled) return { ok: true, data: { recording: false } };
    enabled = false;
    session = "";
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("submit", onSubmit, true);
    return { ok: true, data: { recording: false } };
  }
  function recordingStatus() {
    return { recording: enabled, session };
  }

  // src/content/main.ts
  var VER = CONTENT_VER;
  function install() {
    if (window.__wwBrowserStageVer === VER && window.__wwBrowserStageHandler) return;
    if (window.__wwBrowserStageHandler) {
      try {
        chrome.runtime.onMessage.removeListener(window.__wwBrowserStageHandler);
      } catch {
      }
    }
    window.__wwBrowserStageVer = VER;
    window.__wwBrowserStage = true;
    function onMessage(msg, _sender, sendResponse) {
      if (!msg || msg.channel !== "ww-browser") return false;
      try {
        const map = {
          ping: () => ({ ok: true, data: { ver: VER, url: location.href } }),
          snapshot: () => ({ ok: true, data: buildSnapshot(msg.args || {}) }),
          read_page: () => doReadPage(msg.args || {}),
          resolve_box: () => resolveBox(msg.args || {}),
          resolve_file_input: () => resolveFileInput(msg.args || {}),
          click: () => doClick(msg.args || {}),
          fill: () => doFill(msg.args || {}),
          select_option: () => doSelectOption(msg.args || {}),
          find: () => doFind(msg.args || {}),
          probe: () => doProbe(msg.args || {}),
          keys: () => doKeys(msg.args || {}),
          evaluate: () => doEvaluate(msg.args || {}),
          frames: () => ({ ok: true, data: { frames: listFrames(), url: location.href } }),
          viewport: () => ({
            ok: true,
            data: {
              width: window.innerWidth,
              height: window.innerHeight,
              dpr: window.devicePixelRatio || 1,
              url: location.href
            }
          }),
          record_enable: () => enableRecording(String(msg.args?.session || "")),
          record_disable: () => disableRecording(),
          record_status: () => ({ ok: true, data: recordingStatus() })
        };
        const fn = map[msg.action];
        if (!fn) {
          sendResponse({ ok: false, error: "\u672A\u77E5 content \u52A8\u4F5C: " + msg.action });
          return true;
        }
        sendResponse(fn());
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return true;
    }
    window.__wwBrowserStageHandler = onMessage;
    chrome.runtime.onMessage.addListener(onMessage);
  }
  install();
})();
