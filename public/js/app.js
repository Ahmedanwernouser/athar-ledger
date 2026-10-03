// app.js — the page. All matching runs in js/worker.js; this file only draws and listens.
import { fmtTime, fnv1a, wordsFromText } from "./text.js";
import { prepare, transcribePrepared, wordsFromWhisper, AsrError, llmStops } from "./asr.js";
import { toCsv, toJson, download } from "./exporter.js";
import { citedDocx, toSession, fromSession, parseStampedText, youtubeId } from "./report.js";
import { t, tOpt, has, num, setLang, getLang, srcLabel, LANGS } from "./i18n.js";

const CFG = window.ATHAR_CONFIG || {};
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const HAS_AR = /[ء-ي]/;
const scriptOf = s => (HAS_AR.test(s || "") ? "ar" : "en");
const dirOf = s => (scriptOf(s) === "ar" ? "rtl" : "ltr");
/** text in the other script than the interface (an Arabic source label in the English page, …) says so to browsers and screen readers */
const mixed = (e, text) => { const sc = scriptOf(text); if (sc !== getLang()) { e.lang = sc; e.dir = sc === "ar" ? "rtl" : "ltr"; } return e; };
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } } };
const later = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 120 }) : setTimeout(fn, 16));
const reducedMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

const STATUS_ORDER = ["verbatim", "partial", "meaning", "lead", "notfound"];
const EN_PACKS = ["en-quran", "en-hadith"];
const MEANING_CUES = ["quran", "hadith", "saying"];

// ---------------- engine worker (RPC) ----------------
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let seq = 0; const pending = new Map();
worker.onmessage = ev => {
  const p = pending.get(ev.data.id); if (!p) return;
  if (ev.data.progress != null) { p.onProgress && p.onProgress(ev.data.progress); return; }
  pending.delete(ev.data.id);
  ev.data.ok ? p.resolve(ev.data.result) : p.reject(ev.data.code ? new AsrError(ev.data.code, "", ev.data.scope, ev.data.retryAfter) : new Error(ev.data.error));
};
worker.onerror = e => { e.preventDefault && e.preventDefault(); for (const p of pending.values()) p.reject(new Error(e.message || "worker error")); pending.clear(); };
const call = (type, payload = {}, onProgress) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, type, ...payload });
});

// ---------------- state ----------------
const S = {
  run: 0, cur: null,                    // the analysis in progress or on screen; anything older must not touch the page
  words: [], ledger: [], hidden: new Set(), review: {}, reviewKey: "", hasTimes: false, duration: 0,
  title: "", titleKey: null, audioUrl: null, noAudio: "", warnings: [], openState: new Map(), sel: null,
  info: null, corpus: "loading", corpusErr: "", samplesFailed: false,
  err: null, busy: null, packNote: null,
  meaning: { state: "idle", done: 0, total: 0, hit: 0 },
};
let corpusReady = null;

/** a message kept as {key, args} so that it follows the interface language; an argument may be a function evaluated when shown */
const msg = (key, ...args) => ({ key, args });
const say = m => t(m.key, ...m.args.map(a => (typeof a === "function" ? a() : a)));
/** a technical detail (from the worker or the network) put in words the reader can use */
function detail(e) {
  const m = String((e && e.message) || e || "");
  const f = m.match(/([\w./-]+\.(?:json|bin))\s*\((\d{3})\)/);
  if (f) return t("err.file", f[1], f[2]);
  if (/failed to fetch|networkerror|load failed|network/i.test(m)) return t("err.network");
  return !m || (HAS_AR.test(m) && getLang() === "en") ? t("err.generic") : m;
}
/** the sentence for a failed request to the Worker. A 429 names the limit that answered (scope) and, for the hourly one, how long to wait. */
function asrMsg(e) {
  if (!(e instanceof AsrError)) return msg("err.analysis", () => detail(e));
  if (e.code === "rate_limited" && e.scope === "hour") return msg("asr.err.rate_limited.hour", () => num(Math.min(60, Math.max(1, Math.ceil((e.retryAfter || 3600) / 60)))));
  const key = "asr.err." + e.code + (e.scope && has(`asr.err.${e.code}.${e.scope}`) ? "." + e.scope : "");
  return has(key) && e.code !== "unknown" ? msg(key) : msg("asr.err.unknown", e.detail || "—");
}

function showError(m) { S.err = m; const e = $("startErr"); e.textContent = say(m); e.hidden = false; }
function clearError() { S.err = null; $("startErr").hidden = true; }
function screen(name) { for (const n of ["start", "busy", "results"]) $(n).hidden = n !== name; $("btnNew").hidden = name === "start"; }
function busy(frac, m) { S.busy = m || S.busy; screen("busy"); $("busyBar").style.width = Math.round(100 * frac) + "%"; if (S.busy) $("busyMsg").textContent = say(S.busy); }

// ---------------- runs: one analysis at a time, and a superseded one never reaches the screen ----------------
function cancelRun() {
  S.run++;
  if (S.cur) { S.cur.ctl.abort(); if (S.meaning.state === "running") call("cancel").catch(() => {}); }
  S.cur = null;
}
function beginRun() { cancelRun(); S.cur = { id: S.run, ctl: new AbortController() }; clearError(); return S.cur; }
const live = run => run.id === S.run;
function fail(run, m) { if (!live(run)) return; cancelRun(); screen("start"); showError(m); }

function stopAudio() {
  const a = $("audio");
  a.pause(); a.removeAttribute("src"); a.load(); a.hidden = true;        // removing the attribute alone leaves the media playing
  if (S.audioUrl) { URL.revokeObjectURL(S.audioUrl); S.audioUrl = null; }
  lastNow = -1;
  $("videoFrame").removeAttribute("src"); $("video").hidden = true; S.video = null;
}
function goStart() {
  cancelRun(); stopAudio(); clearError(); screen("start"); window.scrollTo(0, 0);
  $("startTitle").focus({ preventScroll: true });
}

// ---------------- language ----------------
function applyLang(l) {
  setLang(l); store.set("athar:lang", getLang());
  const other = getLang() === "ar" ? "en" : "ar", b = $("btnLang");
  b.textContent = other === "en" ? "English" : "العربية"; b.lang = other;
  drawCorpusState();
  $("dropMain").textContent = t(CFG.asrUrl ? "drop.on" : "drop.off"); $("dropSub").textContent = t(CFG.asrUrl ? "drop.on2" : "drop.off2");
  $("corpusRetry").textContent = t("corpus.retry");
  $("samplesErr").hidden = !S.samplesFailed; $("samplesErr").textContent = S.samplesFailed ? t("err.samples") : "";
  drawPackLabels();
  if (S.err) $("startErr").textContent = say(S.err);
  if (S.busy) $("busyMsg").textContent = say(S.busy);
  if (!$("results").hidden) render();
}

// ---------------- boot ----------------
function drawCorpusState() {
  const box = $("corpusState");
  box.classList.toggle("ready", S.corpus === "ready"); box.classList.toggle("failed", S.corpus === "failed");
  $("corpusMsg").textContent = S.corpus === "ready" ? t("corpus.ready", num(S.info.quran), num(S.info.hadith)) : S.corpus === "failed" ? t("corpus.fail", detail(S.corpusErr)) : t("corpus.loading");
  $("corpusRetry").hidden = S.corpus !== "failed";
  $("btnAnalyzeText").disabled = S.corpus !== "ready";
}
function loadCorpus() {
  S.corpus = "loading"; $("corpusBar").style.width = "0"; drawCorpusState();
  // resolves to null on failure (never rejects): the failure is shown with a retry button, and analyses check for null
  corpusReady = call("load", { base: new URL("../data/", import.meta.url).href }, p => { $("corpusBar").style.width = Math.round(100 * p) + "%"; })
    .then(info => { S.info = info; S.corpus = "ready"; drawCorpusState(); drawPacks(info.packs || []); return info; },
      e => { S.info = null; S.corpus = "failed"; S.corpusErr = e.message; drawCorpusState(); return null; });
}

