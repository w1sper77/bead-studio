/* 本地作品库：数组 + Uint8Array 编解码，限制 50 件 */
(function () {
  "use strict";

  const WORKS_KEY = "beadstudio.v1.works";
  const SETTINGS_KEY = "beadstudio.v1.settings";
  const MAX_WORKS = 50;
  const EVENTS = [];

  const defaultSettings = {
    sound: true,
    vibrate: true,
    numbers: true,
    onboarded: false,
    guideSkipped: false
  };

  let memory = null;
  let storageOk = true;

  function uid() {
    return "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function toB64(bytes) {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function fromB64(str, length) {
    if (!str) return new Uint8Array(length || 0);
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function readRaw() {
    if (!storageOk) return memory || [];
    try {
      const raw = localStorage.getItem(WORKS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      storageOk = false;
      return memory || [];
    }
  }

  function writeRaw(arr) {
    memory = arr;
    if (!storageOk) return false;
    try {
      localStorage.setItem(WORKS_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
        throw new Error("QUOTA");
      }
      storageOk = false;
      return false;
    }
  }

  function hydrate(raw) {
    if (!raw) return null;
    const cells = raw.w * raw.h;
    if (!Number.isFinite(cells) || cells <= 0 || cells > 10000 || !/^\d+$/.test(String(raw.w)) || !/^\d+$/.test(String(raw.h))) return null;
    const grid = fromB64(raw.grid, cells);
    const filled = fromB64(raw.filled, cells);
    if (grid.length !== cells) return null;
    const filledSafe = filled.length === cells ? filled : new Uint8Array(cells);
    const counts = new Int32Array(51);
    let filledCount = 0;
    for (let i = 0; i < cells; i++) {
      const id = grid[i];
      if (id) counts[id]++;
      if (filledSafe[i]) filledCount++;
    }
    return {
      id: raw.id,
      name: raw.name || "未命名作品",
      w: raw.w,
      h: raw.h,
      boardType: raw.boardType || "single",
      boardLabel: raw.boardLabel || (raw.w + " × " + raw.h),
      paletteId: raw.paletteId || "std50",
      paletteName: raw.paletteName || "50 色标准板",
      dither: !!raw.dither,
      grid,
      filled: filledSafe,
      total: cells,
      filledCount,
      counts,
      colorsUsed: raw.colorsUsed || 0,
      createdAt: raw.createdAt || Date.now(),
      updatedAt: raw.updatedAt || Date.now(),
      status: raw.status || "draft",
      errors: raw.errors || 0,
      activeMs: raw.activeMs || 0,
      sessions: raw.sessions || 1,
      thumbnail: raw.thumbnail || "",
      sourceThumb: raw.sourceThumb || "",
      mode: raw.mode || "bynumber",
      completedAt: raw.completedAt || 0,
      version: 1
    };
  }

  function serialize(work) {
    return {
      id: work.id,
      name: work.name,
      w: work.w,
      h: work.h,
      boardType: work.boardType,
      boardLabel: work.boardLabel,
      paletteId: work.paletteId,
      paletteName: work.paletteName,
      dither: work.dither,
      grid: toB64(work.grid),
      filled: toB64(work.filled),
      colorsUsed: work.colorsUsed,
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      status: work.status,
      errors: work.errors,
      activeMs: work.activeMs,
      sessions: work.sessions || 1,
      thumbnail: work.thumbnail,
      sourceThumb: work.sourceThumb,
      mode: work.mode,
      completedAt: work.completedAt,
      version: 1
    };
  }

  function list() {
    return readRaw()
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(hydrate)
      .filter(Boolean);
  }

  function get(id) {
    const raw = readRaw().find(w => w.id === id);
    return hydrate(raw);
  }

  function save(work) {
    const arr = readRaw().slice();
    const idx = arr.findIndex(w => w.id === work.id);
    const data = serialize(work);
    if (idx >= 0) arr[idx] = data;
    else {
      if (arr.length >= MAX_WORKS) throw new Error("FULL");
      arr.push(data);
    }
    writeRaw(arr);
    return work;
  }

  function remove(id) {
    const arr = readRaw().filter(w => w.id !== id);
    writeRaw(arr);
  }

  function duplicate(work) {
    const raw = readRaw().find(w => w.id === work.id);
    if (!raw) return null;
    const copy = JSON.parse(JSON.stringify(raw));
    copy.id = uid();
    copy.name = (work.name || "作品") + " 副本";
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    copy.status = "draft";
    copy.errors = 0;
    copy.activeMs = 0;
    copy.sessions = 1;
    copy.completedAt = 0;
    copy.filled = toB64(new Uint8Array(work.total));
    copy.thumbnail = copy.sourceThumb || "";
    const arr = readRaw().slice();
    if (arr.length >= MAX_WORKS) throw new Error("FULL");
    arr.push(copy);
    writeRaw(arr);
    return hydrate(copy);
  }

  function rename(id, name) {
    const arr = readRaw().slice();
    const item = arr.find(w => w.id === id);
    if (!item) return;
    item.name = name.trim().slice(0, 24) || "未命名作品";
    item.updatedAt = Date.now();
    writeRaw(arr);
  }

  function count() {
    return readRaw().length;
  }

  function estimateBytes() {
    try {
      return new Blob([localStorage.getItem(WORKS_KEY) || ""]).size;
    } catch (e) { return 0; }
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return Object.assign({}, defaultSettings, raw ? JSON.parse(raw) : {});
    } catch (e) {
      return Object.assign({}, defaultSettings);
    }
  }

  function setSettings(patch) {
    const next = Object.assign({}, getSettings(), patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  }

  function track(name, params) {
    EVENTS.push({ name, params: params || {}, t: Date.now() });
    if (EVENTS.length > 300) EVENTS.shift();
    if (window.console && console.debug) console.debug("[track]", name, params || {});
  }

  function mockClear() {
    // 仅用于开发/验收
    try { localStorage.removeItem(WORKS_KEY); } catch (e) { /* ignore */ }
  }

  window.Store = {
    uid, list, get, save, remove, duplicate, rename, count, estimateBytes,
    getSettings, setSettings, hydrate, serialize, track, events: EVENTS,
    MAX_WORKS, mockClear, storageOk: () => storageOk
  };
})();
