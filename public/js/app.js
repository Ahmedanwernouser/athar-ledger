// app.js — the page. All matching runs in js/worker.js; this file only draws and listens.
import { fmtTime, fnv1a, wordsFromText } from "./text.js";
import { prepare, transcribeWith, transcribePrepared, wordsFromWhisper, asrProviders, AsrError, llmStops } from "./asr.js";
import { compareLedgers, applyAgreement, marksOf, statusOf, timeTolerance } from "./agree.js";
import { toCsv, toJson, download } from "./exporter.js";
import { citedDocx, toSession, fromSession, parseStampedText, youtubeId, cleanManual, cleanFixes, committeeSummary, summaryLines, descriptionIndex } from "./report.js";
import { t, tOpt, has, num, setLang, getLang, srcLabel, transcriberLabel, LANGS } from "./i18n.js";

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
  // the reviewer's own work on this transcript (kept in localStorage next to the verdicts, and in a saved session)
  fixes: {},            // word index -> corrected text ("" = the word is removed). S.words always holds the words as transcribed
  manual: [],           // citations the reviewer added: {a, b, ref, status, src}
  extra: null,          // the words of the second (Arabic) transcription pass, kept for analysing again after a correction
  onlyOpen: false, keepOpen: new Set(),      // "not reviewed yet" filter; entries reviewed while it is on stay until it is toggled
  fixKey: "", manualKey: "", reworking: false, focusAfter: null,
  // two transcriptions of the same recording (agree.js)
  asr: null,            // what the Worker offers: {default, available} from /health, or null (one transcriber, no choice)
  second: null,         // {words, ledger}: the second transcript and its ledger (analysed once; corrections touch the primary only)
  transcribers: [],     // who produced the transcript(s): [{provider, model, name}], the primary first
  two: null,            // counts of the last comparison (compareLedgers().stats), or null when there was none
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
  cancelRun(); stopAudio(); clearError(); screen("start"); window.scrollTo(0, 0); $("selAct").hidden = true;
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
  drawPackLabels(); drawProviders();
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
  else asrProviders(CFG).then(a => { S.asr = a; drawProviders(); });       // asked once, never waited for
  $("asrProv").onchange = () => store.set("athar:asrprov", $("asrProv").value);
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
  $("transcriptFile").onchange = e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length === 1) runTranscriptFile(fs[0]); else if (fs.length > 1) runTwoTranscripts(fs); };
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
  dlg.onclick = function (e) { if (e.target !== this) return; const r = this.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.close(); };
  $("btnNew").onclick = goStart;
  for (const d of document.querySelectorAll("dialog")) if (d !== dlg) d.onclick = dlg.onclick;       // a click on the backdrop closes
  $("btnCsv").onclick = () => download("athar-ledger.csv", toCsv(S.ledger, activeReviews()), "text/csv;charset=utf-8");
  $("btnJson").onclick = () => download("athar-ledger.json", toJson(S.ledger, activeReviews(), { source: titleNow(), words: S.words.length, corrections: fixCount() ? { ...S.fixes } : undefined,
    transcribers: S.transcribers.length ? S.transcribers.map(transcriberLabel) : undefined, twoTranscriptions: S.two || undefined }), "application/json");
  $("btnPrint").onclick = () => window.print();
  $("btnDocx").onclick = () => {
    const { bytes } = citedDocx({ words: shownWords(), ledger: S.ledger, reviews: activeReviews(), title: titleNow(), fixed: fixCount(), transcribers: S.transcribers.map(transcriberLabel),
      mushaf: !$("optMushafWrap").hidden && $("optMushaf").checked,
      hadithText: !$("optHadithWrap").hidden && $("optHadith").checked,
      date: new Date().toLocaleDateString(getLang() === "ar" ? "ar-EG" : "en-GB", { year: "numeric", month: "long", day: "numeric" }) });
    download("athar-cited.docx", bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  };
  $("optMushaf").onchange = () => store.set("athar:mushaf", $("optMushaf").checked);
  $("optHadith").onchange = () => store.set("athar:hadithtext", $("optHadith").checked);
  $("btnSave").onclick = () => download("athar-session.json", toSession({ words: S.words, title: titleNow(), review: S.review, manual: S.manual, fixes: S.fixes, words2: S.second ? S.second.words : null, transcribers: S.transcribers,
    packs: [...packs.values()].filter(p => p.state === "loaded").map(p => p.id), video: S.video ? "https://youtu.be/" + S.video : null }), "application/json");
  $("btnIndex").onclick = openIndex;
  $("indexIntro").onchange = () => { store.set("athar:idxintro", $("indexIntro").checked); drawIndex(); };
  $("indexCopy").onclick = copyIndex;
  $("btnKeys").onclick = () => $("keys").showModal();
  $("chipOpen").onclick = toggleOpen;
  $("btnSearch").onclick = () => openLookup(null, "");
  $("csearch").onsubmit = ev => { ev.preventDefault(); openLookup(null, $("csearchQ").value.trim()); };
  $("lookupForm").onsubmit = ev => { ev.preventDefault(); runLookup(); };
  $("lookupAdjust").onclick = ev => { const b = ev.target.closest("button[data-edge]"); if (b) adjustLookup(b.dataset.edge, +b.dataset.d); };
  $("lookupClashOpen").onclick = () => { const e = LK.clash; $("lookup").close(); if (e && S.ledger.includes(e)) selectAndFocus(e); };
  $("btnUndoFixes").onclick = () => { if (!fixCount() || S.reworking) return; S.fixes = {}; store.set(S.fixKey, S.fixes); S.focusAfter = { origin: "bar" }; reanalyse(); };
  document.addEventListener("keydown", onShortcut);
  wireSelection(); wireLedger();
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

/** the transcriber choice: shown only when the Worker says it offers more than one; "both" only when two are there */
function drawProviders() {
  const wrap = $("asrProvWrap"), sel = $("asrProv"), a = S.asr;
  const offered = a && a.available.length > 1 ? [...a.available, "both"] : [];
  wrap.hidden = !offered.length;
  if (!offered.length) return;
  const was = sel.options.length ? sel.value : store.get("athar:asrprov", null);
  sel.textContent = "";
  for (const v of offered) { const o = el("option", null, t("prov." + v)); o.value = v; sel.append(o); }
  sel.value = offered.includes(was) ? was : a.default;
}
/** null (the Worker's default, nothing chosen) | "groq" | "gemini" | "both" */
const providerChoice = () => ($("asrProvWrap").hidden || !S.asr ? null : $("asrProv").value || null);

async function runAudio(file) {
  const run = beginRun(), signal = run.ctl.signal, mode = $("recLang").value, two = mode === "en+ar", lang = mode === "ar" ? "ar" : "en";
  const choice = providerChoice(), dual = choice === "both";
  const pA = dual ? S.asr.default : choice, pB = dual ? S.asr.available.find(p => p !== pA) : null;
  busy(0.02, msg("busy.prep"));
  // in a comparison every progress message says whose it is
  const progress = (base, span, who = null) => (f, m) => {
    if (!live(run)) return;
    const inner = m && m.code ? msg(m.code, ...(m.args || []).map(num)) : null;
    busy(base + span * f, inner && who ? msg("busy.prov", () => transcriberLabel({ provider: who }), () => say(inner)) : inner);
  };
  const named = (r, asked) => ({ provider: r.provider || asked || "", model: r.model || "" });
  let words, extra = null, second = null; const warnings = [], transcribers = [];
  try {
    // a long recording is decoded once and reused by every pass and by both transcribers
    const prep = await prepare(file, progress(0.02, 0.06), signal, dual ? [pA, pB] : [pA]);
    const share = dual ? 0.3 : two ? 0.36 : 0.72;
    let first = null, firstErr = null, primary = pA;
    try {
      first = await transcribeWith(prep, lang, CFG, progress(0.08, share, dual ? pA : null), signal, pA);
      if (!first.words.length) throw new AsrError("empty");
    } catch (e) { if (!dual || !live(run) || (e instanceof AsrError && e.code === "aborted")) throw e; first = null; firstErr = e; }
    if (!live(run)) return;
    if (dual) {
      let other = null, otherErr = null;
      try {
        other = await transcribeWith(prep, lang, CFG, progress(0.08 + share, share, pB), signal, pB);
        if (!other.words.length) throw new AsrError("empty");
      } catch (e) { if (!live(run) || (e instanceof AsrError && e.code === "aborted")) throw e; other = null; otherErr = e; }
      if (!live(run)) return;
      if (!first && !other) throw firstErr;
      if (!first) {       // the default transcriber failed and the other one worked: it becomes the transcript
        const why = asrMsg(firstErr);
        warnings.push(msg("warn.two.primary", () => transcriberLabel({ provider: pA }), () => say(why), () => transcriberLabel({ provider: pB })));
        first = other; other = null; primary = pB;
      } else if (!other) {
        const why = asrMsg(otherErr);
        warnings.push(msg("warn.two.failed", () => transcriberLabel({ provider: pB }), () => say(why), () => transcriberLabel({ provider: pA })));
      }
      if (other) { second = other.words; transcribers.push(named(first, primary), named(other, pB)); }
      else transcribers.push(named(first, primary));
      if (other && other.estimated) warnings.push(msg("warn.est", () => transcriberLabel(named(other, pB))));
    } else if (first.provider || pA) transcribers.push(named(first, pA));
    words = first.words;
    if (first.estimated) { const who = named(first, primary); warnings.push(msg("warn.est", () => transcriberLabel(who))); }
    if (two) {   // a second pass in Arabic: English speech comes out as noise the engine ignores, recitation comes out as Arabic
      const at = dual ? 0.08 + 2 * share : 0.45, span = dual ? 0.12 : 0.35;      // (with two transcribers: on the primary one only)
      busy(at, msg("busy.pass2"));
      try { extra = await transcribePrepared(prep, "ar", CFG, progress(at, span), signal, primary); }
      catch (e) { if (!live(run)) return; const m = asrMsg(e); extra = null; warnings.push(msg("warn.pass2", () => say(m))); }
    }
    prep.pcm = null;
  } catch (e) { return fail(run, asrMsg(e)); }
  if (!live(run)) return;
  await runWords(run, words, { title: file.name, audioFile: file, extra, warnings, second, transcribers });
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
    return runWords(run, sess.words, { title: sess.title || file.name, review: sess.review, video: youtubeId(sess.video), manual: sess.manual, fixes: sess.fixes,
      second: sess.words2, transcribers: sess.transcribers });
  }
  try { words = parseTimed(text, file.name); }
  catch (e) { return fail(run, msg(e instanceof InputError ? e.key : "err.transcript")); }
  await runWords(run, words, { title: file.name });
}
/**
 * Two transcripts of the same recording chosen together: the first is the transcript, the second is compared with it.
 * (This needs no Worker: it is also how the comparison is tried with transcripts made elsewhere.) Both must carry times.
 */