function boot() {
  const repo = String(CFG.repo || "");
  if (/^https?:\/\/[^/]+\/[^/]+/.test(repo)) { $("repoLink").href = repo; $("repoLink").hidden = false; }      // a bare host ("https://github.com/") is a placeholder, not a link
  $("btnLang").onclick = () => applyLang(getLang() === "ar" ? "en" : "ar");
  $("corpusRetry").onclick = loadCorpus;
  loadCorpus();

  if (!CFG.asrUrl) { $("drop").classList.add("off"); $("file").disabled = true; }
  fetch(new URL("../samples/manifest.json", import.meta.url)).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(list => {
    for (const s of list) {
      const b = el("button", "sample"); b.type = "button"; b.dir = dirOf(s.title); b.lang = scriptOf(s.title);
      b.append(el("b", null, s.title), el("small", null, s.note));
      b.onclick = () => runSample(s);
      $("samples").append(b);
    }
  }).catch(() => { S.samplesFailed = true; $("samplesErr").textContent = t("err.samples"); $("samplesErr").hidden = false; });

  // the value is cleared so that choosing the same file again (after an error, or with another language) starts again
  $("file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) runAudio(f); };
  $("transcriptFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) runTranscriptFile(f); };
  const drop = $("drop");
  drop.ondragover = e => { e.preventDefault(); if (CFG.asrUrl) drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); if (CFG.asrUrl && e.dataTransfer.files[0]) runAudio(e.dataTransfer.files[0]); };
  $("btnAnalyzeText").onclick = () => {
    const x = $("paste").value.trim(); if (x.length < 20) return showError(msg("err.short"));
    const link = $("videoUrl").value.trim(), video = link ? youtubeId(link) : null;
    if (link && !video) return showError(msg("err.video"));
    const run = beginRun(); busy(0.3, msg("busy.search"));
    runWords(run, parseStampedText(x) || wordsFromText(x), { titleKey: "pasted", video });      // a transcript copied with its timestamps keeps them
  };
  const dlg = $("limits");
  $("btnLimits").onclick = () => dlg.showModal();
  dlg.onclick = e => { if (e.target !== dlg) return; const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close(); };
  $("btnNew").onclick = goStart;
  $("btnCsv").onclick = () => download("athar-ledger.csv", toCsv(S.ledger, activeReviews()), "text/csv;charset=utf-8");
  $("btnJson").onclick = () => download("athar-ledger.json", toJson(S.ledger, activeReviews(), { source: titleNow(), words: S.words.length }), "application/json");
  $("btnPrint").onclick = () => window.print();
  $("btnDocx").onclick = () => {
    const { bytes } = citedDocx({ words: S.words, ledger: S.ledger, reviews: activeReviews(), title: titleNow(), date: new Date().toLocaleDateString(getLang() === "ar" ? "ar-EG" : "en-GB", { year: "numeric", month: "long", day: "numeric" }) });
    download("athar-cited.docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  };
  $("btnSave").onclick = () => download("athar-session.json", toSession({ words: S.words, title: titleNow(), review: S.review,
    packs: [...packs.values()].filter(p => p.state === "loaded").map(p => p.id), video: S.video ? "https://youtu.be/" + S.video : null }), "application/json");
  $("btnMeaning").onclick = runMeaning;
  const a = $("audio");
  a.ontimeupdate = onTime;
  a.onloadedmetadata = () => { if (isFinite(a.duration)) { S.duration = Math.max(S.duration, a.duration); placeMarks(); } };
  a.onerror = () => {      // a file the browser cannot play (the transcription may still have worked)
    if (!a.getAttribute("src") || a.hidden) return;
    a.hidden = true; S.noAudio = "na.broken";
    if (!S.warnings.some(w => w.key === "warn.audio")) S.warnings.push(msg("warn.audio"));
    drawNotices(); drawNoAudio();
  };
  $("packAskYes").onclick = () => { const ids = packsWanted(); $("packAsk").hidden = true; ids.forEach(id => loadPack(id)); };
  $("packAskNo").onclick = () => { store.set("athar:packs", []); $("packAsk").hidden = true; };
  window.addEventListener("beforeprint", beforePrint); window.addEventListener("afterprint", afterPrint);
  // sticky offsets follow the real height of the player (it grows when an audio file is attached and on narrow screens)
  const setPlayerH = () => { const h = $("player").offsetHeight; if (h) document.documentElement.style.setProperty("--player-h", h + "px"); };
  if (window.ResizeObserver) new ResizeObserver(setPlayerH).observe($("player")); else window.addEventListener("resize", setPlayerH);
  mapRove = rove($("map"), ".mark", () => ({ next: ["ArrowRight", "ArrowDown"], prev: ["ArrowLeft", "ArrowUp"] }));
  trRove = rove($("transcript"), ".c", () => ($("transcript").dir === "rtl" ? { next: ["ArrowLeft", "ArrowDown"], prev: ["ArrowRight", "ArrowUp"] } : { next: ["ArrowRight", "ArrowDown"], prev: ["ArrowLeft", "ArrowUp"] }));
  wireMap(); wireTranscript();
  const saved = store.get("athar:lang", null);
  applyLang(LANGS.includes(saved) ? saved : (navigator.language || "ar").startsWith("ar") ? "ar" : "en");
}

/** One tab stop for a whole group; the arrow keys, Home and End move inside it. */
function rove(box, sel, keys) {
  const items = () => [...box.querySelectorAll(sel)].filter(x => !x.hidden && !x.hasAttribute("data-off"));
  const stop = e => { box.querySelectorAll(sel + '[tabindex="0"]').forEach(x => { if (x !== e) x.tabIndex = -1; }); if (e) e.tabIndex = 0; };
  box.addEventListener("keydown", ev => {
    const cur = ev.target.closest(sel); if (!cur || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const k = keys(), list = items(), i = list.indexOf(cur);
    const j = k.next.includes(ev.key) ? Math.min(list.length - 1, i + 1) : k.prev.includes(ev.key) ? Math.max(0, i - 1) : ev.key === "Home" ? 0 : ev.key === "End" ? list.length - 1 : -1;
    if (j < 0 || !list[j]) return;
    ev.preventDefault(); stop(list[j]); list[j].focus();
  });
  box.addEventListener("focusin", ev => { const cur = ev.target.closest(sel); if (cur) stop(cur); });
  return { reset() { const list = items(), cur = box.querySelector(sel + '[tabindex="0"]'); if (!cur || !list.includes(cur)) stop(list[0] || null); } };
}
let mapRove = null, trRove = null;

// ---------------- packs (books, translations) ----------------
const packs = new Map();      // id -> {id, ar, en, mb, lab, cb, state: "none"|"loading"|"loaded", promise}
const packFail = new Map();   // id -> technical detail of the last failed load (cleared when the pack loads)
let packQueue = Promise.resolve(), packFails = 0;
const packName = id => { const p = packs.get(id); return !p ? id : getLang() === "en" && p.en ? p.en : p.ar; };
const packsChosen = () => store.get("athar:packs", []).filter(id => typeof id === "string");
const packsWanted = () => packsChosen().filter(id => packs.has(id) && packs.get(id).state === "none");
function choose(id, on) { const cur = new Set(packsChosen()); on ? cur.add(id) : cur.delete(id); store.set("athar:packs", [...cur]); }

/** Load a pack (once). Resolves to true when it is loaded, false when it failed; never rejects. */
function loadPack(id) {
  const p = packs.get(id); if (!p) return Promise.resolve(false);
  if (p.state !== "none") return p.promise;
  p.state = "loading"; p.cb.checked = true; p.lab.classList.add("loading");
  p.promise = packQueue.then(() => call("loadPack", { pack: id })).then(() => {
    p.state = "loaded"; p.lab.classList.remove("loading"); packFail.delete(id); return true;
  }, e => {
    p.state = "none"; p.cb.checked = false; p.lab.classList.remove("loading"); packFail.set(id, e.message); packFails++;
    if (!$("start").hidden) showError(msg("err.pack", () => packName(id), () => detail(e)));
    return false;
  });
  packQueue = p.promise.then(() => {});
  return p.promise;
}
function drawPacks(list) {
  $("packList").textContent = ""; packs.clear();
  if (!list.length) return;
  $("packs").hidden = false;
  for (const pk of list) {
    const lab = el("label", "pack"); lab.dataset.id = pk.id;
    const cb = el("input"); cb.type = "checkbox"; cb.value = pk.id;
    lab.append(cb, el("span", null, ""), el("small", null, ""));
    const p = { id: pk.id, ar: pk.lang === "en" ? pk.domain_ar : pk.title, en: pk.lang === "en" ? pk.title : "", lab, cb, state: "none", promise: null,
      mb: Math.round(pk.bytes / 1e6 + (pk.id === "tafsir" ? 5 : pk.id === "en-hadith" ? 9 : pk.id === "en-quran" ? 3 : 1)) };
    packs.set(pk.id, p);
    cb.onchange = () => {
      choose(pk.id, cb.checked);
      if (cb.checked) { S.packNote = null; loadPack(pk.id); }
      else S.packNote = p.state === "none" ? null : msg("pack.unticked", () => packName(pk.id));    // what is loaded stays until the page is reloaded
      $("packAsk").hidden = true; drawPackLabels();
    };
    $("packList").append(lab);
  }
  // packs chosen on an earlier visit are large: they are offered, not downloaded silently
  $("packAsk").hidden = !packsWanted().length;
  drawPackLabels();
}
function drawPackLabels() {
  for (const p of packs.values()) {
    const name = packName(p.id), sp = p.lab.querySelector("span");
    sp.textContent = name; sp.removeAttribute("lang"); sp.removeAttribute("dir"); mixed(sp, name);
    p.lab.querySelector("small").textContent = t("mb", num(p.mb));
  }
  const want = packsWanted();
  $("packAskMsg").textContent = t("pack.ask", num(want.reduce((a, id) => a + packs.get(id).mb, 0)));
  $("packAskYes").textContent = t("pack.ask.yes"); $("packAskNo").textContent = t("pack.ask.no");
  $("packNote").hidden = !S.packNote; $("packNote").textContent = S.packNote ? say(S.packNote) : "";
}
const looksEnglish = words => { let latin = 0; const n = Math.min(words.length, 400); for (let i = 0; i < n; i++) if (/^[^ء-ي]*[A-Za-z]/.test(words[i].w)) latin++; return latin >= 0.3 * n; };

// ---------------- inputs ----------------
async function runSample(s) {
  const run = beginRun();
  busy(0.2, msg("busy.sample"));
  let x;
  try {
    const r = await fetch(new URL("../" + s.transcript, import.meta.url), { signal: run.ctl.signal });
    if (!r.ok) throw new Error(`${s.transcript} (${r.status})`);
    x = await r.json();
    if (!x || !Array.isArray(x.words)) throw new Error("bad sample");
  } catch (e) { return fail(run, msg("err.sample", () => detail(e))); }
  if (!live(run)) return;
  await runWords(run, x.words, { title: s.title, estimated: true });
}

async function runAudio(file) {
  const run = beginRun(), signal = run.ctl.signal, mode = $("recLang").value, two = mode === "en+ar";
  busy(0.02, msg("busy.prep"));
  const progress = (base, span) => (f, m) => { if (live(run)) busy(base + span * f, m && m.code ? msg(m.code, ...(m.args || []).map(num)) : null); };
  let words, extra = null; const warnings = [];
  try {
    const prep = await prepare(file, progress(0.02, 0.06), signal);      // a long recording is decoded once and reused by both passes
    words = await transcribePrepared(prep, mode === "ar" ? "ar" : "en", CFG, progress(0.08, two ? 0.36 : 0.72), signal);
    if (!live(run)) return;
    if (!words.length) throw new AsrError("empty");
    if (two) {   // a second pass in Arabic: English speech comes out as noise the engine ignores, recitation comes out as Arabic
      busy(0.45, msg("busy.pass2"));
      try { extra = await transcribePrepared(prep, "ar", CFG, progress(0.45, 0.35), signal); }
      catch (e) { if (!live(run)) return; const m = asrMsg(e); extra = null; warnings.push(msg("warn.pass2", () => say(m))); }
    }
    prep.pcm = null;
  } catch (e) { return fail(run, asrMsg(e)); }
  if (!live(run)) return;
  await runWords(run, words, { title: file.name, audioFile: file, extra, warnings });
}

class InputError extends Error { constructor(key) { super(key); this.key = key; } }
const isNum = x => typeof x === "number" && Number.isFinite(x);
/** one transcript word from JSON -> {w, start?, end?}, or null. Times are kept only when both are real numbers. */
function cleanWord(x) {
  const raw = typeof x === "string" ? x : x && typeof x === "object" ? x.w ?? x.word ?? x.text : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return x && isNum(x.start) && isNum(x.end) ? { w: raw.trim(), start: x.start, end: x.end } : { w: raw.trim() };
}
function wordsFromJson(j) {
  let out = null;
  if (Array.isArray(j)) out = j.map(cleanWord).filter(Boolean);
  else if (j && typeof j === "object") {
    if (Array.isArray(j.words)) out = j.words.map(cleanWord).filter(Boolean);
    if (!out || !out.length) out = wordsFromWhisper(j);
  }
  return out && out.length ? out : null;
}
const CUE = /(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?[ \t]*-->[ \t]*(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?[^\n]*\n([\s\S]*?)(?=\n[ \t]*\n|$)/g;
function parseTimed(text, name) {
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const head = text.trimStart(), json = /\.json$/i.test(name);
  if (json || head.startsWith("{") || head.startsWith("[")) {      // a .txt may simply begin with a bracket ("[موسيقى] …"): JSON is tried, not assumed
    let j, ok = true;
    try { j = JSON.parse(head); } catch { ok = false; }
    const w = ok ? wordsFromJson(j) : null;
    if (w) return w;
    if (json) throw new InputError("err.json");
  }
  const out = []; let m, any = false;
  const sec = (h, mi, s, ms) => (+(h || 0)) * 3600 + +mi * 60 + +s + +("0." + (ms || "0"));
  CUE.lastIndex = 0;
  while ((m = CUE.exec(text))) {
    any = true;
    const a = sec(m[1], m[2], m[3], m[4]), b = sec(m[5], m[6], m[7], m[8]);
    const ws = m[9].replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean), d = (b - a) / Math.max(1, ws.length);
    ws.forEach((w, i) => out.push({ w, start: a + i * d, end: a + (i + 1) * d }));
  }
  if (any) return out;
  // no cue could be read: analyse as plain text, without the subtitle scaffolding (header, cue numbers, timing lines)
  if (/\.(vtt|srt)$/i.test(name) || /^WEBVTT/.test(head) || text.includes("-->"))
    text = text.split("\n").filter(l => !/^\s*(WEBVTT.*|NOTE.*|\d+|.*-->.*)\s*$/.test(l)).join("\n").replace(/<[^>]+>/g, " ");
  return wordsFromText(text);
}
async function runTranscriptFile(file) {
  const run = beginRun();
  busy(0.2, msg("busy.read"));
  let words;
  let text;
  try { text = await file.text(); } catch { return fail(run, msg("err.transcript")); }
  if (!live(run)) return;
  // a session saved from the results screen: the same words are analysed again and the saved verdicts are put back
  if (/"athar_session"/.test(text.slice(0, 200))) {
    let sess = null; try { sess = fromSession(JSON.parse(text)); } catch { sess = null; }
    if (!sess || sess.words.length < 4) return fail(run, msg("err.session"));
    await corpusReady; if (!live(run)) return;
    for (const id of sess.packs) if (packs.has(id) && packs.get(id).state === "none") loadPack(id);
    return runWords(run, sess.words, { title: sess.title || file.name, review: sess.review, video: youtubeId(sess.video) });
  }
  try { words = parseTimed(text, file.name); }
  catch (e) { return fail(run, msg(e instanceof InputError ? e.key : "err.transcript")); }
  await runWords(run, words, { title: file.name });
}

/** entries found by the Arabic pass of an English recording: keep real textual matches, placed on the main transcript by time */
function mergeSecondPass(main, second, words) {
  const textual = e => e.status === "verbatim" || e.status === "partial";
  const at = time => { let lo = 0, hi = words.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if ((words[m].start ?? 0) <= time) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  const out = [...main];
  for (const e of second) {
    if (!textual(e) || e.start == null || !HAS_AR.test(e.spoken)) continue;
    if (main.some(m => textual(m) && m.start != null && m.start < e.end + 1.5 && m.end > e.start - 1.5 && m.source && e.source && m.source.ref === e.source.ref)) continue;
    out.push({ ...e, wordStart: at(e.start), wordEnd: Math.max(at(e.start), at(e.end)), pass: "ar" });
  }
  out.sort((a, b) => (a.start ?? a.wordStart) - (b.start ?? b.wordStart));
  out.forEach((e, i) => { e.id = i + 1; });
  return out;
}

/** the common path of every input. `run` was started (and the busy screen shown) before the first await. */
async function runWords(run, words, { title = "", titleKey = null, audioFile = null, estimated = false, extra = null, warnings = [], review = null, video = null }) {
  words = (Array.isArray(words) ? words : []).map(cleanWord).filter(Boolean);
  if (words.length < 4) return fail(run, msg("err.tooshort"));
  if (extra) extra = extra.map(cleanWord).filter(Boolean);
  let ledger;
  try {
    if (S.corpus !== "ready") busy(0.3, msg("busy.corpus"));
    const info = await corpusReady;
    if (!live(run)) return;
    if (!info) return fail(run, msg("corpus.fail", () => detail(S.corpusErr)));
    // books the user ticked that are still downloading; one that fails stops the analysis instead of silently narrowing it
    const failsBefore = packFails;
    if ([...packs.values()].some(p => p.state === "loading")) busy(0.4, msg("busy.packs"));
    await packQueue;
    if (!live(run)) return;
    if (packFails > failsBefore) { const [id, why] = [...packFail.entries()].pop(); return fail(run, msg("err.pack.required", () => packName(id), () => detail(why))); }
    // English speech needs the English translations: without them the ledger would be wrong, so a failed load stops the analysis
    if (looksEnglish(words) && EN_PACKS.every(id => packs.has(id))) {
      if (!EN_PACKS.every(id => packs.get(id).state === "loaded")) busy(0.5, msg("busy.en"));
      const ok = await Promise.all(EN_PACKS.map(loadPack));
      if (!live(run)) return;
      const bad = EN_PACKS.find((id, i) => !ok[i]);
      if (bad) return fail(run, msg("err.pack.required", () => packName(bad), () => detail(packFail.get(bad))));
    }
    busy(0.85, msg("busy.search"));
    ledger = (await call("analyze", { words })).ledger;
    if (!live(run)) return;
    if (extra && extra.length) {
      const second = (await call("analyze", { words: extra })).ledger;
      if (!live(run)) return;
      ledger = mergeSecondPass(ledger, second, words);
    }
  } catch (e) { return fail(run, msg("err.analysis", () => detail(e))); }

  // ---- from here on this run owns the screen
  stopAudio();
  S.words = words; S.title = title; S.titleKey = titleKey; S.hidden = new Set(); S.openState = new Map(); S.sel = null;
  S.hasTimes = words.some(w => w.start != null);
  let dur = 0; if (S.hasTimes) for (const w of words) { const x = w.end ?? w.start; if (x > dur) dur = x; }      // (no spread: transcripts can be very long)
  S.duration = S.hasTimes ? dur : words.length;
  S.ledger = ledger.map(e => ({ ...e, key: `${e.pass || "m"}:${e.wordStart}-${e.wordEnd}` }));
  S.reviewKey = "athar:review:" + fnv1a(words.map(w => w.w).join(" "));
  S.review = store.get(S.reviewKey, {}); if (!S.review || typeof S.review !== "object") S.review = {};
  if (review) { S.review = { ...S.review, ...review }; store.set(S.reviewKey, S.review); }      // verdicts that came with a saved session
  S.warnings = [...warnings];
  for (const id of packFail.keys()) S.warnings.push(msg("warn.pack", () => packName(id)));
  S.meaning = { state: "idle", done: 0, total: 0, hit: 0 };
  const a = $("audio");
  if (audioFile) { S.audioUrl = URL.createObjectURL(audioFile); a.src = S.audioUrl; a.hidden = false; S.noAudio = ""; }
  else S.noAudio = !S.hasTimes ? "na.notimes" : estimated ? "na.est" : video ? "na.video" : "na.file";
  if (video && !audioFile) { S.video = video; $("videoFrame").src = "https://www.youtube-nocookie.com/embed/" + video; $("video").hidden = false; }
  S.busy = null;
  render(); screen("results"); window.scrollTo(0, 0);
  $("summaryLine").focus({ preventScroll: true });
}

// ---------------- optional: quotations by meaning ----------------
const meaningTargets = () => S.ledger.filter(e => ["notfound", "meaning"].includes(e.status) && !e.meaningVia && MEANING_CUES.includes(e.cue));
function drawMeaningBtn() {
  const b = $("btnMeaning"), m = S.meaning;
  b.hidden = !(CFG.llm && CFG.asrUrl && (m.state !== "idle" || meaningTargets().length));
  b.disabled = m.state !== "idle";
  b.textContent = m.state === "running" ? t("meaning.run", num(m.done), num(m.total)) : m.state === "done" ? (m.hit ? t("meaning.hit", num(m.hit), num(m.total)) : t("meaning.none")) : t("meaning.start");
}
function meaningWhy(e) {
  if (e.code === "rate_limited" && e.scope === "hour") return msg("meaning.why.rate_limited.hour", () => num(Math.min(60, Math.max(1, Math.ceil((e.retryAfter || 3600) / 60)))));
  const key = "meaning.why." + e.code + (e.scope && has(`meaning.why.${e.code}.${e.scope}`) ? "." + e.scope : "");
  return msg(has(key) ? key : "meaning.why.other");
}
async function runMeaning() {
  const run = S.cur; if (!run || S.meaning.state !== "idle") return;
  const targets = meaningTargets(), m = S.meaning;
  m.state = "running"; m.total = targets.length; m.done = 0; m.hit = 0; drawMeaningBtn();
  for (const e of targets) {
    m.done++; drawMeaningBtn();
    let r = null;
    let stop = null;
    try { r = await call("meaning", { entry: e, cfg: { asrUrl: CFG.asrUrl } }); } catch (x) { if (llmStops(x)) stop = x; /* otherwise leave the entry as it is */ }
    if (!live(run)) return;                         // "New analysis" (or another analysis) stops the loop; nothing more is asked or drawn
    if (stop) {                                     // a limit was reached or the helper is unavailable: say so, ask nothing more
      m.done--; const why = meaningWhy(stop);
      S.warnings.push(msg("warn.meaning", () => num(m.done), () => num(m.total), () => say(why))); drawNotices();
      break;
    }
    if (r) { const was = e.status; Object.assign(e, r, { key: e.key, id: e.id }); m.hit++; refreshEntry(e, was); }
  }
  m.state = "done"; drawMeaningBtn();
}

// ---------------- reviews: a verdict belongs to the finding it was given for ----------------
const sig = e => `${e.status}|${e.source ? e.source.ref : ""}`;
function reviewOf(e) {
  const r = S.review[e.key];
  if (!r || typeof r !== "object" || (!r.v && !r.note)) return { cur: null, stale: null };
  return r.sig === sig(e) ? { cur: r, stale: null } : { cur: null, stale: r };       // same place in the transcript, another result: kept visible, not counted
}
function saveReview(e, patch) {
  const { cur } = reviewOf(e);
  const r = { v: cur ? cur.v || null : null, note: cur ? cur.note || "" : "", ...patch, sig: sig(e) };
  S.review[e.key] = r; store.set(S.reviewKey, S.review);
  return r;
}
function activeReviews() {
  const out = {};
  for (const e of S.ledger) { const { cur } = reviewOf(e); if (cur) out[e.key] = { v: cur.v || null, note: cur.note || "" }; }
  return out;
}

// ---------------- drawing ----------------
const pos = e => (S.hasTimes ? e.start ?? 0 : e.wordStart);
const posEnd = e => (S.hasTimes ? e.end ?? e.start ?? 0 : e.wordEnd + 1);
const kindOf = e => (e.source && e.source.type === "b" ? t("kind.book", getLang() === "ar" ? e.source.domainAr : e.source.domain) : tOpt("kind." + (e.type || "h")));
const titleNow = () => (S.titleKey ? t(S.titleKey) : S.title);
const sep = () => (getLang() === "ar" ? "، " : ", ");
const markTitle = e => `${S.hasTimes ? fmtTime(e.start) : t("e.word", num(e.wordStart + 1))} — ${t("status." + e.status)}${e.source ? " — " + srcLabel(e.source, true) : ""}`;

function render() {
  drawNotices(); drawNoAudio(); drawSummary(); drawMap(); drawLedger(); drawTranscript(); drawMeaningBtn();
}
function drawNoAudio() { $("noAudio").hidden = !S.noAudio; $("noAudio").textContent = S.noAudio ? t(S.noAudio) : ""; }
function drawNotices() {
  const box = $("notices"); box.textContent = "";
  for (const w of S.warnings) box.append(el("li", null, say(w)));
  box.hidden = !S.warnings.length;
}

/** summary sentence and filter chips. Chips are updated in place, so the one that has the focus keeps it. */
function drawSummary() {
  const counts = {}; for (const e of S.ledger) counts[e.status] = (counts[e.status] || 0) + 1;
  const parts = STATUS_ORDER.filter(s => counts[s]).map(s => `${num(counts[s])} ${t("short." + s)}`).join(sep());
  $("summaryLine").textContent = S.ledger.length ? t("sum.line", titleNow(), num(S.ledger.length), parts) : t("sum.none", titleNow());
  const f = $("filters");
  for (const s of STATUS_ORDER) {
    let c = f.querySelector(`[data-s="${s}"]`);
    if (!counts[s]) { if (c) c.remove(); S.hidden.delete(s); continue; }
    if (!c) {
      c = el("button", "chip s-" + s); c.type = "button"; c.dataset.s = s; c.style.setProperty("--c", `var(--${s})`);
      c.onclick = () => toggleStatus(s);
      const after = STATUS_ORDER.slice(STATUS_ORDER.indexOf(s) + 1).map(x => f.querySelector(`[data-s="${x}"]`)).find(Boolean);
      f.insertBefore(c, after || null);
    }
    c.textContent = `${t("status." + s)} (${num(counts[s])})`;
    c.setAttribute("aria-pressed", String(!S.hidden.has(s)));
  }
}
/** show / hide one status: nothing is rebuilt, so focus, open details, typed notes and the selection all stay */
function toggleStatus(s) {
  S.hidden.has(s) ? S.hidden.delete(s) : S.hidden.add(s);
  const off = S.hidden.has(s);
  $("filters").querySelector(`[data-s="${s}"]`).setAttribute("aria-pressed", String(!off));
  for (const li of $("ledger").querySelectorAll(`.entry.s-${s}`)) li.hidden = off;
  for (const b of $("map").querySelectorAll(`.mark.s-${s}`)) b.hidden = off;
  for (const c of $("transcript").querySelectorAll(`.c.s-${s}`)) c.toggleAttribute("data-off", off);
  afterVisibility();
}
function afterVisibility() {
  const L = $("ledger"), all = $("allHidden");
  if (all) all.hidden = !(S.ledger.length && S.ledger.every(e => S.hidden.has(e.status)));
  const was = L.querySelector(".entry.first"), now = L.querySelector(".entry:not([hidden])");
  if (was && was !== now) was.classList.remove("first");
  if (now) now.classList.add("first");
  mapRove.reset(); trRove.reset();
}

function drawMap() {
  const m = $("map"); m.textContent = ""; m.style.direction = "ltr";
  const frag = document.createDocumentFragment();
  for (const e of S.ledger) {
    const b = el("button", "mark s-" + e.status + (e.id === S.sel ? " on" : "")); b.type = "button"; b.tabIndex = -1;
    b.dataset.id = e.id; b.hidden = S.hidden.has(e.status);
    b.title = markTitle(e); b.setAttribute("aria-label", b.title);
    frag.append(b);
  }
  const ph = el("div", "playhead"); ph.id = "playhead"; frag.append(ph);
  m.append(frag);
  placeMarks(); mapRove.reset();
}
function placeMarks() {
  const D = Math.max(S.duration, 1);
  for (const b of $("map").querySelectorAll(".mark")) {
    const e = S.ledger[b.dataset.id - 1]; if (!e) continue;
    b.style.left = (100 * pos(e) / D) + "%"; b.style.width = Math.max(0.35, 100 * (posEnd(e) - pos(e)) / D) + "%";
  }
  $("mapEnd").textContent = S.hasTimes ? fmtTime(D) : t("words", num(S.words.length));
  $("mapStart").textContent = S.hasTimes ? "0:00" : "";
}
function wireMap() {
  const m = $("map");
  m.addEventListener("click", ev => {
    const b = ev.target.closest(".mark");
    if (b) { const e = S.ledger[b.dataset.id - 1]; if (e) focusEntry(e, true); return; }
    if (!S.hasTimes || $("audio").hidden) return;
    const r = m.getBoundingClientRect(); $("audio").currentTime = Math.max(S.duration, 1) * (ev.clientX - r.left) / r.width;
  });
}

// ---- pieces of an entry
function wordSpan(d) {
  const said = d.spokenDisplay || d.spoken;      // the word as transcribed when the worker could tie it to the transcript
  if (d.kind === "exact") return document.createTextNode(said + " ");
  const cls = { asr: "w-asr", near: "w-near", diff: "w-diff", ins: "w-ins" }[d.kind] || "";
  const s = el("span", cls, said); if (d.source) s.title = d.sourceDisplay || d.source;
  const f = document.createDocumentFragment(); f.append(s, " "); return f;
}
/** the source side of one compared word. `text` is the verbatim display word for the Qur'an, the stored word otherwise. */
function sourceSpan(d, text) {
  if (!text) return null;
  if (d.kind === "exact" || d.kind === "asr") return document.createTextNode(text + " ");
  const s = el("span", d.kind === "del" ? "w-del" : d.kind === "diff" ? "w-diff" : "w-near", text); if (d.spoken) s.title = d.spokenDisplay || d.spoken;
  const f = document.createDocumentFragment(); f.append(s, " "); return f;
}
function sourceLine(s, main) {
  const p = el("p", "src"), label = srcLabel(s);
  p.append(mixed(el("span", main ? "src-main" : null, label), label));
  if (s.heading) { const h = s.heading.length > 70 ? s.heading.slice(0, 70) + "…" : s.heading; p.append(mixed(el("span", "agree", h), h)); }
  if (s.url) {
    const quran = s.url.includes("quran.com");
    // a sunnah.com address without a hadith in it opens a book or the whole collection: the link text says so
    const level = quran ? "hadith" : s.linkLevel || (/^https:\/\/sunnah\.com\/[^/:]+\/?$/.test(s.url) ? "collection" : "hadith");
    const a = el("a", null, t(quran ? "e.open.q" : level === "book" ? "e.open.h.book" : level === "collection" ? "e.open.h.collection" : "e.open.h"));
    a.href = s.url; a.target = "_blank"; a.rel = "noopener"; p.append(a);
  }
  return p;
}
const textBlock = (text, cls = "") => { const p = el("p", cls, text); const d = dirOf(text); p.classList.add(d); p.dir = d; p.lang = scriptOf(text); return p; };
/** Qur'an text, verbatim: an opening basmala is a line of its own above verse 1 (unnumbered), then the verses with their numbers */
function quranBlock(s, cls = "", limitWords = 0) {
  const f = document.createDocumentFragment();
  if (s.basmala) { const b = el("p", "basmala", s.basmala); b.dir = "rtl"; b.lang = "ar"; f.append(b); }
  let text = s.display || "";
  if (limitWords) { const ws = text.split(" "); if (ws.length > limitWords) text = ws.slice(0, limitWords).join(" ") + " …"; }
  f.append(textBlock(text, cls));
  return f;
}
const isQuran = s => !!(s && s.type === "q" && s.display);
function candBlock(k) {
  const c = el("div", "cand"); c.append(sourceLine(k, false));
  c.append(isQuran(k) ? quranBlock(k) : textBlock(k.excerpt || ""));        // a verse is always shown as it is written, never as search words
  if (k.translation && getLang() === "en" && (isQuran(k) || dirOf(k.excerpt) === "rtl")) c.append(textBlock(k.translation.text));
  return c;
}
function details(e, name, summary, ...children) {
  const d = el("details"); d.append(el("summary", null, summary), ...children.filter(Boolean));
  const k = e.key + "/" + name;
  if (S.openState.has(k)) d.open = S.openState.get(k);
  d.addEventListener("toggle", () => { if (!printing && !d.dataset.p) S.openState.set(k, d.open); });      // what the reader opened stays open across redraws
  return d;
}
const edition = (ed, hadith) => (hadith || !ed || ed === "sunnah.com" ? null : ed);      // hadith translations: the dataset names no translator

function drawEntry(e) {
  const li = el("li", "entry s-" + e.status + (e.id === S.sel ? " on" : "")); li.id = "e" + e.id; li.dataset.id = e.id; li.hidden = S.hidden.has(e.status);
  const head = el("div", "entry-head");
  const tb = el("button", "time" + (S.hasTimes ? "" : " none"), S.hasTimes ? fmtTime(e.start) : t("e.word", num(e.wordStart + 1))); tb.type = "button";
  tb.onclick = () => focusEntry(e, false, true);
  head.append(tb, el("span", "kind", kindOf(e)), el("span", "status", t("status." + e.status)));
  if (e.agreement != null && e.counts) {
    const c = e.counts, n = c.exact + c.asr + c.near + c.diff + c.added + c.omitted;
    const bits = [t("e.agree", num(Math.round(e.agreement * 100)), num(n))];
    if (c.asr + c.near) bits.push(t("e.asr", num(c.asr + c.near)));
    if (c.diff + c.added + c.omitted) bits.push(t("e.wording", num(c.diff + c.added + c.omitted)));
    head.append(el("span", "agree", bits.join(sep())));
  }
  li.append(head);

  const src = e.source, viaEn = src && src.via === "en", srcQ = isQuran(src) && !viaEn;
  const hasDiff = e.diff && e.diff.some(d => d.kind !== "exact");
  // part of a verse recited without any difference: shown as said, next to the words of the verse it matches (never the whole verse as if it had been said)
  const partQ = srcQ && e.diff && !hasDiff && e.diffWhole === false;
  if (e.diff && (hasDiff || partQ)) {
    const pair = el("div", "pair"), dir = dirOf(e.diff.find(d => d.spoken)?.spoken || e.spoken), lang = dir === "rtl" ? "ar" : "en";
    const sp = el("p", "spoken " + dir); sp.dir = dir; sp.lang = lang; e.diff.forEach(d => d.spoken && sp.append(wordSpan(d)));
    pair.append(el("span", null, t("e.spoken")), sp);
    if (srcQ && !e.diffDisplay) {
      // the words could not be tied one-to-one to the written verse: show the verse whole and untouched, differences marked on the spoken line only
      pair.append(el("span", null, t("e.source.full")), quranBlock(src, "source-text"));
    } else {
      if (srcQ && src.basmala && e.diffFromStart) { const b = el("p", "basmala", src.basmala); b.dir = "rtl"; b.lang = "ar"; pair.append(el("span", null, t("e.source")), b); }
      const so = el("p", "source-text " + dir); so.dir = dir; so.lang = lang;
      for (const d of e.diff) {
        const n = sourceSpan(d, srcQ ? d.sourceDisplay : d.source); if (n) so.append(n);
        if (srcQ && d.ayahEnd) so.append(el("span", "ayah-no", `﴿${d.ayahEnd}﴾`), " ");
      }
      if (srcQ && src.basmala && e.diffFromStart) pair.append(so); else pair.append(el("span", null, t("e.source")), so);
    }
    li.append(pair);
  } else if (srcQ && e.status === "verbatim") li.append(quranBlock(src, "spoken"));
  else li.append(textBlock(e.spoken, "spoken"));
  if (e.excerpt && typeof e.excerpt === "object") {
    if (e.excerpt.head) li.append(el("p", "note", t("note.excerpt_head")));
    if (e.excerpt.tail && !e.tailUnmatched) li.append(el("p", "note", t("note.excerpt_tail")));
  }
  if (e.tailUnmatched) li.append(el("p", "note", t("note.tail_unmatched", e.tailUnmatchedSpoken || "")));

  if (e.status === "meaning" && e.meaningVia === "llm" && src) {
    li.append(sourceLine(src, true));
    const c = el("div", "cand"), strength = tOpt("strength." + e.meaningStrengthCode) || e.meaningStrength || "";
    c.append(el("span", null, t("e.incorpus", strength)), isQuran(src) ? quranBlock(src) : textBlock(e.meaningText || "")); li.append(c);
  } else if (e.status === "meaning" && e.candidates) {
    li.append(el("p", "note", t("note.meaning_lex")));
    e.candidates.slice(0, 3).forEach(k => li.append(candBlock(k)));
  } else if (src) li.append(sourceLine(src, true));

  if (viaEn) {
    const ed = edition(src.edition, src.type === "h");
    li.append(el("p", "note", ed ? t("e.via", ed) : t("e.via.h")));
    if (isQuran(src)) li.append(details(e, "arabic", t("e.arabic"), quranBlock(src, "cand-text", 120)));
    else if (src.arabic) li.append(details(e, "arabic", t("e.arabic"), textBlock(src.arabic.split(" ").length > 120 ? src.arabic.split(" ").slice(0, 120).join(" ") + " …" : src.arabic, "cand-text")));
  } else if (src && src.translation && e.status !== "notfound") {
    const ed = edition(src.translation.edition, src.type === "h");
    const d = details(e, "translation", ed ? t("e.translation", ed) : t("e.translation.h"), textBlock(src.translation.text));
    if (getLang() === "en" && !S.openState.has(e.key + "/translation")) d.open = true;
    li.append(d);
  }
  const note = e.noteCode ? tOpt("note." + e.noteCode) : "";
  if (e.status === "notfound") {
    li.append(el("p", "note", note || t("note.notfound")));
    if (e.reference) {
      const label = srcLabel(e.reference);
      li.append(el("p", "note ok", t("e.reference", label)));
      li.append(candBlock({ ...e.reference, excerpt: e.reference.display || "" }));
    }
    if (e.suggestions && e.suggestions.length) li.append(details(e, "suggest", t(e.suggestions[0].via === "hybrid" ? "e.suggest.hybrid" : "e.suggest.lexical"), ...e.suggestions.map(candBlock)));
  } else if (note) li.append(el("p", "note", note));
  if (e.attribution) {
    const a = tOpt("attr." + e.attribution.code);       // a code this page does not know yet shows nothing rather than a raw key
    if (a) li.append(el("p", "note " + (e.attribution.code === "collection_other_wording" ? "" : e.attribution.agrees ? "ok" : "warn"), a));
  }
  if (src && src.type === "h" && src.matnOnly === false && e.status !== "meaning" && !viaEn) li.append(el("p", "note", t("note.isnad")));

  const linkOrText = p => { const x = el("li"), label = srcLabel(p); if (p.url) { const a = mixed(el("a", null, label), label); a.href = p.url; a.target = "_blank"; a.rel = "noopener"; x.append(a); } else { x.textContent = label; mixed(x, label); } return x; };
  if (e.parallels && e.parallels.length) { const ul = el("ul"); e.parallels.slice(0, 30).forEach(p => ul.append(linkOrText(p))); li.append(details(e, "parallels", t("e.parallels", num(e.parallels.length)), ul)); }
  if (e.inBooks && e.inBooks.length) { const ul = el("ul"); e.inBooks.forEach(p => ul.append(mixed(el("li", null, p.label), p.label))); li.append(details(e, "inbooks", t("e.inbooks", num(e.inBooks.length)), ul)); }
  if (e.tafsir && e.tafsir.length) li.append(details(e, "tafsir", t("e.tafsir"), ...e.tafsir.map(x => { const c = el("div", "cand"); c.append(el("span", null, t("e.ayah", num(x.ayah))), textBlock(x.text)); return c; })));
  const graded = [src, ...(e.parallels || [])].filter(s => s && s.grades && s.grades.length);
  if (graded.length && e.status !== "notfound") {
    const ul = el("ul");
    graded.slice(0, 6).forEach(s => {
      const x = el("li"), g = s.grades.map(k => `${k.by}: ${k.grade}`).join("؛ ");
      x.append(`${srcLabel(s, true)} — ${t("e.grades.line")}: `, mixed(el("span", null, g), g));
      ul.append(x);
    });
    li.append(details(e, "grades", t("e.grades"), el("p", "note", t("e.grades.note")), ul));
  }

  li.append(drawReview(e));
  return li;
}
function drawReview(e) {
  const rv = el("div", "review"); rv.append(el("span", null, t("rv.label")));
  const { cur, stale } = reviewOf(e);
  const printed = el("span", "rv-print");
  const sync = () => {     // the pressed button, and the same verdict as text for the printed report
    const { cur } = reviewOf(e), v = cur && cur.v, noteText = cur && cur.note;
    rv.querySelectorAll(".rv").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === v)));
    printed.textContent = [v ? t("rv." + v) : "", noteText || ""].filter(Boolean).join(" — ");
    rv.classList.toggle("blank", !v && !noteText);
    const old = rv.querySelector(".rv-stale"); if (old && cur) old.remove();
  };
  for (const v of ["yes", "no", "unsure"]) {
    const b = el("button", "rv", t("rv." + v)); b.type = "button"; b.dataset.v = v;
    b.onclick = () => { const { cur } = reviewOf(e); saveReview(e, { v: cur && cur.v === v ? null : v }); sync(); };
    rv.append(b);
  }
  const note = el("input"); note.type = "text"; note.placeholder = t("rv.note"); note.value = cur ? cur.note || "" : ""; note.setAttribute("aria-label", t("rv.note")); note.dir = "auto";
  note.oninput = () => { saveReview(e, { note: note.value }); sync(); };
  rv.append(note, printed);
  if (stale) {      // a verdict given to another result at this place in the transcript: shown, never applied
    const was = [stale.v && has("rv." + stale.v) ? t("rv." + stale.v) : t("rv.stale.none"), stale.note || ""].filter(Boolean).join(" — ");
    rv.append(el("p", "rv-stale", `${t("rv.stale")}: ${was}`));
  }
  sync();
  return rv;
}

/** The ledger is drawn a screenful first and the rest in slices, so a long one shows at once. */
let ledgerJob = 0, flushLedger = () => {};
function drawLedger() {
  const L = $("ledger"), job = ++ledgerJob, n = S.ledger.length; L.textContent = "";
  L.classList.toggle("big", n > 40);
  if (!n) { L.append(el("li", "empty", t("empty.none"))); flushLedger = () => {}; return; }
  const all = el("li", "empty", t("empty.hidden")); all.id = "allHidden"; all.hidden = true; L.append(all);
  let i = 0;
  const slice = k => { const f = document.createDocumentFragment(); for (const end = Math.min(n, i + k); i < end; i++) f.append(drawEntry(S.ledger[i])); L.insertBefore(f, all); };
  const more = () => { if (job !== ledgerJob || i >= n) return; slice(40); afterVisibility(); later(more); };
  flushLedger = () => { if (job === ledgerJob && i < n) { slice(n); afterVisibility(); } };
  slice(24); afterVisibility();
  if (i < n) later(more);
}
/** after "by meaning" changed one entry: redraw that row only, and its mark, its words in the transcript and the counts */
function refreshEntry(e, was) {
  const li = $("e" + e.id);
  if (li) {
    const focusables = "button, input, summary, a", idx = li.contains(document.activeElement) ? [...li.querySelectorAll(focusables)].indexOf(document.activeElement) : -1;
    const fresh = drawEntry(e); li.replaceWith(fresh);
    if (idx >= 0) { const x = fresh.querySelectorAll(focusables)[idx]; if (x) x.focus({ preventScroll: true }); }
  }
  const b = $("map").querySelector(`.mark[data-id="${e.id}"]`);
  if (b) { b.classList.replace("s-" + was, "s-" + e.status); b.title = markTitle(e); b.setAttribute("aria-label", b.title); b.hidden = S.hidden.has(e.status); }
  for (const c of $("transcript").querySelectorAll(`.c[data-id="${e.id}"]`)) { c.classList.replace("s-" + was, "s-" + e.status); c.setAttribute("aria-label", t("tr.cite", num(e.id), markTitle(e))); c.toggleAttribute("data-off", S.hidden.has(e.status)); }
  drawSummary(); afterVisibility();
}

/** transcript: plain words, and each citation's words wrapped in one focusable element that leads to its entry.
 *  The words are laid out in paragraphs (cut after a sentence end when there is one, never inside a citation), so that
 *  a change in one place does not make the browser lay out a whole lecture again. */
const TR_BLOCK = 220, TR_BLOCK_MIN = 110, SENTENCE_END = /[.!?؟…]["'»”)]*$/;
let trJob = 0;
function drawTranscript() {
  const T = $("transcript"), job = ++trJob, n = S.words.length; T.textContent = "";
  const sample = S.words.slice(0, 40).map(w => w.w).join(" "); T.dir = dirOf(sample); T.lang = scriptOf(sample);
  T.classList.toggle("big", n > 3000);
  const owner = new Array(n).fill(null);
  for (const e of S.ledger) for (let i = Math.max(0, e.wordStart); i <= Math.min(e.wordEnd, n - 1); i++) owner[i] = e;
  const word = i => { const s = el("span", i === lastNow ? "now" : null, S.words[i].w); s.dataset.i = i; return s; };
  let i = 0, block = null, inBlock = 0;
  const slice = k => {
    const f = document.createDocumentFragment(), end = Math.min(n, i + k);
    while (i < end) {
      if (!block) { block = el("p", "tb"); inBlock = 0; f.append(block); }
      const e = owner[i], from = i;
      if (!e) { block.append(word(i), " "); i++; }
      else {
        const c = el("span", "c s-" + e.status + (e.id === S.sel ? " on" : "")); c.dataset.id = e.id; c.tabIndex = -1;
        c.setAttribute("role", "button"); c.setAttribute("aria-label", t("tr.cite", num(e.id), markTitle(e)));
        if (S.hidden.has(e.status)) c.setAttribute("data-off", "");
        for (let first = true; i < n && owner[i] === e; i++, first = false) { if (!first) c.append(" "); c.append(word(i)); }
        block.append(c, " ");
      }
      inBlock += i - from;
      if (inBlock >= TR_BLOCK || (inBlock >= TR_BLOCK_MIN && SENTENCE_END.test(S.words[i - 1].w))) block = null;
    }
    T.append(f);
  };
  const more = () => { if (job !== trJob || i >= n) return; slice(8000); later(more); };
  slice(6000); trRove.reset();
  if (i < n) later(more);
}
function wireTranscript() {
  const T = $("transcript");
  const act = (c, w) => {
    const e = c && !c.hasAttribute("data-off") ? S.ledger[c.dataset.id - 1] : null;
    if (e) focusEntry(e, true);
    else if (w && S.hasTimes && !$("audio").hidden) $("audio").currentTime = S.words[w.dataset.i].start || 0;
  };
  T.addEventListener("click", ev => act(ev.target.closest(".c"), ev.target.closest("[data-i]")));
  T.addEventListener("keydown", ev => { const c = ev.target.closest(".c"); if (c && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); act(c, null); } });
}

/** select an entry: the entry is what gets centred on the page; the transcript only scrolls inside its own box */
function focusEntry(e, scroll, play) {
  S.sel = e.id;
  document.querySelectorAll(".entry.on, .mark.on, .transcript .c.on").forEach(x => x.classList.remove("on"));
  let li = $("e" + e.id); if (!li) { flushLedger(); li = $("e" + e.id); }
  if (li) { li.classList.add("on"); if (scroll && !li.hidden) centre(li); }
  const mk = $("map").querySelector(`.mark[data-id="${e.id}"]`); if (mk) mk.classList.add("on");
  const T = $("transcript");
  T.querySelectorAll(`.c[data-id="${e.id}"]`).forEach(c => c.classList.add("on"));
  const w = T.querySelector(`[data-i="${e.wordStart}"]`);
  if (w) {       // never scrollIntoView: that would move the page
    const go = () => { if (S.sel === e.id && w.isConnected) T.scrollTop += w.getBoundingClientRect().top - T.getBoundingClientRect().top - T.clientHeight / 2; };
    go(); if (T.classList.contains("big")) requestAnimationFrame(go);      // paragraphs not laid out yet get their real height once reached
  }
  const a = $("audio");
  if (S.hasTimes && !a.hidden && e.start != null) { a.currentTime = Math.max(0, e.start - 0.4); if (play) a.play().catch(() => {}); }
  if (play && S.video && S.hasTimes && e.start != null) $("videoFrame").src = `https://www.youtube-nocookie.com/embed/${S.video}?start=${Math.max(0, Math.floor(e.start - 1))}&autoplay=1`;
}
function centre(li) {
  const big = $("ledger").classList.contains("big");
  const go = behavior => {
    const ph = $("player").offsetHeight, r = li.getBoundingClientRect(), room = window.innerHeight - ph;
    const dy = r.height >= room - 24 ? r.top - ph - 12 : r.top - ph - (room - r.height) / 2;       // a row taller than the screen is aligned by its top
    if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior });
  };
  if (big || reducedMotion()) { go("auto"); requestAnimationFrame(() => requestAnimationFrame(() => go("auto"))); }      // rows not laid out yet change height once reached
  else go("smooth");
}

let lastNow = -1;
function onTime() {
  const a = $("audio"), time = a.currentTime, ph = $("playhead");
  if (a.hidden || !a.getAttribute("src")) return;
  if (ph) { ph.style.display = "block"; ph.style.left = (100 * time / Math.max(S.duration, 1)) + "%"; }
  let lo = 0, hi = S.words.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if ((S.words[m].start ?? 0) <= time) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k === lastNow) return;
  const T = $("transcript"); const old = T.querySelector(".now"); if (old) old.classList.remove("now");
  const cur = T.querySelector(`[data-i="${k}"]`); if (cur) cur.classList.add("now");
  lastNow = k;
}

// ---------------- print: the whole report, with everything a reader may have left folded ----------------
let printing = false;
function beforePrint() {
  printing = true; flushLedger();
  for (const d of document.querySelectorAll("#ledger details:not([open])")) { d.dataset.p = "1"; d.open = true; }
}
function afterPrint() {
  for (const d of document.querySelectorAll("#ledger details[data-p]")) d.open = false;
  // "toggle" events arrive later: the marks are cleared after them so that this opening and closing is not remembered as the reader's
  setTimeout(() => { for (const d of document.querySelectorAll("#ledger details[data-p]")) delete d.dataset.p; printing = false; }, 300);
}

boot();
