// Shotinerary on its own (Home Screen app): stores everything on this device, no sign-in.
// It stands in for the Claude page runtime the app was first built on (window.claude.use "db" / "assets"),
// so the same app code runs here unchanged.
(() => {
  window.SHOT_LOCAL = true;
  const DBN = "shotinerary", VER = 1;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DBN, VER);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs"); if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  let idb = null;
  const tx = (store, mode, fn) => new Promise((res, rej) => { const t = idb.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const all = (store) => new Promise((res, rej) => { const out = []; const t = idb.transaction(store, "readonly"); const c = t.objectStore(store).openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); }; c.onerror = () => rej(c.error); });

  const docs = {};           // { collection: { id: data } }
  const blobs = new Map();   // id -> Blob
  const urls = new Map();    // id -> object URL
  const subs = {};
  const coll = (c) => (docs[c] = docs[c] || {});
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const snap = (c) => { const d = Object.entries(coll(c)).map(([id, v]) => ({ id, exists: true, data: () => clone(v), metadata: {} })); return { docs: d, size: d.length, empty: !d.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] }; };
  const emit = (c) => (subs[c] || []).forEach((fn) => { try { fn(snap(c)); } catch (e) { console.error(e); } });
  const ready = (async () => {
    idb = await open();
    for (const [k, v] of await all("docs")) { const i = k.indexOf("/"); coll(k.slice(0, i))[k.slice(i + 1)] = v; }
    for (const [k, v] of await all("blobs")) blobs.set(k, v);
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
  })();
  const put = (c, id, v) => tx("docs", "readwrite", (s) => s.put(v, c + "/" + id));
  const del = (c, id) => tx("docs", "readwrite", (s) => s.delete(c + "/" + id));
  const db = {
    collection: (c) => ({
      onSnapshot(next) { (subs[c] = subs[c] || []).push(next); ready.then(() => next(snap(c))); return () => { subs[c] = (subs[c] || []).filter((f) => f !== next); }; },
      doc: (id) => ({
        async set(v) { await ready; v = clone(v); await put(c, id, v); coll(c)[id] = v; emit(c); },
        async update(v) { await ready; const cur = coll(c)[id]; if (!cur) throw { code: "not_found", message: "Not found" }; const nv = { ...cur, ...clone(v) }; await put(c, id, nv); coll(c)[id] = nv; emit(c); },
        async delete() { await ready; await del(c, id); delete coll(c)[id]; emit(c); },
      }),
    }),
  };
  const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const assets = {
    async upload(blob) { await ready; const id = newId(); await tx("blobs", "readwrite", (s) => s.put(blob, id)); blobs.set(id, blob); return { id, url: window.shotBlobUrl(id), sizeBytes: blob.size, contentType: blob.type }; },
    async delete(id) { await ready; await tx("blobs", "readwrite", (s) => s.delete(id)); const had = blobs.delete(id); if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); } return { deleted: had }; },
    async list() { await ready; let bytes = 0; for (const b of blobs.values()) bytes += b.size; let max = 0; try { max = (await navigator.storage.estimate()).quota || 0; } catch {} return { assets: [], usage: { files: blobs.size, bytes, maxFiles: 100000, maxBytes: max || 1e9 } }; },
  };
  // Images: in-page links to the photos kept on this device
  window.shotBlobUrl = (id) => { if (urls.has(id)) return urls.get(id); const b = blobs.get(id); if (!b) return ""; const u = URL.createObjectURL(b); urls.set(id, u); return u; };
  window.claude = { use: async (name) => { await ready; return { db, assets, sample: null }[name] || null; } };

  // ---------- Back up and restore (one file with every photo and all your data) ----------
  const toDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const fromDataUrl = async (u) => (await fetch(u)).blob();
  window.shotBackup = async () => {
    await ready;
    const out = { app: "shotinerary", format: 1, created: new Date().toISOString(), cities: Object.entries(coll("cities")).map(([id, v]) => ({ id, ...v })), photos: Object.entries(coll("photos")).map(([id, v]) => ({ id, ...v })), blobs: {} };
    const need = new Set(out.photos.flatMap((p) => [p.fullId, p.thumbId]).filter(Boolean));
    for (const id of need) { const b = blobs.get(id); if (b) out.blobs[id] = await toDataUrl(b); }
    const file = new File([JSON.stringify(out)], `Shotinerary backup ${out.created.slice(0, 10)}.json`, { type: "application/json" });
    try { localStorage.setItem("shot.lastBackup", out.created); } catch {}
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Shotinerary backup" }); return { shared: true, photos: out.photos.length }; }
      catch (e) { if (e && e.name === "AbortError") return { cancelled: true }; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    return { downloaded: true, photos: out.photos.length };
  };
  // Reads a .zip (stored or compressed) into a list of files, using the browser's own decompressor.
  const unzip = async (zip) => {
    const buf = new Uint8Array(await zip.arrayBuffer()); const v = new DataView(buf.buffer); const out = [];
    let e = buf.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("That zip file looks damaged.");
    let p = v.getUint32(e + 16, true); const n = v.getUint16(e + 10, true);
    for (let i = 0; i < n; i++) {
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      const ds = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true); const raw = buf.subarray(ds, ds + csize);
      let blob = new Blob([raw]);
      if (method === 8) blob = await new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
      else if (method !== 0) continue;
      out.push(new File([blob], name));
    }
    return out;
  };
  // Adds what's in the file; anything with the same id is replaced by the file's copy. Nothing else is removed.
  window.shotRestore = async (file) => {
    await ready;
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) { // a .zip: restore every backup inside it
      let t = { photos: 0, cities: 0, images: 0 };
      for (const f of await unzip(file)) { if (!/\.json$/i.test(f.name) || /^__MACOSX|\/\._/.test(f.name)) continue; const r = await window.shotRestore(f); t.photos += r.photos; t.cities = Math.max(t.cities, r.cities); t.images += r.images; }
      if (!t.photos) throw new Error("No Shotinerary backup inside that zip.");
      return t;
    }
    const data = JSON.parse(await file.text());
    if (!data || data.app !== "shotinerary" || !Array.isArray(data.photos)) throw new Error("This isn't a Shotinerary backup file.");
    let nb = 0;
    for (const [id, u] of Object.entries(data.blobs || {})) { if (blobs.has(id)) continue; const b = await fromDataUrl(u); await tx("blobs", "readwrite", (s) => s.put(b, id)); blobs.set(id, b); nb++; }
    for (const c of data.cities || []) { const { id, ...v } = c; await put("cities", id, v); coll("cities")[id] = v; }
    for (const p of data.photos) { const { id, ...v } = p; await put("photos", id, v); coll("photos")[id] = v; }
    emit("cities"); emit("photos");
    return { photos: data.photos.length, cities: (data.cities || []).length, images: nb };
  };
  window.shotLastBackup = () => { try { return localStorage.getItem("shot.lastBackup"); } catch { return null; } };

  // ---------- Works offline, and updates itself ----------
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("sw.js");
        const offer = (w) => { if (!w || !navigator.serviceWorker.controller) return; window.shotOfferUpdate && window.shotOfferUpdate(() => w.postMessage("skipWaiting")); };
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener("updatefound", () => { const w = reg.installing; if (w) w.addEventListener("statechange", () => { if (w.state === "installed") offer(w); }); });
        let reloaded = false; navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloaded) return; reloaded = true; location.reload(); });
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      } catch {}
    });
  }
})();
