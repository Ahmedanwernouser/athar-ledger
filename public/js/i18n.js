// i18n.js — interface language (Arabic / English). Source texts are never translated by machine:
// English users see published translations (the English packs) next to the Arabic source.
export const LANGS = ["ar", "en"];
let lang = "ar";
export const getLang = () => lang;

const D = {
  // ---- statuses, kinds, fidelity
  "status.verbatim": ["مطابق حرفيًا", "Verbatim match"],
  "status.partial": ["مطابق جزئيًا", "Partial match"],
  "status.meaning": ["بالمعنى — يحتاج تأكيدًا", "By meaning — needs confirmation"],
  "status.lead": ["مصدر مرشّح", "Candidate source"],
  "status.notfound": ["لم يُعثر عليه في المدونة", "Not found in the corpus"],
  "short.verbatim": ["حرفي", "verbatim"], "short.partial": ["جزئي", "partial"], "short.meaning": ["بالمعنى", "by meaning"],
  "short.lead": ["مرشّح", "candidate"], "short.notfound": ["لم يُعثر عليه", "not found"],
  "fid.verbatim": ["حرفي", "verbatim"], "fid.partial": ["مخلوط", "mixed"], "fid.meaning": ["بالمعنى", "by meaning"],
  "fid.lead": ["غير محدَّد", "undetermined"], "fid.notfound": ["—", "—"],
  "kind.q": ["آية قرآنية", "Qur'an verse"], "kind.h": ["حديث", "Hadith"], "kind.s": ["قول منسوب", "Attributed saying"], "kind.b": ["نص من كتاب", "Book passage"],
  "kind.book": ["نص من كتاب ({0})", "Book passage ({0})"],
  // ---- attribution + notes (codes come from the engine; an unknown code shows nothing)
  "attr.ref_ok": ["المرجع المنطوق (السورة ورقم الآية) موافق لموضع النص في المصحف.", "The spoken reference (surah and verse number) agrees with where the text is in the Qur'an."],
  "attr.ref_mismatch": ["ذُكر مرجع (سورة ورقم آية) غير الموضع الذي وُجد فيه النص في المدونة — يُراجع.", "The spoken reference (surah and verse) differs from where the text was found — please review."],
  "attr.surah_ok": ["النسبة المنطوقة إلى السورة موافقة لموضع النص في المصحف.", "The surah named by the speaker agrees with where the text is in the Qur'an."],
  "attr.surah_mismatch": ["ذُكرت سورة غير التي وُجد فيها النص في المدونة — يُراجع.", "The speaker named a different surah from the one where the text was found — please review."],
  "attr.collection_ok": ["النسبة المنطوقة موافقة: النص موجود في المدونة في الكتاب المذكور.", "The attribution agrees: the text is in the collection the speaker named."],
  "attr.collection_partial": ["النسبة المنطوقة مؤكَّدة جزئيًا: لم يُعثر على هذا اللفظ في بعض الكتب المذكورة ضمن المدونة.", "The attribution is partly confirmed: this wording was not found in some of the collections named."],
  "attr.collection_mismatch": ["لم يُعثر على هذا اللفظ في الكتاب المذكور ضمن نسخة المدونة؛ وُجد في غيره — يُراجع (قد يكون بلفظ آخر أو برواية أخرى).", "This wording was not found in the collection the speaker named; it was found in another one — please review (it may exist there in another wording or narration)."],
  "attr.collection_other_wording": ["ذُكر الكتاب، والنص موجود فيه بلفظ آخر.", "The named book has this text in a different wording."],
  "note.saying_notfound": ["قول منسوب إلى عالم: لم يُعثر على لفظه في الكتب المحمَّلة.", "A saying attributed to a scholar: its wording was not found in the loaded books."],
  "note.saying_core_only": ["قول منسوب إلى عالم: المدونة الأساسية قرآن وحديث فقط. حمّل حزم الكتب للبحث في التفسير والفقه والسيرة والعقيدة.", "A saying attributed to a scholar: the core corpus holds only Qur'an and hadith. Load the book packs to search tafsir, fiqh, seerah and creed."],
  "note.ref_only": ["ذكر المتحدث هذا المرجع صراحة ولم يُعثر قربه على نص مطابق. النص المعروض هو نص المرجع المذكور.", "The speaker named this reference, and no matching text was found near it. The text shown is the text at that reference."],
  "note.notfound": ["قال المتحدث ما يدل على استشهاد، ولم يُعثر على نصه في المدونة. قد يكون في كتاب آخر أو بلفظ آخر؛ هذا لا يعني أنه غير صحيح.", "The speaker announced a quotation whose text was not found in the corpus. It may be in another book or in another wording; this does not mean it is inauthentic."],
  "note.isnad": ["نص هذا الحديث في المدونة يتضمن سنده؛ قد يكون التطابق في السند لا في المتن.", "This hadith is stored with its chain of narrators; the match may lie in the chain rather than in the text itself."],
  "note.meaning_lex": ["لم يُطابق اللفظ. نصوص في المدونة تشترك مع المنطوق في كلمات نادرة — للمراجعة فقط:", "The wording did not match. Passages sharing rare words with what was said — for review only:"],
  "note.llm_choice": ["اختار نموذجٌ لغويٌّ هذا النص من بين مرشّحات استرجعها البحث من المدونة. النموذج لا يكتب نصًّا ولا يحكم بصحة؛ يحتاج تأكيدًا بشريًّا.", "A language model picked this passage from candidates retrieved from the corpus. The model writes no text and judges no authenticity; a human must confirm."],
  "note.llm_recall": ["اقترح نموذجٌ لغويٌّ النصَّ المقصود، ثم عُثر على هذا النص في المدونة. المعروض هو نص المدونة. يحتاج تأكيدًا بشريًّا.", "A language model proposed the intended wording, which was then found in the corpus. What is shown is the corpus text. A human must confirm."],
  "note.excerpt_head": ["الاقتباس يبدأ من وسط النص.", "The quotation starts mid-passage."],
  "note.tail_unmatched": ["توقّف التطابق هنا: ما قيل بعده («{0}») ليس تتمّة النص في المصدر.", "The match stops here: what was said next (“{0}”) is not how the source continues."],
  "note.en_pack_missing": ["الكلام بالإنجليزية ولم تُحمَّل حزم الترجمات الإنجليزية، فلم يُبحث في الترجمات.", "The speech is in English but the English translation packs are not loaded, so translations were not searched."],
  "note.excerpt_tail": ["للنص تتمّة في المصدر لم تُقَل.", "The source continues beyond what was said."],
  // ---- entry
  "e.spoken": ["المنطوق", "Spoken"], "e.source": ["في المصدر", "In the source"],
  "e.source.full": ["نص الآية في المصحف (كاملًا، بلا تعليم للفروق)", "The verse as it is in the Qur'an (in full, differences not marked)"],
  "e.agree": ["اتفاق {0}٪ من {1} كلمة", "{0}% agreement over {1} words"],
  "e.asr": ["{0} فرق تفريغ محتمل", "{0} likely transcription difference(s)"], "e.wording": ["{0} فرق لفظي", "{0} wording difference(s)"],
  "e.open.q": ["افتح في quran.com", "Open on quran.com"], "e.open.h": ["افتح في sunnah.com", "Open on sunnah.com"],
  "e.open.h.book": ["افتح باب الكتاب في sunnah.com — الرابط المباشر للحديث غير متاح", "Open the book chapter on sunnah.com — no direct link to this hadith"],
  "e.open.h.collection": ["افتح صفحة الكتاب في sunnah.com — الرابط المباشر للحديث غير متاح", "Open the collection page on sunnah.com — no direct link to this hadith"],
  "e.parallels": ["مواضع أخرى للنص في المدونة ({0})", "Other places this text occurs in the corpus ({0})"],
  "e.inbooks": ["ورد النص أيضًا في كتب محمَّلة ({0})", "Also found in loaded books ({0})"],
  "e.tafsir": ["تفسير الجلالين", "Tafsir al-Jalalayn (Arabic)"], "e.ayah": ["الآية {0}", "Verse {0}"],
  "e.grades": ["أحكام منقولة من قاعدة البيانات كما هي (ليست حكمًا من الأداة)", "Gradings copied from the dataset as they are (not a judgement by this tool)"],
  "e.grades.note": ["بعض الأسماء محقّقو طبعات مطبوعة، والأحكام المطبوعة في طبعاتهم تكرّر في الغالب أحكام الألباني؛ ليست أحكامًا مستقلة.", "Some of the names are editors of printed editions; the grades printed there largely repeat al-Albani's and are not independent rulings."],
  "e.grades.line": ["في قاعدة البيانات", "In the dataset"],
  "e.suggest.hybrid": ["أقرب نصوص المدونة معنًى ولفظًا (اقتراحات للمراجعة، ليست مطابقات)", "Closest corpus passages by meaning and wording (suggestions to review, not matches)"],
  "e.suggest.lexical": ["أقرب نصوص المدونة لفظًا (اقتراحات للمراجعة، ليست مطابقات)", "Closest corpus passages by wording (suggestions to review, not matches)"],
  "e.via": ["طابق الترجمة الإنجليزية: {0}", "Matched the English translation: {0}"],
  "e.via.h": ["طابق ترجمة إنجليزية من قاعدة بيانات hadith-api (المترجم غير مسمّى في المصدر)", "Matched an English translation from the hadith-api dataset (translator not named in the source)"],
  "e.arabic": ["النص العربي للمصدر", "Arabic text of the source"],
  "e.translation": ["الترجمة الإنجليزية ({0})", "English translation ({0})"],
  "e.translation.h": ["ترجمة إنجليزية من قاعدة بيانات hadith-api (المترجم غير مسمّى في المصدر)", "English translation from the hadith-api dataset (translator not named in the source)"],
  "e.reference": ["المرجع الذي ذكره المتحدث: {0}", "Reference named by the speaker: {0}"],
  "e.incorpus": ["النص في المدونة ({0}):", "Text in the corpus ({0}):"],
  "strength.choice": ["اختيار من مرشّحات المدونة", "picked from the corpus candidates"], "strength.strong": ["ترجيح أقوى", "stronger support"],
  "strength.medium": ["ترجيح متوسط", "medium support"], "strength.weak": ["ترجيح أضعف", "weaker support"],
  "e.word": ["كلمة {0}", "word {0}"],
  "rv.label": ["مراجعتك:", "Your review:"], "rv.yes": ["صحيح", "Correct"], "rv.no": ["غير صحيح", "Incorrect"], "rv.unsure": ["يحتاج نظرًا", "Needs a look"],
  "rv.note": ["ملاحظة (اختياري)", "Note (optional)"],
  "rv.stale": ["مراجعة سابقة لنتيجة مختلفة", "Earlier review of a different result"], "rv.stale.none": ["بلا حكم", "no verdict"],
  // ---- sources
  "src.q.one": ["سورة {0} — الآية {1}", "Surah {0} — verse {1}"], "src.q.many": ["سورة {0} — الآيات {1}–{2}", "Surah {0} — verses {1}–{2}"],
  "src.h": ["{0} — رقم {1}", "{0} — no. {1}"], "src.h.nonumber": ["{0} — الرقم غير متاح", "{0} — number not available"],
  "src.numbering.dataset": ["(ترقيم قاعدة البيانات)", "(dataset numbering)"],
  // ---- summary / states
  "title": ["أثَر — سجل الاستشهادات المنطوقة", "Athar — a ledger of spoken citations"],
  "sum.none": ["لم يُعثر في «{0}» على مواضع استشهاد.", "No citations were found in “{0}”."],
  "sum.line": ["في «{0}» {1} موضع استشهاد: {2}.", "In “{0}”: {1} citation spots — {2}."],
  "empty.hidden": ["لا يظهر شيء بالتصفية الحالية. فعّل وصفًا من الأعلى، أو ألغِ «لم يُراجَع بعد».", "Nothing is shown with the current filters. Turn a status on above, or turn off “Not reviewed yet”."],
  "empty.none": ["لا توجد في النص عبارات استشهاد ولا نصوص تطابق المدونة. إن كان التسجيل يحتوي استشهادات، فقد يكون التفريغ لم يلتقطها بوضوح.", "No citation phrases and no text matching the corpus. If the recording does contain citations, the transcription may not have captured them clearly."],
  "corpus.loading": ["تُحمَّل المدونة…", "Loading the corpus…"],
  "corpus.ready": ["المدونة جاهزة: {0} آية و{1} حديثًا من تسع مجموعات.", "Corpus ready: {0} verses and {1} hadith from nine collections."],
  "corpus.fail": ["تعذّر تحميل المدونة ({0}). تحقّق من الاتصال ثم أعد المحاولة.", "The corpus could not be loaded ({0}). Check your connection and try again."],
  "corpus.retry": ["أعد المحاولة", "Try again"],
  "err.network": ["انقطع الاتصال أو تعذّر الوصول إلى الخادم", "the connection failed or the server could not be reached"],
  "err.file": ["الملف {0}، رمز {1}", "file {0}, code {1}"], "err.generic": ["خطأ غير متوقَّع", "unexpected error"],
  "na.notimes": ["نص بلا أزمنة: المواضع معروضة بترتيب الكلمات.", "Text without timestamps: positions are shown by word order."],
  "na.est": ["مثال بلا صوت: الأزمنة تقديرية.", "Sample without audio: times are estimated."],
  "na.file": ["لا يوجد ملف صوتي مرفق: الأزمنة من ملف التفريغ.", "No audio attached: times come from the transcript file."],
  "na.broken": ["تعذّر تشغيل الصوت: الأزمنة من التفريغ.", "The audio cannot be played: times come from the transcription."],
  "words": ["{0} كلمة", "{0} words"], "mb": ["{0} ميجابايت", "{0} MB"],
  "busy.wait": ["جارٍ العمل…", "Working…"],
  "busy.sample": ["يُحمَّل المثال…", "Loading the sample…"], "busy.prep": ["يُجهَّز التسجيل…", "Preparing the recording…"],
  "busy.read": ["يُقرأ ملف التفريغ…", "Reading the transcript file…"],
  "busy.corpus": ["بانتظار اكتمال تحميل المدونة…", "Waiting for the corpus to finish loading…"],
  "busy.packs": ["تُحمَّل الكتب التي اخترتها…", "Loading the books you ticked…"],
  "busy.search": ["تُبحث الاستشهادات في المدونة…", "Searching the corpus for citations…"],
  "busy.en": ["تُحمَّل الترجمات الإنجليزية…", "Loading the English translations…"],
  "busy.pass2": ["تفريغ ثانٍ بالعربية لالتقاط التلاوة…", "Second transcription pass in Arabic to catch recitation…"],
  "asr.send": ["يُرسَل التسجيل للتفريغ…", "Sending the recording for transcription…"],
  "asr.decode": ["الملف كبير: يُجهَّز الصوت داخل المتصفح…", "Large file: preparing the audio in the browser…"],
  "asr.part": ["تفريغ الجزء {0} من {1}…", "Transcribing part {0} of {1}…"],
  "asr.done": ["اكتمل التفريغ", "Transcription finished"],
  // ---- errors
  "err.short": ["الصق نصًّا أطول قليلًا (جملة أو أكثر).", "Paste a slightly longer text (a sentence or more)."],
  "err.tooshort": ["النص قصير جدًّا للتحليل.", "The text is too short to analyse."],
  "err.analysis": ["تعذّر التحليل: {0}", "Analysis failed: {0}"],
  "err.sample": ["تعذّر تحميل المثال ({0}). تحقّق من الاتصال ثم أعد المحاولة.", "The sample could not be loaded ({0}). Check your connection and try again."],
  "err.samples": ["تعذّر تحميل قائمة الأمثلة. أعد تحميل الصفحة.", "The list of samples could not be loaded. Reload the page."],
  "err.transcript": ["تعذّرت قراءة ملف التفريغ. الصيغ المقبولة: JSON من Whisper، ‏SRT، ‏VTT، أو نص عادي.", "The transcript file could not be read. Accepted formats: Whisper JSON, SRT, VTT or plain text."],
  "err.json": ["ملف JSON غير صالح أو ليس تفريغًا: يُنتظر حقل words أو segments أو text.", "The JSON file is invalid or is not a transcript: a words, segments or text field is expected."],
  "err.pack": ["تعذّر تحميل «{0}» ({1}). أعد اختياره للمحاولة من جديد.", "Could not load “{0}” ({1}). Tick it again to retry."],
  "err.pack.required": ["توقّف التحليل: تعذّر تحميل «{0}» ({1})، والتحليل يحتاجه. تحقّق من الاتصال ثم أعد المحاولة.", "Analysis stopped: “{0}” could not be loaded ({1}) and the analysis needs it. Check your connection and try again."],
  "warn.pack": ["لم تُحمَّل «{0}»؛ نتائج هذا السجل لا تشملها.", "“{0}” was not loaded; this ledger does not include it."],
  "warn.pass2": ["لم يكتمل التفريغ الثاني بالعربية ({0})؛ قد تغيب عن السجل تلاوات عربية داخل الكلام الإنجليزي.", "The second (Arabic) transcription pass did not complete ({0}); Arabic recitation inside the English speech may be missing from this ledger."],
  "warn.audio": ["تعذّر على المتصفح تشغيل هذا الملف؛ السجل والأزمنة من التفريغ، بلا استماع.", "The browser cannot play this file; the ledger and its times come from the transcription, without playback."],
  "asr.err.disabled": ["خدمة التفريغ غير مفعَّلة في هذه النسخة. الصق نصًّا مفرَّغًا جاهزًا.", "Transcription is not enabled in this copy. Paste a ready transcript instead."],
  "asr.err.network": ["تعذّر الوصول إلى خدمة التفريغ. تحقّق من الاتصال ثم أعد المحاولة، أو الصق نصًّا مفرَّغًا جاهزًا.", "The transcription service could not be reached. Check your connection and try again, or paste a ready transcript."],
  "asr.err.bad_file": ["لم تقبل خدمة التفريغ هذا الملف. استخدم ملفًّا صوتيًّا أو مرئيًّا بصيغة mp3 أو m4a أو wav أو mp4.", "The transcription service did not accept this file. Use an audio or video file in mp3, m4a, wav or mp4 format."],
  "asr.err.bad_form": ["رفضت خدمة التفريغ الطلب. أعد تحميل الصفحة ثم حاول مرة أخرى.", "The transcription service rejected the request. Reload the page and try again."],
  "asr.err.origin": ["هذا الموقع غير مصرَّح له باستخدام خدمة التفريغ. إن كنت صاحب النسخة فراجع إعداد ALLOWED_ORIGINS؛ وإلا فالصق نصًّا مفرَّغًا جاهزًا.", "This site is not allowed to use the transcription service. If this is your copy, check ALLOWED_ORIGINS; otherwise paste a ready transcript."],
  "asr.err.too_large": ["الملف أكبر من الحد المسموح للطلب الواحد. قسّمه إلى أجزاء أصغر أو استخدم نسخة صوتية فقط.", "The file is larger than one request allows. Split it into smaller parts or use an audio-only copy."],
  "asr.err.length_required": ["لم يُرسِل المتصفح حجم الملف مع الطلب فرفضته خدمة التفريغ. أعد تحميل الصفحة ثم حاول مرة أخرى، أو جرّب متصفحًا آخر.", "The browser did not send the file size with the request, so the transcription service refused it. Reload the page and try again, or try another browser."],
  "asr.err.internal": ["حدث خطأ داخل خدمة التفريغ. أعد المحاولة بعد قليل، أو الصق نصًّا مفرَّغًا جاهزًا.", "Something went wrong inside the transcription service. Try again shortly, or paste a ready transcript."],
  "asr.err.daily_cap": ["وصل الموقع إلى الحد اليومي المجاني للتفريغ. جرّب غدًا، أو الصق نصًّا مفرَّغًا جاهزًا.", "The site has reached its free daily transcription limit. Try again tomorrow, or paste a ready transcript."],
  "asr.err.daily_cap.ip": ["بلغتَ الحد اليومي المجاني للتفريغ المخصَّص للزائر الواحد. جرّب غدًا، أو الصق نصًّا مفرَّغًا جاهزًا.", "You have reached the free daily transcription limit for one visitor. Try again tomorrow, or paste a ready transcript."],
  "asr.err.rate_limited": ["طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.", "Too many requests in a short time. Wait a minute and try again."],
  "asr.err.rate_limited.hour": ["بلغ الموقع حد التفريغ المجاني لهذه الساعة. أعد المحاولة بعد نحو {0} دقيقة، أو الصق نصًّا مفرَّغًا جاهزًا.", "The site has reached its free transcription limit for this hour. Try again in about {0} minutes, or paste a ready transcript."],
  "asr.err.upstream_busy": ["خدمة التفريغ مشغولة الآن. انتظر دقيقة ثم أعد المحاولة.", "The transcription service is busy right now. Wait a minute and try again."],
  "asr.err.upstream": ["تعذّر التفريغ عند مزوّد الخدمة. أعد المحاولة بعد قليل، أو الصق نصًّا مفرَّغًا جاهزًا.", "Transcription failed at the provider. Try again shortly, or paste a ready transcript."],
  "asr.err.busy": ["الخدمة مشغولة الآن. أعد المحاولة بعد ثوانٍ.", "The service is busy right now. Try again in a few seconds."],
  "asr.err.server_not_configured": ["خدمة التفريغ غير مهيأة بعد عند صاحب الموقع. الصق نصًّا مفرَّغًا جاهزًا.", "The transcription service has not been set up by the site owner yet. Paste a ready transcript instead."],
  "asr.err.bad_response": ["ردّت خدمة التفريغ بردّ غير مفهوم. أعد المحاولة بعد قليل، أو الصق نصًّا مفرَّغًا جاهزًا.", "The transcription service sent an unreadable reply. Try again shortly, or paste a ready transcript."],
  "asr.err.empty": ["لم يُتعرَّف على كلام في هذا التسجيل. تأكّد أن فيه كلامًا مسموعًا وأن لغة التسجيل المختارة صحيحة.", "No speech was recognised in this recording. Check that it contains audible speech and that the recording language is set correctly."],
  "asr.err.decode": ["تعذّر على المتصفح قراءة هذا الملف الصوتي. جرّب صيغة mp3 أو m4a أو wav، أو ملفًّا أصغر من ٢٤ ميجابايت.", "The browser could not read this audio file. Try mp3, m4a or wav, or a file smaller than 24 MB."],
  "asr.err.too_long": ["التسجيل أطول من أن يجهّزه المتصفح دفعة واحدة. قسّمه إلى ملفات أقصر (ساعة أو أقل لكل ملف) وحلّل كل ملف وحده.", "The recording is too long for the browser to prepare in one go. Split it into shorter files (an hour or less each) and analyse them one by one."],
  "asr.err.unknown": ["تعذّر التفريغ (رمز {0}). أعد المحاولة، أو الصق نصًّا مفرَّغًا جاهزًا.", "Transcription failed (code {0}). Try again, or paste a ready transcript."],
  // ---- by meaning
  "meaning.start": ["ابحث عن الاقتباسات بالمعنى", "Look for quotations by meaning"],
  "meaning.run": ["يُبحث بالمعنى… {0} من {1}", "Searching by meaning… {0} of {1}"],
  "meaning.hit": ["وُجد مصدر مرشّح لـ {0} من {1}", "A candidate source was found for {0} of {1}"], "meaning.none": ["لم يُعثر على مصادر بالمعنى", "No sources found by meaning"],
  "warn.meaning": ["توقّف البحث بالمعنى بعد {0} من {1}: {2} ما لم يُفحَص بقي على حاله.", "The search by meaning stopped after {0} of {1}: {2} Entries not reached are unchanged."],
  "meaning.why.daily_cap": ["وصل الموقع إلى الحد اليومي المجاني لهذه الخطوة؛ جرّب غدًا.", "the site has reached its free daily limit for this step; try again tomorrow."],
  "meaning.why.daily_cap.ip": ["بلغتَ الحد اليومي المجاني لهذه الخطوة للزائر الواحد؛ جرّب غدًا.", "you have reached the free daily limit of this step for one visitor; try again tomorrow."],
  "meaning.why.rate_limited": ["طلبات كثيرة في وقت قصير؛ انتظر دقيقة ثم أعد تحليل النص.", "too many requests in a short time; wait a minute, then analyse again."],
  "meaning.why.rate_limited.hour": ["بلغ الموقع حد هذه الساعة؛ أعد المحاولة بعد نحو {0} دقيقة.", "the site has reached its limit for this hour; try again in about {0} minutes."],
  "meaning.why.llm_disabled": ["هذه الخطوة غير مفعَّلة في الخادم.", "this step is not enabled on the server."],
  "meaning.why.server_not_configured": ["هذه الخطوة غير مهيأة بعد عند صاحب الموقع.", "this step has not been set up by the site owner yet."],
  "meaning.why.origin": ["هذا الموقع غير مصرَّح له باستخدام الخدمة.", "this site is not allowed to use the service."],
  "meaning.why.network": ["تعذّر الوصول إلى الخدمة؛ تحقّق من الاتصال.", "the service could not be reached; check your connection."],
  "meaning.why.other": ["تعذّر إكمال الخطوة.", "the step could not be completed."],
  "doc.untitled": ["محاضرة", "Lecture"],
  "doc.subtitle": ["نص مفرَّغ بحواشٍ آلية من «أثَر» — {0}. مسوّدة تحتاج مراجعة بشرية قبل النشر.", "Transcript with automatic source footnotes by Athar — {0}. A draft that needs human review before publication."],
  "doc.sep": ["؛ ", "; "],
  "doc.fn.also": ["، وهو أيضًا في: {0}", "; also in: {0}"],
  "doc.fn.more": [" وغيرها", " and others"],
  "doc.fn.partial.q": ["اللفظ المنطوق يخالف نص المصحف في بعض الكلمات؛ ونص الآية:", "The spoken wording differs from the Qur'an text in some words; the verse reads:"],
  "doc.fn.partial.h": ["بلفظ يختلف عن المنطوق في بعض الكلمات؛ يُراجَع لفظ المصدر.", "The source's wording differs in some words; check the source text."],
  "doc.fn.viaen": ["(طابق ترجمة إنجليزية منشورة.)", "(Matched through a published English translation.)"],
  "doc.fn.attr": ["نُسب في الكلام إلى غير هذا الموضع — يُراجَع.", "The speaker attributed it elsewhere — check."],
  "doc.fn.tail": ["ما قيل بعده مباشرةً ليس تتمّة النص في المصدر.", "What was said right after is not how the source continues."],
  "doc.fn.unsure": ["[يحتاج نظرًا]", "[needs a look]"],
  "doc.fn.meaning": ["لم يطابق لفظًا. لعل المقصود: {0} (اقتراح آلي غير مؤكَّد).", "No wording match. Possibly: {0} (an unconfirmed automatic suggestion)."],
  "doc.fn.notfound": ["لم يُعثر على هذا النص في مدونة «أثَر» (القرآن وتسع مجموعات حديثية وما حُمِّل من كتب)؛ يحتاج تخريجًا يدويًّا. عدم العثور لا يعني أن النص غير ثابت.", "Not found in Athar's corpus (the Qur'an, nine hadith collections and the loaded books); needs manual sourcing. Not found does not mean the text is unsound."],
  "doc.note.notes": ["الحواشي في هذا الملف ({0}) وضعها «أثَر» آليًّا بمطابقة النص المفرَّغ مع مدونته. الحاشية المنتهية بعلامة * لم يؤكّدها مراجع بشري بعد؛ المؤكَّد منها {1}.", "The footnotes in this file ({0}) were placed automatically by Athar by matching the transcript against its corpus. A footnote ending with * has not been confirmed by a human reviewer yet; confirmed: {1}."],
  "doc.note.manual": ["منها {0} اختار المراجع مصدرها بنفسه (مكتوب فيها «أضافه المراجع»).", "Of these, {0} have a source the reviewer chose (marked “added by the reviewer”)."],
  "doc.note.mushaf": ["الآيات التي طابقت المصحف كلمةً بكلمة كُتبت برسم المصحف من نص مشروع تنزيل (tanzil.net)، وكل ما سواها كما خرج من التفريغ.", "Verses that matched the Qur'an word for word are written in Mushaf spelling from the Tanzil text (tanzil.net); everything else is as transcribed."],
  "doc.note.fixed": ["صحّح المراجع {0} من كلمات التفريغ.", "The reviewer corrected {0} transcribed word(s)."],
  "doc.note.raw": ["النص نفسه كما خرج من التفريغ ولم يُصحَّح.", "The text itself is as transcribed and has not been corrected."],
  "doc.note.judge": ["الأداة لا تحكم على صحة حديث.", "The tool does not judge the authenticity of any hadith."],
  "doc.fn.manual": ["(أضافه المراجع)", "(added by the reviewer)"],
  "doc.fn.manual.meaning": ["بمعناه في: {0}.", "In meaning, see: {0}."],
  // ---- summary for the review committee
  "sumry.title": ["ملخّص للجنة المراجعة", "Summary for the review committee"], "sumry.colon": [": ", ": "], "sumry.sep": ["، ", ", "],
  "sumry.quran": ["آيات قرآنية", "Qur'an citations"], "sumry.hadith": ["أحاديث", "Hadith citations"], "sumry.books": ["نصوص من كتب", "Book citations"],
  "sumry.notfound": ["اقتباسات أُعلن عنها ولم يُعثر عليها في المدونة", "Announced quotations not found in the corpus"],
  "sumry.attr": ["نسبة منطوقة لم توافق ما وُجد", "Spoken attributions that did not agree"],
  "sumry.status": ["بحسب الوصف", "By status"], "sumry.review": ["حالة المراجعة", "Review state"], "sumry.none": ["لم يُراجَع", "not reviewed"],
  "sumry.manual": ["أضافه المراجع", "Added by the reviewer"],
  "sumry.rule": ["الأسطر الثلاثة الأولى تعدّ المطابقات اللفظية (حرفية وجزئية) وما أضافه المراجع، دون ما حُكم عليه بأنه غير صحيح. الأرقام من السجل ومراجعته كما هما الآن.", "The first three lines count textual matches (verbatim and partial) and entries added by the reviewer, leaving out those marked incorrect. Numbers reflect the ledger and its review as they are now."],
  // ---- citation index for a video description
  "idx.verse": ["آية", "Verse"], "idx.verses": ["آيات", "Verses"], "idx.surah": ["سورة {0}", "{0}"], "idx.hadith": ["حديث", "Hadith"], "idx.book": ["نص من كتاب", "Book passage"],
  "idx.intro": ["المقدمة", "Introduction"],
  "na.video": ["الأزمنة من النص الملصوق؛ اضغط زمن أي استشهاد ليُفتح الفيديو عنده.", "Times come from the pasted transcript; press a citation's time to open the video there."],
  "err.video": ["رابط الفيديو غير مفهوم. الصق رابط يوتيوب كاملًا أو اترك الخانة فارغة.", "The video link was not understood. Paste a full YouTube link or leave the field empty."],
  "err.session": ["ملف الجلسة فارغ أو تالف.", "The session file is empty or damaged."],
  "pasted": ["نص ملصوق", "Pasted text"],
  "drop.on": ["اختر ملفًّا أو اسحبه إلى هنا", "Choose a file or drop it here"],
  "drop.on2": ["يُرسَل الصوت إلى خدمة التفريغ ولا يُحفَظ عندنا. يُحتفَظ بعدّاد مجهول قصير الأجل فقط لتطبيق الحد اليومي المجاني.", "The audio is sent to the transcription service and is not stored by us. Only a short-lived anonymous counter is kept, to enforce the free daily limit."],
  "drop.off": ["رفع الصوت غير مفعَّل في هذه النسخة", "Audio upload is not enabled in this copy"], "drop.off2": ["الصق نصًّا مفرَّغًا أو جرّب المثال", "Paste a transcript or try the sample"],
  // ---- packs
  "pack.ask": ["حمّل الحزم التي اخترتها سابقًا (‎{0}‎ MB)؟", "Load the packs you chose earlier ({0} MB)?"],
  "pack.ask.yes": ["حمّلها", "Load them"], "pack.ask.no": ["لا، انسَ اختياري", "No, forget my choice"],
  "pack.unticked": ["أُلغي اختيار «{0}»: لن تُحمَّل في المرة القادمة، وتبقى مستعمَلة في البحث حتى تعيد تحميل الصفحة.", "“{0}” unticked: it will not be loaded next time, and stays in use until you reload the page."],
  // ---- map / transcript
  "map.mark": ["{0} — {1}", "{0} — {1}"],
  "tr.cite": ["استشهاد {0}: {1}", "Citation {0}: {1}"],
  // ---- export
  "csv.id": ["رقم", "No."], "csv.start": ["البداية", "Start"], "csv.end": ["النهاية", "End"], "csv.word": ["موضع أول كلمة", "First word position"],
  "csv.kind": ["النوع", "Kind"], "csv.status": ["الوصف", "Status"], "csv.fidelity": ["درجة الأمانة", "Fidelity"], "csv.agreement": ["نسبة الاتفاق", "Agreement"],
  "csv.spoken": ["النص المنطوق", "Spoken text"], "csv.source": ["المصدر", "Source"], "csv.ref": ["معرّف المصدر الثابت", "Stable source id"], "csv.url": ["الرابط", "Link"],
  "csv.parallels": ["مواضع أخرى", "Other places"], "csv.attr": ["فحص النسبة المنطوقة", "Spoken attribution check"], "csv.review": ["مراجعة بشرية", "Human review"], "csv.note": ["ملاحظة المراجع", "Reviewer's note"],
  "csv.origin": ["من أضافه", "Added by"], "csv.origin.manual": ["أضافه المراجع", "Added by the reviewer"],
  // ---- reviewer's tools: progress, shortcuts, manual entries, lookup, corrections, index, options
  "pg.line": ["راجعتَ {0} من {1}", "Reviewed {0} of {1}"], "pg.open": ["لم يُراجَع بعد ({0})", "Not reviewed yet ({0})"],
  "pg.open.title": ["أظهر فقط ما لم تحكم عليه بعد", "Show only the entries you have not given a verdict yet"],
  "e.manual": ["أضافه المراجع", "Added by the reviewer"], "e.manual.remove": ["أزِل هذه الإضافة", "Remove this addition"],
  "e.manual.note": ["اختار المراجع هذا المصدر بنفسه؛ الوصف من بحث المدونة عن هذه الكلمات.", "The reviewer chose this source; the status comes from searching the corpus for these words."],
  "e.manual.text": ["النص في المدونة:", "Text in the corpus:"],
  "e.find": ["ابحث عن مصدر هذا النص", "Find the source of this text"],
  "lk.title.free": ["ابحث في المدونة", "Search the corpus"], "lk.title.range": ["ابحث عن مصدر هذا النص", "Find the source of this text"],
  "lk.searching": ["يُبحث في المدونة…", "Searching the corpus…"], "lk.wait": ["بانتظار اكتمال تحميل المدونة…", "Waiting for the corpus to finish loading…"],
  "lk.type": ["اكتب أو الصق نصًّا ثم اضغط «ابحث».", "Type or paste a text, then press “Search”."],
  "lk.found": ["أقرب {0} من نصوص المدونة. الوصف يخص هذه الكلمات وحدها؛ راجع النص قبل الاختيار.", "The {0} closest corpus passages. The status is about these words alone; read the text before choosing."],
  "lk.none": ["لم يُعثر في المدونة على نص قريب من هذا. هذا لا يعني أن النص غير ثابت: قد يكون في كتاب خارج المدونة، أو بلفظ آخر.", "No close passage was found in the corpus. This does not mean the text is unsound: it may be in a book outside the corpus, or in other words."],
  "lk.err": ["تعذّر البحث: {0}", "The search failed: {0}"],
  "lk.cut": ["النص المحدَّد طويل: بُحث عن أول {0} كلمة فقط، وهي ما سيُضاف.", "The selection is long: only its first {0} words were searched, and only they would be added."],
  "lk.cut.free": ["النص طويل: بُحث عن أول {0} كلمة فقط.", "The text is long: only its first {0} words were searched."],
  "lk.st.verbatim": ["مطابق حرفيًا", "Verbatim match"], "lk.st.partial": ["مطابق جزئيًا", "Partial match"], "lk.st.meaning": ["قريب بالمعنى — ليس مطابقة لفظية", "Close in meaning — not a wording match"],
  "lk.add": ["أضِف إلى السجل بهذا المصدر", "Add to the ledger with this source"],
  "lk.clash": ["هذه الكلمات تتقاطع مع استشهاد موجود في السجل ({0})، فلا يُضاف فوقه.", "These words overlap a citation already in the ledger ({0}), so nothing is added over it."],
  "lk.scope": ["بُحث في: {0}.", "Searched: {0}."], "lk.scope.core": ["المدونة الأساسية (القرآن وتسع مجموعات حديثية)", "the core corpus (the Qur'an and nine hadith collections)"],
  "lk.scope.not": ["لم تُحمَّل: {0} (تُختار من صفحة البداية).", "Not loaded: {0} (tick them on the start page)."],
  "lk.en": ["النص بالإنجليزية وحزم الترجمات الإنجليزية غير محمَّلة، فلم يُبحث في الترجمات.", "The text is in English and the English translation packs are not loaded, so translations were not searched."],
  "lk.en.load": ["حمِّل الترجمات الإنجليزية وأعد البحث", "Load the English translations and search again"],
  "fix.label": ["تصحيح الكلمة «{0}»", "Correct the word “{0}”"],
  "fix.hint": ["Enter للحفظ، Esc للإلغاء. اتركها فارغة لحذف الكلمة.", "Enter saves, Esc cancels. Leave it empty to remove the word."],
  "fix.was": ["صحّحها المراجع. الأصل في التفريغ: {0}", "Corrected by the reviewer. As transcribed: {0}"],
  "fix.click": ["اضغط لتصحيح الكلمة إن أخطأ فيها التفريغ", "Click to correct this word if it was mis-transcribed"],
  "fix.undo1": ["تراجع عن تصحيح هذه الكلمة (الأصل: {0})", "Undo this correction (as transcribed: {0})"],
  "fix.count": ["كلمات مصحَّحة: {0}.", "Corrected words: {0}."], "fix.busy": ["يُعاد التحليل بالكلمات المصحَّحة…", "Analysing again with the corrected words…"],
  "idx.none": ["لا يوجد استشهاد مطابق لفظًا له زمن.", "There is no textual citation with a time."],
  "idx.notimes": ["النص بلا أزمنة، فلا يمكن عمل فهرس للفيديو.", "The transcript has no timestamps, so no video index can be made."],
  "idx.title": ["انسخ فهرس الاستشهادات بأزمنتها لوصف الفيديو", "Copy the index of citations with their times for the video description"],
  "idx.copied": ["نُسخ إلى الحافظة.", "Copied to the clipboard."], "idx.nocopy": ["تعذّر النسخ تلقائيًّا: حدِّد النص في المربع وانسخه.", "Could not copy automatically: select the text in the box and copy it."],
  "export.tool": ["أثَر — سجل الاستشهادات المنطوقة", "Athar — a ledger of spoken citations"],
  "export.disclaimer": ["مسوّدة آلية للمراجعة البشرية. «لم يُعثر عليه في المدونة» لا يعني أن النص غير صحيح.", "An automatic draft for human review. “Not found in the corpus” does not mean a text is inauthentic."],
};

