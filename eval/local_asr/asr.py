# Local Whisper transcription (sherpa-onnx) with VAD chunking -> words with times, in the shape the app accepts.
import sys, json, time, numpy as np, soundfile as sf, sherpa_onnx
wav, model, out = sys.argv[1], sys.argv[2], sys.argv[3]
lang = sys.argv[4] if len(sys.argv) > 4 else "ar"
d = f"sherpa-onnx-whisper-{model}"
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f"{d}/{model}-encoder.int8.onnx", decoder=f"{d}/{model}-decoder.int8.onnx", tokens=f"{d}/{model}-tokens.txt",
    language=lang, task="transcribe", num_threads=2, enable_token_timestamps=True)
x, sr = sf.read(wav, dtype="float32"); assert sr == 16000
vc = sherpa_onnx.VadModelConfig(); vc.silero_vad.model = "silero_vad.onnx"; vc.silero_vad.min_silence_duration = 0.35; vc.silero_vad.max_speech_duration = 25; vc.sample_rate = 16000
vad = sherpa_onnx.VoiceActivityDetector(vc, buffer_size_in_seconds=120)
segs = []; w = vc.silero_vad.window_size
for i in range(0, len(x) - w, w):
    vad.accept_waveform(x[i:i + w])
    while not vad.empty(): segs.append((vad.front.start, np.array(vad.front.samples))); vad.pop()
vad.flush()
while not vad.empty(): segs.append((vad.front.start, np.array(vad.front.samples))); vad.pop()
# group neighbouring voiced segments into windows of up to ~28 s (Whisper's own window), keeping the pauses inside,
# so the model has context; short isolated fragments make it hallucinate
groups = []
for start, smp in segs:
    end = start + len(smp)
    if groups and end - groups[-1][0] <= 28 * 16000: groups[-1][1] = end
    else: groups.append([start, end])
segs = [(a, x[a:b]) for a, b in groups]
words = []; t0 = time.time(); text = []
for start, s in segs:
    st = rec.create_stream(); st.accept_waveform(16000, s); rec.decode_stream(st); r = st.result
    off = start / 16000; toks = list(r.tokens); ts = list(r.timestamps) if r.timestamps else []
    text.append(r.text.strip())
    # tokens -> words: a token that starts with a space starts a new word
    cur = None; seg_dur = len(s) / 16000; has_ts = bool(ts) and max(ts) > 0
    first_word = len(words)
    for k, tok in enumerate(toks):
        t = off + (ts[k] if k < len(ts) else 0)
        if tok.startswith(" ") or cur is None:
            if cur and cur["word"].strip(): words.append(cur)
            cur = {"word": tok.strip(), "start": round(t, 2), "end": round(t, 2)}
        else: cur["word"] += tok
        cur["end"] = round(t + 0.2, 2)
    if cur and cur["word"].strip(): words.append(cur)
    if not has_ts:  # this model export has no token times: spread the words evenly over the voiced segment
        seg = words[first_word:]
        for i, wd in enumerate(seg): wd["start"] = round(off + seg_dur * i / max(1, len(seg)), 2); wd["end"] = round(off + seg_dur * (i + 1) / max(1, len(seg)), 2)
dur = len(x) / 16000
json.dump({"text": " ".join(text), "duration": dur, "words": words, "model": f"whisper-{model} (sherpa-onnx int8, local)", "segments": len(segs), "seconds": round(time.time() - t0, 1)}, open(out, "w"), ensure_ascii=False)
print(f"{wav}: {dur:.0f}s audio, {len(segs)} segments, {len(words)} words, {time.time()-t0:.0f}s compute, ")
print(" ".join(text)[:600])