async function runTwoTranscripts(files) {
  const run = beginRun();
  busy(0.2, msg("busy.read"));
  if (files.length !== 2) return fail(run, msg("err.two.files"));
  const both = [];
  for (const f of files) {
    let text; try { text = await f.text(); } catch { return fail(run, msg("err.transcript")); }
    if (!live(run)) return;
    if (/"athar_session"/.test(text.slice(0, 200))) return fail(run, msg("err.two.files"));
    let words; try { words = parseTimed(text, f.name); } catch (e) { return fail(run, msg(e instanceof InputError ? e.key : "err.transcript")); }
    words = words.map(cleanWord).filter(Boolean);
    if (words.length < 4 || !words.every(w => w.start != null)) return fail(run, msg("err.two.files"));
    both.push(words);
  }
  await runWords(run, both[0], { title: files[0].name, second: both[1], transcribers: files.map(f => ({ provider: "file", model: "", name: f.name })) });
}

/** entries only the second transcription has: placed on the transcript by time, like those of the Arabic pass */
function mergeSecondOnly(main, extra, words) {
  const at = time => { let lo = 0, hi = words.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if ((words[m].start ?? 0) <= time) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  const out = [...main];
  for (const x of extra) {
    if (!x.placed) continue;
    const e = x.entry;
    out.push({ ...e, diff: e.diff ? e.diff.map(d => { const c = { ...d }; delete c.wordIdx; return c; }) : e.diff,      // (its words are not the words on screen)
      wordStart: at(e.start), wordEnd: Math.max(at(e.start), at(e.end)), pass: "t2", second: { wordStart: e.wordStart, wordEnd: e.wordEnd }, mushaf: undefined, sourceRun: undefined });
  }
  return out;
}
/** an entry whose spoken words are not the words on screen (they come from another transcription pass) */
const foreign = e => e.pass === "ar" || e.pass === "t2";

/** entries found by the Arabic pass of an English recording: keep real textual matches, placed on the main transcript by time */
function mergeSecondPass(main, second, words) {
  const textual = e => e.status === "verbatim" || e.status === "partial";
  const at = time => { let lo = 0, hi = words.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if ((words[m].start ?? 0) <= time) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  const out = [...main];
  for (const e of second) {
    if (!textual(e) || e.start == null || !HAS_AR.test(e.spoken)) continue;
    if (main.some(m => textual(m) && m.start != null && m.start < e.end + 1.5 && m.end > e.start - 1.5 && m.source && e.source && m.source.ref === e.source.ref)) continue;
    if (e.diff) for (const d of e.diff) delete d.wordIdx;       // these point into the second transcription, not into the words on screen
    out.push({ ...e, wordStart: at(e.start), wordEnd: Math.max(at(e.start), at(e.end)), pass: "ar", mushaf: undefined, sourceRun: undefined });
  }
  out.sort((a, b) => (a.start ?? a.wordStart) - (b.start ?? b.wordStart));
  out.forEach((e, i) => { e.id = i + 1; });
  return out;
}

// ---------------- the reviewer's corrections and additions ----------------
const isFixed = (i, fixes = S.fixes) => Object.prototype.hasOwnProperty.call(fixes, i);
/** the word as it stands now: corrected when the reviewer corrected it ("" = removed), as transcribed otherwise */
const wordAt = (i, words = S.words, fixes = S.fixes) => (isFixed(i, fixes) ? fixes[i] : words[i].w);
const fixCount = () => Object.keys(S.fixes).length;
/** the transcript with the corrections in place, one item per transcribed word (for the Word document) */
const shownWords = () => (fixCount() ? S.words.map((w, i) => (isFixed(i) ? { ...w, w: S.fixes[i] } : w)) : S.words);
/** the words of a stretch as they stand now, each with the index of the transcribed word it belongs to */
function rangeWords(a, b, words = S.words, fixes = S.fixes) {
  const out = [], idx = [];
  for (let i = Math.max(0, a); i <= Math.min(b, words.length - 1); i++) for (const x of wordAt(i, words, fixes).split(" ")) if (x) { out.push({ w: x }); idx.push(i); }
  return { words: out, idx };
}
/** what the engine is given: removed words left out, a correction of several words as several words; back[k] = transcribed word of item k */
function engineWords(words, fixes) {
  if (!Object.keys(fixes).length) return { run: words, back: null };
  const run = [], back = [];
  words.forEach((w, i) => {
    if (!isFixed(i, fixes)) { run.push(w); back.push(i); return; }
    const parts = fixes[i].split(" ").filter(Boolean), timed = w.start != null, d = timed ? ((w.end ?? w.start) - w.start) / Math.max(1, parts.length) : 0;
    parts.forEach((x, k) => { run.push(timed ? { w: x, start: w.start + k * d, end: w.start + (k + 1) * d } : { w: x }); back.push(i); });
  });
  return { run, back };
}
/** the engine's ledger for the transcript as it stands now, with every position given as an index of the transcribed words */
async function analyse(words, fixes, extra, second = null) {
  const { run, back } = engineWords(words, fixes);
  let ledger = (await call("analyze", { words: run })).ledger;
  if (back) for (const e of ledger) {
    e.wordStart = back[e.wordStart] ?? e.wordStart; e.wordEnd = back[e.wordEnd] ?? e.wordEnd;
    if (e.diff) for (const d of e.diff) if (d.wordIdx) d.wordIdx = d.wordIdx.map(k => back[k]);
  }
  // a second transcription of the same recording: the two ledgers are compared word by word (corrections are the
  // reviewer's work on the primary transcript; the second one is analysed once and compared again after each of them)
  if (second) {
    if (!second.ledger) second.ledger = (await call("analyze", { words: second.words })).ledger;
    const r = compareLedgers(ledger, second.ledger, { tolerance: Math.max(timeTolerance(words), timeTolerance(second.words)) });
    applyAgreement(ledger, r);
    ledger = mergeSecondOnly(ledger, r.extra, words);
    second.stats = r.stats;
  }
  if (extra && extra.length) ledger = mergeSecondPass(ledger, (await call("analyze", { words: extra })).ledger, words);
  return ledger;
}
const SRC_KEEP = ["type", "label", "short", "url", "collection", "ref", "surah", "ayah", "ayahEnd", "number"];
/** a ledger entry for a citation the reviewer added. `cand` is what the corpus lookup says about these words and this source (may be null). */
function manualEntry(m, cand, words = S.words, fixes = S.fixes) {
  const { words: said, idx } = rangeWords(m.a, m.b, words, fixes);
  const base = cand && cand.entry ? { ...cand.entry } : { diff: null, agreement: null, counts: null, parallels: [], inBooks: [], evidence: 0 };
  if (base.diff) {       // the lookup numbered the words of the stretch from 0
    const ok = base.diff.every(d => !d.wordIdx || d.wordIdx.every(k => idx[k] != null));
    for (const d of base.diff) if (d.wordIdx) { if (ok) d.wordIdx = d.wordIdx.map(k => idx[k]); else delete d.wordIdx; }
  }
  if (cand && cand.status) m.status = cand.status;
  if (cand && cand.source) { m.src = {}; for (const k of SRC_KEEP) if (cand.source[k] != null) m.src[k] = cand.source[k]; }
  return { ...base, manual: true, pass: "u", key: `u:${m.a}-${m.b}`, wordStart: m.a, wordEnd: m.b,
    start: words[m.a].start ?? null, end: words[m.b].end ?? words[m.b].start ?? null, spoken: said.map(w => w.w).join(" "),
    type: (cand && cand.source ? cand.source : m.src).type === "q" ? "q" : "h", status: m.status, source: cand && cand.source ? cand.source : m.src,
    cue: null, attribution: null, tailUnmatched: false, noteCode: null, note: null, reference: null, candidates: null, suggestions: null, meaningVia: null };
}
/** the reviewer's additions as ledger entries: each source is described again by the worker from its stable reference */
async function resolveManual(manual, words, fixes) {
  if (!manual.length) return [];
  let res = [];
  try { res = await call("resolve", { items: manual.map(m => ({ ref: m.ref, words: rangeWords(m.a, m.b, words, fixes).words })) }); } catch { res = []; }
  return manual.map((m, i) => manualEntry(m, res[i] || null, words, fixes));
}
/** the ledger on screen = the engine's entries and the reviewer's, in transcript order */
function setLedger(engine, added) {
  const all = [...engine, ...added];
  for (const e of all) if (!e.key) e.key = `${e.pass || "m"}:${e.wordStart}-${e.wordEnd}`;
  all.sort((a, b) => a.wordStart - b.wordStart || a.wordEnd - b.wordEnd || (a.manual ? 1 : 0) - (b.manual ? 1 : 0));
  all.forEach((e, i) => { e.id = i + 1; });
  S.ledger = all;
  hadithOption();
}
/** the Word option "verbatim hadith in the source's wording": offered for Arabic speech when some hadith can be written that way (the display text is optional data); off unless chosen */
function hadithOption() {
  const w = $("optHadithWrap"); if (!w) return;
  w.hidden = $("optMushafWrap").hidden || !S.ledger.some(e => e.sourceRun);
  $("optHadith").checked = !w.hidden && store.get("athar:hadithtext", false) === true;
}
const textual = e => e.status === "verbatim" || e.status === "partial";

/**
 * After a correction: the whole transcript is analysed again with the corrected words. The screen stays where it is —
 * verdicts (they re-attach by place and result; one whose result changed shows as an earlier review), additions, filters,
 * what was opened, the selection and the scroll position are kept.
 */
let reJob = 0;
async function reanalyse() {
  const run = S.cur; if (!run) return;
  const job = ++reJob;
  S.reworking = true; drawFixBar();
  let engine, added;
  try { engine = await analyse(S.words, S.fixes, S.extra, S.second); added = await resolveManual(S.manual, S.words, S.fixes); }
  catch (e) { if (live(run) && job === reJob) { S.reworking = false; S.warnings.push(msg("err.analysis", () => detail(e))); render(); } return; }
  if (!live(run) || job !== reJob) return;
  S.reworking = false;
  // a source a language model helped find stays with its words as long as they were not touched
  const kept = new Map(S.ledger.filter(e => e.meaningVia === "llm").map(e => [e.key + "|" + e.spoken, e]));
  engine = engine.map(e => { const k = `${e.pass || "m"}:${e.wordStart}-${e.wordEnd}|${e.spoken}`; return kept.has(k) && ["notfound", "meaning"].includes(e.status) ? kept.get(k) : e; });
  const was = S.sel ? S.ledger[S.sel - 1] : null;
  setLedger(engine, added); S.two = S.second ? S.second.stats || null : null;
  store.set(S.manualKey, S.manual);
  const now = was ? S.ledger.find(e => e.key === was.key) || S.ledger.find(e => !!e.manual === !!was.manual && e.wordStart <= was.wordEnd && e.wordEnd >= was.wordStart) : null;
  S.sel = now ? now.id : null;
  redrawInPlace();
}
/** draw everything again without moving the reader */
function redrawInPlace() {
  const y = window.scrollY, T = $("transcript"), ty = T.scrollTop, f = S.focusAfter; S.focusAfter = null;
  render(); flushLedger();
  window.scrollTo(0, y); T.scrollTop = ty;
  let to = null;
  if (f && f.origin === "ledger") to = $("ledger").querySelector(`.fw[data-i="${f.i}"]`);
  if (f && !to && f.i != null) { const w = T.querySelector(`[data-i="${f.i}"]`); to = w && w.closest(".c"); }
  if (f && !to) to = S.sel ? $("e" + S.sel) : $("summaryLine");
  if (to) { if (to.tabIndex < 0 && !to.hasAttribute("tabindex")) to.tabIndex = -1; to.focus({ preventScroll: true }); }
}

/** the common path of every input. `run` was started (and the busy screen shown) before the first await. */
async function runWords(run, words, { title = "", titleKey = null, audioFile = null, estimated = false, extra = null, warnings = [], review = null, video = null, manual = null, fixes = null, second = null, transcribers = [] }) {
  words = (Array.isArray(words) ? words : []).map(cleanWord).filter(Boolean);
  if (words.length < 4) return fail(run, msg("err.tooshort"));
  if (extra) extra = extra.map(cleanWord).filter(Boolean);
  if (second) { second = second.map(cleanWord).filter(Boolean); second = second.length >= 4 ? { words: second, ledger: null, stats: null } : null; }
  // what the reviewer did to this transcript before (in this browser, or in the saved session being opened)
  const base = fnv1a(words.map(w => w.w).join(" ")), fixKey = "athar:fixes:" + base, manualKey = "athar:manual:" + base;
  fixes = cleanFixes({ ...store.get(fixKey, {}), ...(fixes || {}) }, words.length);
  manual = cleanManual([...(manual || []), ...(Array.isArray(store.get(manualKey, [])) ? store.get(manualKey, []) : [])], words.length);
  let ledger, added;
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
    if (second) busy(0.85, msg("busy.compare"));
    ledger = await analyse(words, fixes, extra, second);
    if (!live(run)) return;
    added = await resolveManual(manual, words, fixes);
    if (!live(run)) return;
  } catch (e) { return fail(run, msg("err.analysis", () => detail(e))); }

  // ---- from here on this run owns the screen
  stopAudio();
  S.words = words; S.title = title; S.titleKey = titleKey; S.hidden = new Set(); S.openState = new Map(); S.sel = null;
  S.hasTimes = words.some(w => w.start != null);
  let dur = 0; if (S.hasTimes) for (const w of words) { const x = w.end ?? w.start; if (x > dur) dur = x; }      // (no spread: transcripts can be very long)
  S.duration = S.hasTimes ? dur : words.length;
  S.fixes = fixes; S.manual = manual; S.extra = extra; S.fixKey = fixKey; S.manualKey = manualKey;
  S.second = second; S.two = second ? second.stats : null;
  S.transcribers = (Array.isArray(transcribers) ? transcribers : []).slice(0, second ? 2 : 1);
  S.onlyOpen = false; S.keepOpen = new Set(); S.reworking = false; S.focusAfter = null;
  if (fixCount()) store.set(fixKey, fixes);
  if (manual.length) store.set(manualKey, manual);
  setLedger(ledger, added);
  S.reviewKey = "athar:review:" + base;       // (the words as transcribed: corrections do not move the reviewer's work to another key)
  S.review = store.get(S.reviewKey, {}); if (!S.review || typeof S.review !== "object") S.review = {};
  if (review) { S.review = { ...S.review, ...review }; store.set(S.reviewKey, S.review); }      // verdicts that came with a saved session
  const arabic = dirOf(words.slice(0, 40).map(w => w.w).join(" ")) === "rtl";
  $("optMushafWrap").hidden = !arabic; $("optMushaf").checked = arabic && store.get("athar:mushaf", true) !== false;
  hadithOption();
  $("indexIntro").checked = store.get("athar:idxintro", false) === true;
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
    if (!S.ledger.includes(e)) continue;            // the transcript was corrected meanwhile and this entry is no longer on screen
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
const sig = e => `${st(e)}|${e.source ? e.source.ref : ""}`;       // (the status shown: the one two transcriptions support, when there is one)
function reviewOf(e) {
  const r = S.review[e.key];
  if (!r || typeof r !== "object" || (!r.v && !r.note)) return { cur: null, stale: null };
  return r.sig === sig(e) ? { cur: r, stale: null } : { cur: null, stale: r };       // same place in the transcript, another result: kept visible, not counted
}
function saveReview(e, patch) {
  const { cur } = reviewOf(e);
  const r = { v: cur ? cur.v || null : null, note: cur ? cur.note || "" : "", ...patch, sig: sig(e) };
  S.review[e.key] = r; store.set(S.reviewKey, S.review);
  if (S.onlyOpen) S.keepOpen.add(e.key);      // it does not vanish under the reviewer's hand
  return r;
}
const reviewed = e => { const { cur } = reviewOf(e); return !!(cur && cur.v); };
/** hidden by the filters: its status is switched off, or only unreviewed entries are wanted and this one has a verdict */
const isOff = e => S.hidden.has(st(e)) || (S.onlyOpen && reviewed(e) && !S.keepOpen.has(e.key));
function activeReviews() {
  const out = {};
  for (const e of S.ledger) { const { cur } = reviewOf(e); if (cur) out[e.key] = { v: cur.v || null, note: cur.note || "" }; }
  return out;
}

// ---------------- drawing ----------------
/** the status an entry is listed, filtered, coloured and counted under (see agree.js) */
const st = statusOf;
const byTwo = e => !!(e.statusCombined && e.statusCombined !== e.status);
const pos = e => (S.hasTimes ? e.start ?? 0 : e.wordStart);
const posEnd = e => (S.hasTimes ? e.end ?? e.start ?? 0 : e.wordEnd + 1);
const kindOf = e => (e.source && e.source.type === "b" ? t("kind.book", getLang() === "ar" ? e.source.domainAr : e.source.domain) : tOpt("kind." + (e.type || "h")));
const titleNow = () => (S.titleKey ? t(S.titleKey) : S.title);
const sep = () => (getLang() === "ar" ? "، " : ", ");
const markTitle = e => `${S.hasTimes ? fmtTime(e.start) : t("e.word", num(e.wordStart + 1))} — ${t("status." + st(e))}${byTwo(e) ? " (" + t("two.tag") + ")" : ""}${e.source ? " — " + srcLabel(e.source, true) : ""}${e.manual ? " — " + t("e.manual") : ""}${e.pass === "t2" ? " — " + t("two.second") : ""}`;

function render() {
  drawNotices(); drawNoAudio(); drawTranscribers(); drawSummary(); drawMap(); drawLedger(); drawTranscript(); drawMeaningBtn(); drawFixBar(); drawIndexBtn();
}
function drawNoAudio() { $("noAudio").hidden = !S.noAudio; $("noAudio").textContent = S.noAudio ? t(S.noAudio) : ""; }
/** an Arabic counted noun (فرق واحد، فرقين، ٣ فروق، ١١ فرقًا); English has two forms */
const counted = (key, n) => t(`${key}.${n === 1 ? 1 : n === 2 ? 2 : n % 100 >= 3 && n % 100 <= 10 ? "few" : "many"}`, num(n));
/** who produced the transcript(s), and what the comparison of two of them came to */
function drawTranscribers() {
  const p = $("trBy"), names = S.transcribers.map(transcriberLabel).filter(Boolean), bits = [];
  if (S.second && names.length > 1) bits.push(t("tr.by.two", names[0], names[1]));
  else if (names.length) bits.push(t("tr.by.one", names[0]));
  else if (S.second) bits.push(t("tr.by.two.anon"));
  if (S.two) bits.push(t("two.sum", num(S.two.paired), num(S.two.textual), num(S.two.upgraded), num(S.two.confirmed), num(S.two.unresolved)));
  p.hidden = !bits.length; p.textContent = bits.join(" ");
}
function drawNotices() {
  const box = $("notices"); box.textContent = "";
  for (const w of S.warnings) box.append(el("li", null, say(w)));
  box.hidden = !S.warnings.length;
}

/** summary sentence and filter chips. Chips are updated in place, so the one that has the focus keeps it. */
function drawSummary() {
  const counts = {}; for (const e of S.ledger) counts[st(e)] = (counts[st(e)] || 0) + 1;
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
      f.insertBefore(c, after || $("chipOpen"));
    }
    c.textContent = `${t("status." + s)} (${num(counts[s])})`;
    c.setAttribute("aria-pressed", String(!S.hidden.has(s)));
  }
  drawProgress();
}
/** how far the review is, the "not reviewed yet" chip, and the committee summary: all three follow every verdict */
function drawProgress() {
  const n = S.ledger.length, done = S.ledger.filter(reviewed).length, chip = $("chipOpen");
  $("progress").hidden = !n;
  $("progressText").textContent = n ? t("pg.line", num(done), num(n)) : "";
  $("progressBar").style.width = (n ? 100 * done / n : 0) + "%";
  chip.hidden = !n; chip.textContent = t("pg.open", num(n - done)); chip.title = t("pg.open.title"); chip.setAttribute("aria-pressed", String(S.onlyOpen));
  drawCommittee();
}
function drawCommittee() {
  const box = $("committee"), list = $("committeeList"); box.hidden = !S.ledger.length; list.textContent = "";
  const lines = summaryLines(committeeSummary(S.ledger, activeReviews()));
  for (const l of lines) if (l.value != null) list.append(el("dt", null, l.label), el("dd", null, l.value));
  $("committeeRule").textContent = lines.filter(l => l.value == null).map(l => l.label).join(" ");
}
/** show only what has no verdict yet. Like the status chips: nothing is rebuilt. */
function toggleOpen() {
  S.onlyOpen = !S.onlyOpen; S.keepOpen = new Set();
  $("chipOpen").setAttribute("aria-pressed", String(S.onlyOpen));
  applyVisibility();
}
function applyVisibility() {
  flushLedger();
  for (const li of $("ledger").querySelectorAll(".entry")) { const e = S.ledger[li.dataset.id - 1]; if (e) li.hidden = isOff(e); }
  for (const b of $("map").querySelectorAll(".mark")) { const e = S.ledger[b.dataset.id - 1]; if (e) b.hidden = isOff(e); }
  for (const c of $("transcript").querySelectorAll(".c")) { const e = S.ledger[c.dataset.id - 1]; if (e) c.toggleAttribute("data-off", isOff(e)); }
  afterVisibility();
}
/** show / hide one status: nothing is rebuilt, so focus, open details, typed notes and the selection all stay */
function toggleStatus(s) {
  S.hidden.has(s) ? S.hidden.delete(s) : S.hidden.add(s);
  $("filters").querySelector(`[data-s="${s}"]`).setAttribute("aria-pressed", String(!S.hidden.has(s)));
  applyVisibility();
}
function afterVisibility() {
  const L = $("ledger"), all = $("allHidden");
  if (all) all.hidden = !(S.ledger.length && S.ledger.every(isOff));
  const was = L.querySelector(".entry.first"), now = L.querySelector(".entry:not([hidden])");
  if (was && was !== now) was.classList.remove("first");
  if (now) now.classList.add("first");
  mapRove.reset(); trRove.reset();
}

