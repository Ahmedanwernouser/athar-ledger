// Prepares the audio for the live transcription test (runs on the test machine, which has open internet).
//   1. real recitation with a known answer: ayah files from a public GitHub repository, joined in the order
//      of eval/live/*.list
//   2. real lectures from archive.org (eval/live/lectures.json): no answer key; the ledger is read by a person
// Nothing here is committed: the clips stay in eval/live/audio/ (git-ignored).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIO = path.join(HERE, "audio"), OUT = path.join(HERE, "out");
mkdirSync(AUDIO, { recursive: true }); mkdirSync(OUT, { recursive: true });
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26, ...o }).toString();
const log = []; const say = s => { console.log(s); log.push(s); };

// ---- 1. recitation ----
const REC = "https://github.com/AmmarBasha2011/Ammar-Quran-Record", REC_COMMIT = "ceaa220acff476ee71bff70ea416a92af50eddb9";
try {
  const dir = path.join(AUDIO, "_rec");
  if (!existsSync(dir)) { sh("git", ["clone", "--filter=blob:none", "--no-checkout", REC, dir]); }
  for (const name of ["yusuf", "medley"]) {
    const files = readFileSync(path.join(HERE, name + ".list"), "utf8").split("\n").filter(Boolean);
    sh("git", ["-C", dir, "checkout", REC_COMMIT, "--", ...files]);
    writeFileSync(path.join(AUDIO, name + ".txt"), files.map(f => `file '${path.join(dir, f)}'`).join("\n") + "\n");
    sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(AUDIO, name + ".txt"), "-ac", "1", "-ar", "16000", "-b:a", "48k", path.join(AUDIO, name + ".mp3")]);
    say(`recitation ${name}: ${files.length} ayah files, ${statSync(path.join(AUDIO, name + ".mp3")).size} bytes`);
  }
} catch (e) { say("recitation FAILED: " + String(e.message).slice(0, 300)); }

// ---- 2. lectures ----
const cfg = JSON.parse(readFileSync(path.join(HERE, "lectures.json"), "utf8"));
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error("HTTP " + r.status + " " + u.slice(0, 120)); return r.json(); };
const secs = (v) => { const s = String(v ?? ""); if (/^\d+(\.\d+)?$/.test(s)) return +s; const p = s.split(":").map(Number); return p.some(Number.isNaN) ? 0 : p.reduce((a, b) => a * 60 + b, 0); };
const picked = [];
for (const it of cfg.items) {
  try {
    let ids = it.id ? [it.id] : [];
    if (!ids.length) {
      const u = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(`(${it.q}) AND mediatype:audio`) + "&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=15&sort[]=downloads+desc&output=json";
      const docs = (await get(u)).response?.docs || [];
      say(`search ${it.name}: ${docs.length} items` + docs.slice(0, 8).map(d => `\n    ${d.identifier} | ${String(d.title).slice(0, 70)} | ${String(d.creator || "").slice(0, 30)} | ${d.licenseurl || ""}`).join(""));
      ids = docs.map(d => d.identifier);
    }
    let done = false;
    for (const id of ids.slice(0, 6)) {
      const meta = await get("https://archive.org/metadata/" + encodeURIComponent(id));
      const need = cfg.skip + cfg.minutes * 60;
      const files = (meta.files || []).filter(f => /\.mp3$/i.test(f.name) && (!it.file || f.name === it.file))
        .map(f => ({ ...f, len: secs(f.length), size: +f.size || 0 })).filter(f => f.len >= need + 60 && f.size < 150e6);
      if (!files.length) continue;
      const f = files[0], src = `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split("/").map(encodeURIComponent).join("/")}`;
      const out = path.join(AUDIO, it.name + ".mp3");
      sh("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(cfg.skip), "-t", String(cfg.minutes * 60), "-i", src, "-ac", "1", "-ar", "16000", "-b:a", "40k", out], { timeout: 600000 });
      if (statSync(out).size < 200000) continue;
      picked.push({ name: it.name, id, file: f.name, title: meta.metadata?.title, creator: meta.metadata?.creator, license: meta.metadata?.licenseurl || null, from: cfg.skip, minutes: cfg.minutes, url: "https://archive.org/details/" + id });
      say(`lecture ${it.name}: ${id} / ${f.name} (${Math.round(f.len / 60)} min) -> ${statSync(out).size} bytes`);
      done = true; break;
    }
    if (!done) say(`lecture ${it.name}: nothing usable`);
  } catch (e) { say(`lecture ${it.name} FAILED: ` + String(e.message).slice(0, 300)); }
}
writeFileSync(path.join(OUT, "audio.json"), JSON.stringify(picked, null, 1) + "\n");
writeFileSync(path.join(OUT, "audio.log"), log.join("\n") + "\n");