/** selector -> [ar, en, attribute?] for the static page text (no attribute = the element's text) */
export const STATIC = [
  [".brand-what", "سجل الاستشهادات المنطوقة", "Ledger of spoken citations"],
  ["#btnNew", "تحليل جديد", "New analysis"], ["#btnLimits", "كيف يعمل وما حدوده", "How it works and its limits"],
  [".start h1", "ما الذي استشهد به المتحدث، وأين، وبأي لفظ؟", "What did the speaker quote, where, and in what words?"],
  [".lede", "يستخرج أثَر الآيات والأحاديث من تسجيل محاضرة أو خطبة، يربط كل استشهاد بلحظته في التسجيل، ويقارن ما قيل بنص المصدر كلمةً كلمة، ثم يُخرج نص المحاضرة بحواشٍ فيها مصدر كل استشهاد، جاهزًا للمراجعة. لا يحكم على صحة حديث؛ يُريك ما وجده في مدونته وما لم يجده.",
    "Athar extracts the Qur'an verses and hadith quoted in a lecture or sermon, links each one to its moment in the recording, compares what was said with the source text word by word, and produces the transcript with a source footnote for every citation, ready for review. It does not judge authenticity; it shows what it found in its corpus and what it did not."],
  ["#specimen", "مثال من السجل: حديث قيل بلفظ يختلف عن المصدر في كلمتين", "An example from the ledger: a hadith spoken with two words that differ from the source", "aria-label"],
  ["#specKind", "حديث", "Hadith"], ["#specStatus", "مطابق جزئيًا", "Partial match"], ["#specSpoken", "ما قيل", "Spoken"], ["#specSource", "في المصدر", "In the source"],
  ["#specNote", "فرقان في اللفظ", "two wording differences"],
  ["#packs legend", "كتب إضافية يُبحث فيها (تُحمَّل عند الاختيار)", "Extra books and translations to search (loaded when ticked)"],
  ["#wayAudio h2", "تسجيل صوتي أو مرئي", "Audio or video recording"],
  ["#audioHint", "mp3 أو m4a أو wav أو mp4. يُفرَّغ التسجيل ثم يُحلَّل.", "mp3, m4a, wav or mp4. The recording is transcribed, then analysed."],
  ["#recLangLabel", "لغة التسجيل", "Language of the recording"],
  ["#recLang option[value=ar]", "عربي", "Arabic"], ["#recLang option[value=en]", "إنجليزي", "English"],
  ["#recLang option[value='en+ar']", "إنجليزي مع تلاوة عربية (تفريغ مرّتين)", "English with Arabic recitation (two passes)"],
  ["#wayText h2", "نص مفرَّغ جاهز", "A ready transcript"],
  ["#wayTextHint", "الصق نص المحاضرة بالعربية أو الإنجليزية، أو ملف تفريغ (JSON من Whisper أو SRT/VTT) لتبقى الأزمنة.", "Paste the lecture text in Arabic or English, or a transcript file (Whisper JSON, SRT/VTT) to keep the timings."],
  ["#btnAnalyzeText", "حلِّل النص", "Analyse the text"], ["#transcriptFileLabel", "أو اختر ملف تفريغ أو جلسة محفوظة", "or choose a transcript file or a saved session"],
  ["#videoLabel", "رابط الفيديو (اختياري)", "Video link (optional)"],
  ["#ytHint", "من يوتيوب: افتح «عرض النص المكتوب» تحت الفيديو، انسخه كله بأزمنته والصقه هنا، وضع رابط الفيديو ليُفتح عند لحظة كل استشهاد.", "From YouTube: open “Show transcript” under the video, copy all of it with its timestamps and paste it here; add the video link so each citation opens at its moment."],
  ["#btnDocx", "النص المخرَّج (Word)", "Cited transcript (Word)"], ["#btnSave", "حفظ الجلسة", "Save session"],
  ["#waySample h2", "جرّب على مثال", "Try a sample"],
  ["#waySample .way-sample-head p", "نصوص تجريبية بلا صوت، لترى شكل السجل قبل أن ترفع شيئًا.", "Sample texts without audio, to see the ledger before you upload anything."],
  ["#btnCsv", "تنزيل CSV", "Download CSV"],
  ["#btnJson", "تنزيل JSON", "Download JSON"], ["#btnPrint", "طباعة التقرير", "Print the report"],
  ["#map", "خريطة الاستشهادات على طول التسجيل؛ تنقَّل بين المواضع بالأسهم", "Map of the citations along the recording; move between spots with the arrow keys", "aria-label"],
  ["#filters", "إظهار الأوصاف وإخفاؤها", "Show or hide statuses", "aria-label"],
  ["#legend", "مفتاح علامات الفروق", "Key to the difference marks", "aria-label"],
  ["#lgAsr", "فرق يُرجَّح أنه من التفريغ", "difference probably from transcription"], ["#lgNear", "حرف مختلف (تفريغ أو لفظ)", "one letter differs (transcription or wording)"],
  ["#lgDiff", "لفظ مختلف عن المصدر", "wording differs from the source"], ["#lgIns", "زيادة ليست في المصدر", "added, not in the source"],
  ["#lgDel", "في المصدر ولم تُنطَق", "in the source, not spoken"],
  [".k", "كلمة", "word"],
  [".transcript-wrap h2", "النص المفرَّغ", "Transcript"],
  ["#transcript", "النص المفرَّغ؛ تنقَّل بين مواضع الاستشهاد بالأسهم", "Transcript; move between citation spots with the arrow keys", "aria-label"],
  ["#limits", "كيف يعمل أثَر وما حدوده", "How Athar works and its limits", "aria-label"],
  ["dialog .x", "إغلاق", "Close", "aria-label"],
  ["#btnSearch", "ابحث في المدونة", "Search the corpus"],
  ["#optMushafLabel", "اكتب الآيات المطابقة برسم المصحف", "Write matched verses in Mushaf spelling"],
  ["#optMushafWrap", "في ملف Word: الآية المطابقة كلمةً بكلمة تُكتب بنص المصحف (مشروع تنزيل)؛ الجزئية وما سواها يبقى كما فُرِّغ", "In the Word file: a verse matched word for word is written with the Mushaf text (Tanzil); partial matches and everything else stay as transcribed", "title"],
  ["#btnIndex", "فهرس للوصف", "Index for video description"],
  ["#committeeTitle", "ملخّص للجنة المراجعة", "Summary for the review committee"],
  ["#btnKeys", "اختصارات لوحة المفاتيح (؟)", "Keyboard shortcuts (?)"],
  ["#csearchQ", "ابحث في المدونة", "Search the corpus", "placeholder"], ["#csearchQ", "ابحث في المدونة عن نص", "Search the corpus for a text", "aria-label"],
  ["#csearchGo", "ابحث", "Search"], ["#lookupGo", "ابحث", "Search"],
  ["#lookupQ", "اكتب أو الصق نصَّ آية أو حديث", "Type or paste the words of a verse or hadith", "placeholder"], ["#lookupQ", "نص يُبحث عنه في المدونة", "Text to search the corpus for", "aria-label"],
  ["#trHint", "ظلِّل نصًّا فاتَ الأداةَ للبحث عن مصدره. لتصحيح كلمة في استشهاد: حدِّده ثم اضغط الكلمة.", "Select words the tool missed to look for their source. To correct a word inside a citation: select the citation, then click the word."],
  ["#btnUndoFixes", "تراجع عن كل التصحيحات", "Undo all corrections"],
  ["#selAct", "ابحث عن مصدر هذا النص", "Find the source of this text"],
  ["#lookupAdjust", "تعديل حدود النص", "Adjust where the text begins and ends", "aria-label"],
  ["#lkStartLabel", "أوله:", "Start:"], ["#lkEndLabel", "آخره:", "End:"],
  ["#lkA1", "كلمة أقل", "one word less"], ["#lkA0", "كلمة أكثر", "one word more"], ["#lkB1", "كلمة أقل", "one word less"], ["#lkB0", "كلمة أكثر", "one word more"],
  ["#lkA1", "احذف كلمة من أول النص", "Drop a word from the start", "aria-label"], ["#lkA0", "أضف الكلمة السابقة إلى أول النص", "Add the previous word at the start", "aria-label"],
  ["#lkB1", "احذف كلمة من آخر النص", "Drop a word from the end", "aria-label"], ["#lkB0", "أضف الكلمة التالية إلى آخر النص", "Add the next word at the end", "aria-label"],
  ["#lookupClashOpen", "افتح ذلك الاستشهاد", "Open that citation"],
  ["#indexTitle", "فهرس الاستشهادات لوصف الفيديو", "Citation index for the video description"],
  ["#indexHint", "سطر لكل استشهاد مطابق لفظًا له زمن (وما أضافه المراجع)، دون ما حكمتَ عليه بأنه غير صحيح. الصقه في وصف الفيديو.", "One line per textual citation that has a time (and those you added), leaving out the ones you marked incorrect. Paste it into the video description."],
  ["#indexIntroLabel", "أضف «0:00 المقدمة» (يوتيوب يشترط أن تبدأ الفصول من 0:00)", "Add “0:00 Introduction” (YouTube needs chapters to start at 0:00)"],
  ["#indexCopy", "انسخ", "Copy"],
  ["#footCorpus", "المدونة الأساسية: القرآن الكريم وتسع مجموعات حديثية. الكتب الإضافية: تفسير ابن كثير والجلالين، بداية المجتهد وعمدة الفقه، سيرة ابن هشام وزاد المعاد، الطحاوية والواسطية، رياض الصالحين وبلوغ المرام، وترجمات إنجليزية منشورة. «لم يُعثر عليه في المدونة» لا يعني أن النص غير صحيح.",
    "Core corpus: the Qur'an and nine hadith collections. Optional: Tafsir Ibn Kathir and al-Jalalayn, Bidayat al-Mujtahid and Umdat al-Fiqh, Sirat Ibn Hisham and Zad al-Ma'ad, al-Tahawiyya and al-Wasitiyya, Riyad al-Salihin and Bulugh al-Maram, and published English translations. “Not found in the corpus” does not mean a text is inauthentic."],
  ["#fc1", "نص القرآن:", "Qur'an text:"], ["#fcTanzil", "مشروع تنزيل", "Tanzil Project"],
  ["#fc2", "(CC BY 3.0، معروض بلا تغيير). نصوص الأحاديث والأحكام والترجمات الإنجليزية: hadith-api و quran-api (fawazahmed0). الكتب:", "(CC BY 3.0, shown unchanged). Hadith texts, gradings and English translations: hadith-api / quran-api (fawazahmed0). Books:"],
  ["#fc3", "(CC BY-NC-SA 4.0، للاستعمال غير التجاري).", "(CC BY-NC-SA 4.0, non-commercial)."],
  ["#repoLink", "الشيفرة والتوثيق", "Code & documentation"],
];

