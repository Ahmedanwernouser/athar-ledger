// A small client for the Worker's /embed route (Cloudflare Workers AI), used by the build of the sentence vectors and by the
// evaluation's embedding cache. It asks the deployed Worker exactly as the site does: no secret is involved.
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** texts -> Int8Array (texts.length × dim). Stops at the first batch that fails for good and returns what it has:
 *  { vectors, done, dim, model, error } — `done` < texts.length means the day's free allowance ran out (or the Worker is down). */
export async function embedTexts(texts, { worker, origin, model = "bge-m3", kind = "d", dim = 0, batch = 48, onProgress = null, budgetMs = Infinity } = {}) {
  const t0 = Date.now(); let out = null, got = 0, d = 0, error = null, calls = 0;
  for (let i = 0; i < texts.length; i += batch) {
    if (Date.now() - t0 > budgetMs) { error = "time budget"; break; }
    const part = texts.slice(i, i + batch).map(t => t.slice(0, 1900));
    let ok = false;
    for (let tries = 0; tries < 6 && !ok; tries++) {
      let r;
      try { r = await fetch(worker.replace(/\/+$/, "") + "/embed", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ texts: part, kind, model, ...(dim ? { dim } : {}) }), signal: AbortSignal.timeout(90000) }); }
      catch (e) { error = "network: " + (e && e.message); await sleep(3000 * (tries + 1)); continue; }
      calls++;
      const txt = await r.text();
      if (!r.ok) { error = `HTTP ${r.status}: ${txt.slice(0, 200).replace(/\s+/g, " ")}`; if (r.status === 429 || r.status >= 500) { await sleep(5000 * (tries + 1)); continue; } break; }
      let j; try { j = JSON.parse(txt); } catch { error = "not JSON"; break; }
      if (j.model !== model || j.n !== part.length || !j.dim) { error = `unexpected answer (model ${j.model}, n ${j.n}, dim ${j.dim})`; break; }
      if (!out) { d = j.dim; out = new Int8Array(texts.length * d); }
      if (j.dim !== d) { error = "the vector length changed between calls"; break; }
      const b = Buffer.from(j.vectors, "base64");
      if (b.length !== part.length * d) { error = "the answer is shorter than n × dim"; break; }
      out.set(new Int8Array(b.buffer, b.byteOffset, b.length), i * d);
      got = i + part.length; ok = true; error = null;
    }
    if (!ok) break;
    if (onProgress) onProgress(got, texts.length, calls);
  }
  return { vectors: out ? out.subarray(0, got * d) : new Int8Array(0), done: got, dim: d, model, error };
}