function drawMap() {
  const m = $("map"); m.textContent = ""; m.style.direction = "ltr";
  const frag = document.createDocumentFragment();
  for (const e of S.ledger) {
    const b = el("button", "mark s-" + st(e) + (e.manual ? " by-hand" : "") + (e.id === S.sel ? " on" : "")); b.type = "button"; b.tabIndex = -1;
    b.dataset.id = e.id; b.hidden = isOff(e);
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
/** one word of a "spoken" line that the reviewer can correct: it knows which transcribed word it is */
function fixable(text, i) {
  const s = el("span", "fw" + (isFixed(i) ? " fx" : ""), text); s.dataset.i = i; s.tabIndex = -1; s.setAttribute("role", "button");
  s.title = isFixed(i) ? t("fix.was", S.words[i].w) : t("fix.click");
  return s;
}
/** the words of a spoken stretch, correctable when each is tied to a transcribed word (idx), plain text otherwise */
function saidWords(text, idx) {
  const ws = text.split(" "), f = document.createDocumentFragment();
  if (!idx || idx.length !== ws.length || idx.some(i => !Number.isInteger(i) || !S.words[i])) { f.append(text); return f; }
  ws.forEach((w, k) => { if (k) f.append(" "); f.append(fixable(w, idx[k])); });
  return f;
}
/** what the second transcription has at a compared word, in words: "" when there is nothing to say */
const heardBy2 = mark => (!mark ? "" : mark.b == null ? t("two.heard.out") : mark.b === "" ? t("two.heard.none") : t("two.heard", mark.b));
/** @param mark  how the word stands after the comparison of two transcriptions (marksOf), or undefined */
function wordSpan(d, mark) {
  const said = d.spokenDisplay || d.spoken;      // the word as transcribed when the worker could tie it to the transcript
  const f = document.createDocumentFragment(), words = saidWords(said, d.spokenDisplay ? d.wordIdx : null);
  if (d.kind === "exact" && !mark) { f.append(words, " "); return f; }
  const cls = { asr: "w-asr", near: "w-near", diff: "w-diff", ins: "w-ins" }[d.kind] || "";
  const s = el("span", [cls, mark ? "ag ag-" + mark.c : ""].filter(Boolean).join(" ")); s.append(words);
  const tip = [d.source && d.kind !== "exact" ? d.sourceDisplay || d.source : "", mark ? t("two.mark." + mark.c) : "", heardBy2(mark)].filter(Boolean);
  if (tip.length) s.title = tip.join(" — ");
  s.querySelectorAll(".fw:not(.fx)").forEach(x => x.removeAttribute("title"));       // the source's word is what the mark's tooltip shows
  f.append(s, " "); return f;
}
/** a spoken stretch that is not compared word by word (not found, by meaning, a candidate, a verbatim hadith): its words can still be corrected */
function spokenBlock(e) {
  const p = textBlock("", "spoken"), d = dirOf(e.spoken); p.className = "spoken " + d; p.dir = d; p.lang = scriptOf(e.spoken);
  const r = foreign(e) ? null : rangeWords(e.wordStart, e.wordEnd);
  p.append(saidWords(e.spoken, r && r.words.map(w => w.w).join(" ") === e.spoken ? r.idx : null));
  return p;
}
/** the source side of one compared word. `text` is the verbatim display word for the Qur'an, the stored word otherwise. */
function sourceSpan(d, text, mark) {
  if (!text) return null;
  if (d.kind === "exact" || d.kind === "asr") return document.createTextNode(text + " ");
  const s = el("span", (d.kind === "del" ? "w-del" : d.kind === "diff" ? "w-diff" : "w-near") + (mark ? " ag ag-" + mark.c : ""), text);
  const tip = [d.spoken ? d.spokenDisplay || d.spoken : "", mark ? t("two.mark." + mark.c) : "", heardBy2(mark)].filter(Boolean);
  if (tip.length) s.title = tip.join(" — ");
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
/** hadith text in its original wording (diacritics, spelling as in the dataset): always Arabic, right to left, in the reading font */
const origBlock = (text, cls = "") => { const p = el("p", cls, text); p.classList.add("rtl", "orig"); p.dir = "rtl"; p.lang = "ar"; return p; };
/** a text shown up to `limit` words, with a control that shows all of it (nothing is cut in the data) */
function longBlock(text, limit, cls = "", orig = false) {
  const ws = String(text || "").split(" "), mk = x => (orig ? origBlock(x, cls) : textBlock(x, cls));
  if (ws.length <= limit) return mk(ws.join(" "));
  const f = el("div", "long"), p = mk(ws.slice(0, limit).join(" ") + " …"), b = el("button", "link more", t("e.more")); b.type = "button";
  b.onclick = () => { p.textContent = ws.join(" "); b.remove(); };
  f.append(p, b); return f;
}
/** the excerpt of a candidate source: the original wording of a hadith when the worker attached it, the stored text otherwise */
const excerptBlock = (k, cls = "") => (k.type === "h" && k.excerptDisplay ? origBlock(k.excerptDisplay, cls) : textBlock(k.excerpt || "", cls));
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
  c.append(isQuran(k) ? quranBlock(k) : excerptBlock(k));        // a verse is always shown as it is written, never as search words
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

/** one line saying what the comparison of two transcriptions found for an entry */
function twoLine(g) {
  if (!g.paired) return g.why === "other" ? t("two.unpaired.other", g.otherRef || "") : t("two.unpaired." + (g.why === "nopos" ? "nopos" : "absent"));
  const parts = [], sure = g.oneExact + (g.oneSided || 0);
  if (g.confirmed) parts.push(t("two.line.confirmed", counted("two.n.diff", g.confirmed)) + (g.confirmedNear ? " " + t("two.line.near", num(g.confirmedNear)) : ""));
  if (g.disagree) parts.push(sure === g.disagree ? t(g.disagree === 1 ? "two.line.oneexact.1" : "two.line.oneexact", counted("two.n.place", g.disagree)) : sure ? t("two.line.mixed", counted("two.n.place", g.disagree), num(sure)) : t("two.line.differ", counted("two.n.place", g.disagree)));
  if (g.unresolved) parts.push(t("two.line.unresolved", num(g.unresolved)));
  if (!parts.length) parts.push(t("two.line.same"));
  return parts.join(" ");
}
function drawEntry(e) {
  const li = el("li", "entry s-" + st(e) + (e.manual ? " by-hand" : "") + (e.id === S.sel ? " on" : "")); li.id = "e" + e.id; li.dataset.id = e.id; li.hidden = isOff(e); li.tabIndex = -1;
  const head = el("div", "entry-head");
  const tb = el("button", "time" + (S.hasTimes ? "" : " none"), S.hasTimes ? fmtTime(e.start) : t("e.word", num(e.wordStart + 1))); tb.type = "button";
  tb.onclick = () => focusEntry(e, false, true);
  head.append(tb, el("span", "kind", kindOf(e)), el("span", "status", t("status." + st(e))));
  if (byTwo(e)) { const tag = el("span", "two-tag", t("two.tag")); tag.title = t("two.tag.title", t("status." + e.status)); head.append(tag); }
  if (e.manual) head.append(el("span", "hand", t("e.manual")));
  if (e.pass === "t2") head.append(el("span", "hand", t("two.second")));
  const g2 = e.agreement2 || null, marks = marksOf(e);
  if (e.agreement != null && e.counts) {
    const c = e.counts, n = c.exact + c.asr + c.near + c.diff + c.added + c.omitted;
    const bits = [t("e.agree", num(Math.round(e.agreement * 100)), num(n))];
    if (c.asr + c.near) bits.push(t("e.asr", num(c.asr + c.near)));
    if (c.diff + c.added + c.omitted) bits.push(t("e.wording", num(c.diff + c.added + c.omitted)));
    head.append(el("span", "agree", bits.join(sep())));
  }
  li.append(head);

  const src = e.source, viaEn = src && src.via === "en", srcQ = isQuran(src) && !viaEn;
  const srcH = !!(src && src.type === "h" && !viaEn && e.diffDisplay);      // a hadith whose compared words the worker tied to the original text
  const hasDiff = e.diff && e.diff.some(d => d.kind !== "exact");
  // part of a verse recited without any difference: shown as said, next to the words of the verse it matches (never the whole verse as if it had been said)
  const partQ = srcQ && e.diff && !hasDiff && e.diffWhole === false;
  if (e.diff && (hasDiff || partQ)) {
    const pair = el("div", "pair"), dir = dirOf(e.diff.find(d => d.spoken)?.spoken || e.spoken), lang = dir === "rtl" ? "ar" : "en";
    const sp = el("p", "spoken " + dir); sp.dir = dir; sp.lang = lang; e.diff.forEach((d, i) => d.spoken && sp.append(wordSpan(d, marks.get(i))));
    pair.append(el("span", null, t("e.spoken")), sp);
    if (srcQ && !e.diffDisplay) {
      // the words could not be tied one-to-one to the written verse: show the verse whole and untouched, differences marked on the spoken line only
      pair.append(el("span", null, t("e.source.full")), quranBlock(src, "source-text"));
    } else {
      if (srcQ && src.basmala && e.diffFromStart) { const b = el("p", "basmala", src.basmala); b.dir = "rtl"; b.lang = "ar"; pair.append(el("span", null, t("e.source")), b); }
      const so = srcH ? origBlock("", "source-text") : el("p", "source-text " + dir); if (!srcH) { so.dir = dir; so.lang = lang; }
      for (let i = 0; i < e.diff.length; i++) {
        const d = e.diff[i], n = sourceSpan(d, srcQ || srcH ? d.sourceDisplay : d.source, marks.get(i)); if (n) so.append(n);
        if (srcQ && d.ayahEnd) so.append(el("span", "ayah-no", `﴿${d.ayahEnd}﴾`), " ");
      }
      if (srcQ && src.basmala && e.diffFromStart) pair.append(so); else pair.append(el("span", null, t("e.source")), so);
    }
    li.append(pair);
  } else if (srcQ && e.status === "verbatim" && !e.manual) li.append(quranBlock(src, "spoken"));
  else li.append(spokenBlock(e));
  if (e.excerpt && typeof e.excerpt === "object") {
    if (e.excerpt.head) li.append(el("p", "note", t("note.excerpt_head")));
    if (e.excerpt.tail && !e.tailUnmatched) li.append(el("p", "note", t("note.excerpt_tail")));
  }
  if (e.tailUnmatched) li.append(el("p", "note", t("note.tail_unmatched", e.tailUnmatchedSpoken || "")));
  // what a second transcription of the same recording says about these words
  if (g2) {
    li.append(el("p", "note two-line" + (g2.paired && byTwo(e) ? " ok" : ""), (byTwo(e) ? t("two.line.upgraded") + " " : "") + twoLine(g2)));
    if (g2.paired && S.second && g2.second) {
      const ws = S.second.words.slice(g2.second.wordStart, g2.second.wordEnd + 1).map(w => w.w).join(" ");
      if (ws) li.append(details(e, "second", t("two.show"), textBlock(ws, "second-text")));
    }
  }
  if (e.pass === "t2") li.append(el("p", "note", t("two.second.note")));

  if (e.status === "meaning" && e.meaningVia === "llm" && src) {
    li.append(sourceLine(src, true));
    const c = el("div", "cand"), strength = tOpt("strength." + e.meaningStrengthCode) || e.meaningStrength || "";
    c.append(el("span", null, t("e.incorpus", strength)), isQuran(src) ? quranBlock(src) : src.type === "h" && e.meaningDisplay ? origBlock(e.meaningDisplay) : textBlock(e.meaningText || "")); li.append(c);
  } else if (e.status === "meaning" && e.candidates) {
    li.append(el("p", "note", t("note.meaning_lex")));
    e.candidates.slice(0, 3).forEach(k => li.append(candBlock(k)));
  } else if (src) li.append(sourceLine(src, true));
  if (e.manual) {       // a person chose this source: say so, and show the corpus text unless it is already compared word by word above
    if (src && !(e.diff && (hasDiff || partQ))) {
      const c = el("div", "cand"), origText = src.type === "h" ? (srcH && src.display) || src.excerptDisplay || (src.original && !src.excerpt ? src.arabic : "") : "";
      const text = origText || src.excerpt || src.arabic || "";
      if (isQuran(src) || text) { c.append(el("span", null, t("e.manual.text")), isQuran(src) ? quranBlock(src) : longBlock(text, 80, "", !!origText)); li.append(c); }
    }
    li.append(el("p", "note", t("e.manual.note")));
  }

  if (viaEn) {
    const ed = edition(src.edition, src.type === "h");
    li.append(el("p", "note", ed ? t("e.via", ed) : t("e.via.h")));
    if (isQuran(src)) li.append(details(e, "arabic", t("e.arabic"), quranBlock(src, "cand-text", 120)));
    else if (src.arabic) li.append(details(e, "arabic", t("e.arabic"), longBlock(src.arabic, 120, "cand-text", !!src.original)));
  } else if (src && src.translation && e.status !== "notfound") {
    const ed = edition(src.translation.edition, src.type === "h");
    const d = details(e, "translation", ed ? t("e.translation", ed) : t("e.translation.h"), textBlock(src.translation.text));
    if (getLang() === "en" && !S.openState.has(e.key + "/translation")) d.open = true;
    li.append(d);
  }
  // the hadith as the source writes it (after the chain of narrators), for a textual match made in Arabic
  if (src && src.type === "h" && !viaEn && src.displayFull && textual(e)) li.append(details(e, "hadith", t("e.hadith.text"), longBlock(src.displayFull, 150, "cand-text", true)));
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

  const firstWord = li.querySelector(".spoken .fw"); if (firstWord) firstWord.tabIndex = 0;      // one tab stop per spoken line; the arrow keys move inside it
  li.append(drawReview(e));
  if (e.manual) { const b = el("button", "link rm", t("e.manual.remove")); b.type = "button"; b.onclick = () => removeManual(e); li.append(b); }
  else if (!textual(e) && !foreign(e)) { const b = el("button", "link find", t("e.find")); b.type = "button"; b.onclick = () => openLookup({ a: e.wordStart, b: e.wordEnd }); li.append(b); }
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
    if (rv.isConnected) drawProgress();
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
  if (b) { b.classList.replace("s-" + was, "s-" + st(e)); b.title = markTitle(e); b.setAttribute("aria-label", b.title); b.hidden = isOff(e); }
  for (const c of $("transcript").querySelectorAll(`.c[data-id="${e.id}"]`)) { c.classList.replace("s-" + was, "s-" + st(e)); c.setAttribute("aria-label", t("tr.cite", num(e.id), markTitle(e))); c.toggleAttribute("data-off", isOff(e)); }
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
  // where entries overlap, a textual match or the reviewer's own entry is what the words belong to
  for (const strong of [false, true]) for (const e of S.ledger) if ((textual(e) || !!e.manual) === strong) for (let i = Math.max(0, e.wordStart); i <= Math.min(e.wordEnd, n - 1); i++) owner[i] = e;
  const word = i => {
    const s = el("span", i === lastNow ? "now" : null, wordAt(i) || S.words[i].w); s.dataset.i = i;
    if (isFixed(i)) { s.classList.add("fx"); if (!wordAt(i)) s.classList.add("gone"); s.title = t("fix.was", S.words[i].w); }
    return s;
  };
  let i = 0, block = null, inBlock = 0;
  const slice = k => {
    const f = document.createDocumentFragment(), end = Math.min(n, i + k);
    while (i < end) {
      if (!block) { block = el("p", "tb"); inBlock = 0; f.append(block); }
      const e = owner[i], from = i;
      if (!e) { block.append(word(i), " "); i++; }
      else {
        const c = el("span", "c s-" + st(e) + (e.manual ? " by-hand" : "") + (e.id === S.sel ? " on" : "")); c.dataset.id = e.id; c.tabIndex = -1;
        c.setAttribute("role", "button"); c.setAttribute("aria-label", t("tr.cite", num(e.id), markTitle(e)));
        if (isOff(e)) c.setAttribute("data-off", "");
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
    // a word the reviewer corrected, or a word of the citation that is already selected: correct it here
    if (w && (w.classList.contains("fx") || (e && c.classList.contains("on") && !foreign(e)))) return editWord(w, +w.dataset.i, "transcript");
    if (e) focusEntry(e, true);
    else if (w && S.hasTimes && !$("audio").hidden) $("audio").currentTime = S.words[w.dataset.i].start || 0;
  };
  T.addEventListener("click", ev => {
    if (ev.target.closest(".fix-edit") || selectedStretch()) return;       // typing a correction, or the end of a selection: not a click on a word
    act(ev.target.closest(".c"), ev.target.closest("[data-i]"));
  });
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
  for (const d of document.querySelectorAll("#ledger details:not([open]), #committee:not([open])")) { d.dataset.p = "1"; d.open = true; }
}
function afterPrint() {
  for (const d of document.querySelectorAll("#ledger details[data-p], #committee[data-p]")) d.open = false;
  // "toggle" events arrive later: the marks are cleared after them so that this opening and closing is not remembered as the reader's
  setTimeout(() => { for (const d of document.querySelectorAll("#ledger details[data-p], #committee[data-p]")) delete d.dataset.p; printing = false; }, 300);
}

// ---------------- reviewer: keyboard shortcuts ----------------
const KEY_BY_CODE = { KeyJ: "j", KeyK: "k", KeyP: "p", KeyN: "n", Digit1: "1", Digit2: "2", Digit3: "3", Numpad1: "1", Numpad2: "2", Numpad3: "3" };
const KEY_BY_CHAR = { "١": "1", "٢": "2", "٣": "3", "؟": "?", ArrowDown: "j", ArrowUp: "k" };
function selectAndFocus(e, scroll = true) {
  focusEntry(e, scroll);
  const li = $("e" + e.id); if (li) li.focus({ preventScroll: true });
}
function onShortcut(ev) {
  if ($("results").hidden || ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || document.querySelector("dialog[open]")) return;
  const el0 = ev.target instanceof Element ? ev.target : null;
  if (el0 && el0.closest("input, textarea, select, [contenteditable], audio, video, iframe")) return;
  const arrow = ev.key === "ArrowDown" || ev.key === "ArrowUp";
  if (arrow && (ev.shiftKey || (el0 && el0.closest("#map, #transcript")))) return;      // extending a selection, or moving inside the map / the transcript
  // a Latin letter or digit is taken as typed; otherwise (an Arabic layout) the position of the key decides
  const k = /^[a-z0-9?]$/i.test(ev.key) ? ev.key.toLowerCase() : KEY_BY_CHAR[ev.key] || (ev.shiftKey ? "" : KEY_BY_CODE[ev.code]) || "";
  if (!"jk123pn?".includes(k) || !k) return;
  if (k === "?") { ev.preventDefault(); $("keys").showModal(); return; }
  const shown = S.ledger.filter(e => !isOff(e)); if (!shown.length) return;
  const cur = S.sel ? S.ledger[S.sel - 1] : null, at = cur ? shown.indexOf(cur) : -1;
  ev.preventDefault();
  if (k === "j" || k === "k") {
    // from an entry the filters hide (or none): the nearest shown one in that direction
    let to;
    if (at >= 0) to = shown[Math.max(0, Math.min(shown.length - 1, at + (k === "j" ? 1 : -1)))];
    else if (!cur) to = shown[0];
    else to = k === "j" ? shown.find(e => e.id > cur.id) || shown[shown.length - 1] : [...shown].reverse().find(e => e.id < cur.id) || shown[0];
    selectAndFocus(to);
    return;
  }
  if (at < 0) { selectAndFocus(shown[0]); return; }      // nothing selected yet: select first, judge on the next key
  flushLedger();
  const li = $("e" + cur.id); if (!li) return;
  if (k === "p") focusEntry(cur, false, true);
  else if (k === "n") { const n = li.querySelector(".review input"); if (n) n.focus(); }
  else { const b = li.querySelector(`.rv[data-v="${{ 1: "yes", 2: "no", 3: "unsure" }[k]}"]`); if (b) b.click(); }
}

// ---------------- reviewer: correct a mis-transcribed word ----------------
function drawFixBar() {
  const n = fixCount();
  $("fixBar").hidden = !n && !S.reworking;
  $("fixCount").textContent = S.reworking ? t("fix.busy") : t("fix.count", num(n));
  $("btnUndoFixes").hidden = !n || S.reworking;
}
/** the word becomes a small text field: Enter saves, Esc (or leaving the field) cancels, empty removes the word */
function editWord(span, i, origin) {
  if (S.reworking || !S.words[i] || span.querySelector(".fix-edit")) return;
  const was = wordAt(i), orig = S.words[i].w, box = el("span", "fix-edit"), inp = el("input"), old = [...span.childNodes];
  inp.type = "text"; inp.value = was; inp.dir = "auto"; inp.size = Math.max(5, was.length + 3); inp.autocomplete = "off"; inp.spellcheck = false;
  inp.setAttribute("aria-label", t("fix.label", orig) + " — " + t("fix.hint")); inp.title = t("fix.hint");
  box.append(inp);
  let done = false;
  const close = refocus => {
    if (done) return; done = true;
    span.textContent = ""; span.append(...old); span.classList.remove("editing");
    if (refocus) (span.tabIndex >= -1 && span.hasAttribute("tabindex") ? span : span.closest(".c") || span).focus({ preventScroll: true });
  };
  const save = v => { done = true; inp.disabled = true; applyFix(i, v, origin); };
  if (isFixed(i)) {
    const u = el("button", "fix-undo", "↺"); u.type = "button"; u.title = t("fix.undo1", orig); u.setAttribute("aria-label", u.title);
    u.onclick = ev => { ev.stopPropagation(); save(null); };
    u.onkeydown = ev => { ev.stopPropagation(); if (ev.key === "Escape") { ev.preventDefault(); close(true); } };
    box.append(u);
  }
  box.onclick = ev => ev.stopPropagation();
  inp.onkeydown = ev => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      ev.preventDefault();
      const v = inp.value.replace(/\s+/g, " ").trim().slice(0, 200);
      if (v === was) close(true); else save(v === orig ? null : v);
    } else if (ev.key === "Escape") { ev.preventDefault(); close(true); }
  };
  box.addEventListener("focusout", () => setTimeout(() => { if (!box.contains(document.activeElement)) close(false); }, 0));
  span.textContent = ""; span.append(box); span.classList.add("editing");
  inp.focus(); inp.select();
}
function applyFix(i, v, origin) {
  if (v == null) delete S.fixes[i]; else S.fixes[i] = v;
  store.set(S.fixKey, S.fixes);
  S.focusAfter = { origin, i };
  reanalyse();
}
function wireLedger() {
  const L = $("ledger");
  L.addEventListener("click", ev => {
    const w = ev.target.closest(".fw");
    if (w && !ev.target.closest(".fix-edit") && window.getSelection().isCollapsed) editWord(w, +w.dataset.i, "ledger");
  });
  L.addEventListener("keydown", ev => {
    const w = ev.target instanceof Element && ev.target.matches(".fw") ? ev.target : null;
    if (!w || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === "Enter" || ev.key === " " || ev.key === "F2") { ev.preventDefault(); editWord(w, +w.dataset.i, "ledger"); return; }
    const line = w.closest("p"), rtl = line.dir === "rtl", step = ev.key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1 : ev.key === (rtl ? "ArrowRight" : "ArrowLeft") ? -1 : 0;
    if (!step) return;
    const all = [...line.querySelectorAll(".fw")], to = all[all.indexOf(w) + step];
    if (to) { ev.preventDefault(); w.tabIndex = -1; to.tabIndex = 0; to.focus(); }
  });
}

// ---------------- reviewer: a stretch of the transcript selected by hand ----------------
/** the words the current selection touches inside the transcript: {a, b} (indices of transcribed words), or null */
function selectedStretch() {
  const sel = window.getSelection(), T = $("transcript");
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!r.intersectsNode(T) || !T.contains(sel.anchorNode)) return null;      // it must have begun in the transcript; it may run past its end
  const spans = T.querySelectorAll("span[data-i]"), wr = document.createRange(), n = spans.length;
  let lo = 0, hi = n;       // first word that ends after the selection begins
  while (lo < hi) { const m = (lo + hi) >> 1; wr.selectNodeContents(spans[m]); if (r.compareBoundaryPoints(Range.END_TO_START, wr) < 0) hi = m; else lo = m + 1; }
  const first = lo;
  lo = first; hi = n;       // first word that begins at or after the selection's end
  while (lo < hi) { const m = (lo + hi) >> 1; wr.selectNodeContents(spans[m]); if (r.compareBoundaryPoints(Range.START_TO_END, wr) > 0) lo = m + 1; else hi = m; }
  const last = lo - 1;
  return first < n && last >= first ? { a: +spans[first].dataset.i, b: +spans[last].dataset.i } : null;
}
function wireSelection() {
  const btn = $("selAct"), T = $("transcript"); let timer = 0, pressing = false, kept = null;
  const place = () => {
    if (pressing) return;
    const st = $("results").hidden || document.querySelector("dialog[open]") || document.activeElement && document.activeElement.closest(".fix-edit") ? null : selectedStretch();
    kept = st;
    if (!st) { btn.hidden = true; return; }
    btn.hidden = false;
    const r = window.getSelection().getRangeAt(0), rects = r.getClientRects(), end = rects[rects.length - 1] || r.getBoundingClientRect(), box = T.getBoundingClientRect();
    const w = btn.offsetWidth, h = btn.offsetHeight;
    let top = Math.min(Math.max(end.bottom, box.top), box.bottom) + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, Math.min(end.top, box.bottom) - h - 8);
    btn.style.top = Math.round(top) + "px";
    btn.style.left = Math.round(Math.min(Math.max(8, end.left + end.width / 2 - w / 2), window.innerWidth - w - 8)) + "px";
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(place, 160); };
  document.addEventListener("selectionchange", soon);
  window.addEventListener("scroll", () => { if (!btn.hidden) place(); }, { passive: true });
  window.addEventListener("resize", soon);
  T.addEventListener("scroll", () => { if (!btn.hidden) place(); }, { passive: true });
  // pressing the button must not lose the selection it is about (a touch can collapse it before the click arrives)
  btn.addEventListener("pointerdown", () => { pressing = true; setTimeout(() => { pressing = false; }, 1500); });
  btn.addEventListener("mousedown", ev => ev.preventDefault());
  btn.onclick = () => {
    const st = selectedStretch() || kept; pressing = false; btn.hidden = true;
    if (!st) return;
    window.getSelection().removeAllRanges();
    openLookup(st);
  };
}

// ---------------- reviewer: search the corpus; add a citation the tool missed ----------------
const LK = { range: null, job: 0, clash: null };
function openLookup(range, query = "") {
  LK.range = range ? { a: range.a, b: range.b } : null; LK.job++;
  $("lookupTitle").textContent = t(range ? "lk.title.range" : "lk.title.free");
  $("lookupForm").hidden = !!range; $("lookupRange").hidden = !range;
  $("lookupList").textContent = ""; $("lookupScope").textContent = ""; $("lookupClash").hidden = true; $("lookupMsg").textContent = range ? "" : t("lk.type");
  const dlg = $("lookup"); if (!dlg.open) dlg.showModal();
  if (range) { runLookup(); $("lkB1").focus(); }
  else { $("lookupQ").value = query; $("lookupQ").focus(); if (query) runLookup(); }
}
function adjustLookup(edge, d) {
  const r = LK.range, n = S.words.length; if (!r) return;
  if (edge === "a") r.a = Math.max(0, Math.min(r.b, r.a + d)); else r.b = Math.min(n - 1, Math.max(r.a, r.b + d));
  runLookup();
}
function lookupCandidate(c, canAdd) {
  const li = el("li", "lk s-" + c.status), s = c.source;
  li.append(el("span", "status", t("lk.st." + c.status)), sourceLine(s, true));
  const matched = c.entry && c.entry.diff ? c.entry.diff.filter(d => d.source).map(d => d.source).join(" ") : "";
  const cut = x => { const ws = String(x || "").split(" "); return ws.length > 70 ? ws.slice(0, 70).join(" ") + " …" : ws.join(" "); };
  // a hadith is shown in its original wording when the worker attached it: the matched words, else the excerpt, else the text
  const orig = s.type === "h" && s.via !== "en" ? (matched ? (c.entry.diffDisplay && s.display) || "" : s.excerptDisplay || (s.original && !s.excerpt ? s.arabic : "")) : "";
  const text = cut(orig || matched || s.excerpt || s.arabic || "");
  if (isQuran(s)) li.append(quranBlock(s, "cand-text", 70)); else if (text) li.append(orig ? origBlock(text, "cand-text") : textBlock(text, "cand-text"));
  if (s.translation && getLang() === "en") li.append(textBlock(cut(s.translation.text), "cand-text"));
  if (canAdd) { const b = el("button", "btn small", t("lk.add")); b.type = "button"; b.onclick = () => addManual(c); li.append(b); }
  return li;
}
async function runLookup() {
  const job = ++LK.job, range = LK.range, list = $("lookupList"), say1 = m => { $("lookupMsg").textContent = m; };
  list.textContent = ""; $("lookupScope").textContent = ""; $("lookupClash").hidden = true; LK.clash = null;
  let words, idx = null;
  if (range) {
    ({ words, idx } = rangeWords(range.a, range.b));
    const said = $("lookupSaid"), text = words.map(w => w.w).join(" ");
    said.textContent = text; said.dir = dirOf(text); said.lang = scriptOf(text);
    $("lkA1").disabled = $("lkB1").disabled = range.a >= range.b; $("lkA0").disabled = range.a <= 0; $("lkB0").disabled = range.b >= S.words.length - 1;
  } else words = wordsFromText($("lookupQ").value.trim());
  if (!words.length) return say1(range ? t("lk.none") : t("lk.type"));
  if (S.corpus !== "ready") {
    say1(S.corpus === "failed" ? t("corpus.fail", detail(S.corpusErr)) : t("lk.wait"));
    const info = await corpusReady; if (job !== LK.job) return;
    if (!info) return say1(t("corpus.fail", detail(S.corpusErr)));
  }
  say1(t("lk.searching"));
  await packQueue; if (job !== LK.job) return;      // a book that is still loading is searched too
  let r;
  try { r = await call("lookup", { words }); } catch (e) { if (job === LK.job) say1(t("lk.err", detail(e))); return; }
  if (job !== LK.job) return;
  let note = "";
  if (r.truncated) {
    note = t(range ? "lk.cut" : "lk.cut.free", num(r.searched)) + " ";
    if (range) { range.b = idx[r.searched - 1]; const text = words.slice(0, r.searched).map(w => w.w).join(" "); $("lookupSaid").textContent = text + " …"; }
  }
  // a place that already has a textual citation (or one the reviewer added) is opened, not written over
  const clash = range ? S.ledger.find(e => (e.manual || textual(e)) && e.wordStart <= range.b && e.wordEnd >= range.a) : null;
  if (clash) { LK.clash = clash; $("lookupClashMsg").textContent = t("lk.clash", markTitle(clash)); $("lookupClash").hidden = false; }
  say1(note + (r.candidates.length ? t("lk.found", num(r.candidates.length)) : t("lk.none")));
  for (const c of r.candidates) list.append(lookupCandidate(c, !!range && !clash));
  // what was searched, and what was not
  const loaded = [...packs.values()].filter(p => p.state === "loaded").map(p => packName(p.id)), not = [...packs.values()].filter(p => p.state !== "loaded").map(p => packName(p.id));
  const scope = $("lookupScope"); scope.textContent = "";
  if (r.lang === "en" && !r.english) {
    scope.append(el("span", "warn-text", t("lk.en")), " ");
    if (EN_PACKS.every(id => packs.has(id))) {
      const b = el("button", "link", t("lk.en.load")); b.type = "button";
      b.onclick = async () => { b.disabled = true; say1(t("busy.en")); await Promise.all(EN_PACKS.map(loadPack)); if (job === LK.job) runLookup(); };
      scope.append(b, " ");
    }
  }
  scope.append(t("lk.scope", [t("lk.scope.core"), ...loaded].join(sep())) + (not.length ? " " + t("lk.scope.not", not.join(sep())) : ""));
}
function addManual(c) {
  const range = LK.range; if (!range || !c || !c.source || !c.source.ref) return;
  if (S.ledger.some(e => (e.manual || textual(e)) && e.wordStart <= range.b && e.wordEnd >= range.a)) return;
  const m = { a: range.a, b: range.b, ref: c.source.ref, status: c.status, src: {} };
  const e = manualEntry(m, c);
  S.manual = cleanManual([...S.manual, m], S.words.length); store.set(S.manualKey, S.manual);
  setLedger(S.ledger.filter(x => !x.manual), [...S.ledger.filter(x => x.manual), e]);
  S.review[e.key] = { v: "yes", note: "", sig: sig(e) }; store.set(S.reviewKey, S.review);      // a person chose it: the verdict starts as "correct"
  if (S.onlyOpen) S.keepOpen.add(e.key);
  S.hidden.delete(e.status);
  $("lookup").close();
  S.sel = e.id; render(); selectAndFocus(e);
}
function removeManual(e) {
  S.manual = S.manual.filter(m => !(m.a === e.wordStart && m.b === e.wordEnd)); store.set(S.manualKey, S.manual);
  delete S.review[e.key]; store.set(S.reviewKey, S.review);
  const next = S.ledger.find(x => x.id > e.id && !isOff(x)) || null;
  setLedger(S.ledger.filter(x => !x.manual), S.ledger.filter(x => x.manual && x !== e));
  S.sel = null; S.focusAfter = { origin: "bar" };
  redrawInPlace();
  if (next && S.ledger.includes(next)) selectAndFocus(next, false);
}

// ---------------- reviewer: citation index for a video description ----------------
function drawIndexBtn() { const b = $("btnIndex"); b.disabled = !S.hasTimes; b.title = t(S.hasTimes ? "idx.title" : "idx.notimes"); }
function drawIndex() {
  const text = descriptionIndex(S.ledger, activeReviews(), { intro: $("indexIntro").checked }), box = $("indexText");
  box.value = text; box.dir = getLang() === "ar" ? "rtl" : "ltr";
  $("indexCopy").disabled = !text;
  $("indexMsg").textContent = text ? "" : t("idx.none");
  return text;
}
async function copyIndex() {
  const text = drawIndex(), box = $("indexText"); if (!text) return;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
  if (!ok) { try { box.focus(); box.select(); ok = document.execCommand("copy"); } catch { ok = false; } }
  $("indexMsg").textContent = t(ok ? "idx.copied" : "idx.nocopy");
  if (!ok) { box.focus(); box.select(); }
}
function openIndex() {
  if (!S.hasTimes) return;
  $("indexDlg").showModal();
  copyIndex();
}

boot();