export function setLang(l) {
  lang = LANGS.includes(l) ? l : "ar";
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = t("title");
  const k = lang === "ar" ? 1 : 2;
  for (const row of STATIC) document.querySelectorAll(row[0]).forEach(el => { if (row[3]) el.setAttribute(row[3], row[k]); else el.textContent = row[k]; });
  document.querySelectorAll("[data-lang-only]").forEach(el => { el.hidden = el.dataset.langOnly !== lang; });
}
export const has = key => Object.prototype.hasOwnProperty.call(D, key);
/** translate a key; {0},{1}… are filled from args */
export function t(key, ...args) {
  const row = D[key]; if (!row) return key;
  return row[lang === "ar" ? 0 : 1].replace(/\{(\d)\}/g, (_, i) => args[+i] ?? "");
}
/** like t(), but an unknown key gives "" (codes the engine may add later must never show as raw keys) */
export const tOpt = (key, ...args) => (has(key) ? t(key, ...args) : "");
export const num = n => (lang === "ar" ? Number(n).toLocaleString("ar-EG") : Number(n).toLocaleString("en"));

// ---------------- source labels ----------------
// The engine's labels are Arabic. In the English interface the label is rebuilt from the source's own fields
// (surah and verse numbers, collection and hadith number); nothing is translated by machine. Book titles stay as they are.
const EN_SURAHS = ["Al-Fatihah", "Al-Baqarah", "Aal Imran", "An-Nisa", "Al-Ma'idah", "Al-An'am", "Al-A'raf", "Al-Anfal", "At-Tawbah", "Yunus", "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr", "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Ta-Ha",
  "Al-Anbiya", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan", "Ash-Shu'ara", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum", "Luqman", "As-Sajdah", "Al-Ahzab", "Saba", "Fatir", "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir",
  "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah", "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf", "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman", "Al-Waqi'ah", "Al-Hadid", "Al-Mujadilah", "Al-Hashr", "Al-Mumtahanah",
  "As-Saff", "Al-Jumu'ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq", "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij", "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah", "Al-Insan", "Al-Mursalat", "An-Naba", "An-Nazi'at", "Abasa",
  "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj", "At-Tariq", "Al-A'la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad", "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh", "At-Tin", "Al-Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-Adiyat",
  "Al-Qari'ah", "At-Takathur", "Al-Asr", "Al-Humazah", "Al-Fil", "Quraysh", "Al-Ma'un", "Al-Kawthar", "Al-Kafirun", "An-Nasr", "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas"];
