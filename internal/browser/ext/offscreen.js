"use strict";
(() => {
  // src/shared/version.ts
  var EXT_VERSION = "0.3.8";

  // src/offscreen/main.ts
  var BRIDGE_URL = "ws://127.0.0.1:18765/ext";
  var RECONNECT_MS = 1500;
  var ws = null;
  var reconnectTimer = null;
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(BRIDGE_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", version: EXT_VERSION, role: "extension-offscreen" }));
      chrome.runtime.sendMessage({ channel: "ww-bridge", kind: "connected" }).catch(() => {
      });
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg?.type === "ping") {
        ws?.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (msg?.id && msg?.action) {
        chrome.runtime.sendMessage({ channel: "ww-bridge", kind: "command", msg }, (res) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reply(msg.id, { ok: false, error: err.message });
            return;
          }
          reply(msg.id, res || { ok: false, error: "background \u65E0\u54CD\u5E94" });
        });
      }
    });
    ws.addEventListener("close", () => {
      ws = null;
      chrome.runtime.sendMessage({ channel: "ww-bridge", kind: "disconnected" }).catch(() => {
      });
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      try {
        ws?.close();
      } catch {
      }
    });
  }
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }
  function reply(id, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ id, ...payload }));
  }
  function pushEvent(action, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
      return;
    }
    ws.send(JSON.stringify({ type: "event", action, data: data || {} }));
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.channel !== "ww-bridge") return false;
    if (msg.kind === "ping-sw") {
      sendResponse({ ok: true, ws: ws?.readyState === WebSocket.OPEN });
      return true;
    }
    if (msg.kind === "push-event") {
      pushEvent(String(msg.action || ""), msg.data || {});
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
  connect();
  setInterval(() => {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) connect();
  }, 5e3);
})();