const EN_COLLECTIONS = { bukhari: "Sahih al-Bukhari", muslim: "Sahih Muslim", abudawud: "Sunan Abi Dawud", tirmidhi: "Jami' at-Tirmidhi", nasai: "Sunan an-Nasa'i",
  ibnmajah: "Sunan Ibn Majah", malik: "Muwatta Malik", nawawi: "An-Nawawi's Forty Hadith", qudsi: "Forty Hadith Qudsi" };

const AR_SHORT = { bukhari: "البخاري", muslim: "مسلم", abudawud: "أبو داود", tirmidhi: "الترمذي", nasai: "النسائي", ibnmajah: "ابن ماجه", malik: "موطأ مالك", nawawi: "الأربعون النووية", qudsi: "الأحاديث القدسية" };
/** the name of a hadith collection as it is said in a list ("البخاري ٣، مسلم ٢"); an unknown key is returned as it is */
export const collectionName = key => (lang === "ar" ? AR_SHORT[key] : EN_COLLECTIONS[key]) || String(key);

/** label of a source in the interface language. short=true gives the compact form used in lists and tooltips. */
export function srcLabel(s, short = false) {
  if (!s) return "";
  const given = (short ? s.short : s.label) || s.label || s.short || s.ref || "";
  let out = given;
  if (lang === "en") {
    if (s.type === "q" && s.surah >= 1 && s.surah <= 114 && s.ayah) {
      const name = `${EN_SURAHS[s.surah - 1]} (${s.surah})`, b = s.ayahEnd || s.ayah;
      out = short ? `${EN_SURAHS[s.surah - 1]} ${s.surah}:${s.ayah}${b !== s.ayah ? "–" + b : ""}` : b === s.ayah ? t("src.q.one", name, s.ayah) : t("src.q.many", name, s.ayah, b);
    } else if (s.type === "h" && EN_COLLECTIONS[s.collection]) {
      const name = EN_COLLECTIONS[s.collection], none = s.numberMissing || s.number == null || s.number === "";
      out = none ? t("src.h.nonumber", name) : short ? `${name} ${s.number}` : t("src.h", name, s.number);
    }
  }
  if (s.numbering === "dataset" && !short && !out.includes(t("src.numbering.dataset"))) out += " " + t("src.numbering.dataset");
  return out;
}
/** tests run without a page: set the language only */
export function setLangForTests(l) { lang = LANGS.includes(l) ? l : "ar"; }
