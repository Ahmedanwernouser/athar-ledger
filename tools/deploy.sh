#!/usr/bin/env bash
# One-command deployment of the site (Cloudflare Pages) and the Worker, used by .github/workflows/deploy.yml.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (repository secrets). Optional:
# GROQ_API_KEY, GEMINI_API_KEYS (the first key is given to the Worker as its secret GEMINI_API_KEY).
# Nothing secret is written to the repository: the KV id, the allowed origin and the Worker address are
# filled into COPIES under $WORK. Can be run again at any time; it changes only what differs.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-/tmp/athar-deploy}"; LOG="$WORK/deploy.log"
PROJECT="${PAGES_PROJECT:-athar-ledger}"
rm -rf "$WORK"; mkdir -p "$WORK"
say() { echo "$*" | tee -a "$LOG"; }
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  say "NOT DEPLOYED: add the repository secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."; exit 0
fi
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
cf() { curl -sS -m 60 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=process.argv[1].split(".").reduce((o,k)=>o==null?o:o[k],j);console.log(v==null?"":typeof v==="string"?v:JSON.stringify(v))}catch{console.log("")}})' "$1"; }
WR="npx -y wrangler@4"
fail=0

# ---- 1. Pages project (created once) and its real address ----
sub="$(cf "$API/pages/projects/$PROJECT" | jget result.subdomain)"
if [ -z "$sub" ]; then
  say "creating the Pages project $PROJECT"
  cf -X POST "$API/pages/projects" --data "{\"name\":\"$PROJECT\",\"production_branch\":\"main\"}" | jget errors | tee -a "$LOG"
  sub="$(cf "$API/pages/projects/$PROJECT" | jget result.subdomain)"
fi
[ -z "$sub" ] && { say "FAILED: no Pages project (does the token have the Pages permission?)"; exit 1; }
SITE="https://$sub"; say "site address: $SITE"

# ---- 2. KV namespace for the caps (created once) ----
kvid() { cf "$API/storage/kv/namespaces?per_page=100" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).result||[];const n=r.find(x=>x.title==="athar-CAP");console.log(n?n.id:"")}catch{console.log("")}})'; }
KV="$(kvid)"
if [ -z "$KV" ]; then say "creating the KV namespace athar-CAP"; cf -X POST "$API/storage/kv/namespaces" --data '{"title":"athar-CAP"}' | jget errors | tee -a "$LOG"; KV="$(kvid)"; fi
[ -z "$KV" ] && { say "FAILED: no KV namespace (does the token have the Workers KV permission?)"; exit 1; }
say "KV namespace ready"

# ---- 3. workers.dev address ----
wsub="$(cf "$API/workers/subdomain" | jget result.subdomain)"
if [ -z "$wsub" ]; then
  wsub="athar-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  say "registering a workers.dev subdomain"
  cf -X PUT "$API/workers/subdomain" --data "{\"subdomain\":\"$wsub\"}" | jget errors | tee -a "$LOG"
  wsub="$(cf "$API/workers/subdomain" | jget result.subdomain)"
fi
[ -z "$wsub" ] && { say "FAILED: no workers.dev subdomain"; exit 1; }
WORKER="https://athar-asr.$wsub.workers.dev"; say "Worker address: $WORKER"

# ---- 4. Worker: copy, fill the two placeholders, deploy, then the secrets ----
cp -r "$ROOT/worker" "$WORK/worker"; cd "$WORK/worker"
GEM="$(printf '%s' "${GEMINI_API_KEYS:-}" | tr ',;\n\t' '    ' | awk '{print $1}')"
sed -i "s#^ALLOWED_ORIGINS = .*#ALLOWED_ORIGINS = \"$SITE\"#; s#REPLACE_WITH_KV_NAMESPACE_ID#$KV#" wrangler.toml
if [ -z "${GROQ_API_KEY:-}" ] && [ -n "$GEM" ]; then sed -i 's#^ASR_PROVIDER = .*#ASR_PROVIDER = "gemini"#' wrangler.toml; say "no Groq key: Gemini is the default transcriber"; fi
$WR deploy >"$WORK/w.out" 2>&1 && say "Worker deployed" || { say "FAILED: wrangler deploy"; tail -25 "$WORK/w.out" | tee -a "$LOG"; fail=1; }
if [ $fail = 0 ]; then
  [ -n "${GROQ_API_KEY:-}" ] && { printf '%s' "$GROQ_API_KEY" | $WR secret put GROQ_API_KEY >"$WORK/s1.out" 2>&1 && say "secret GROQ_API_KEY set" || { say "FAILED: secret GROQ_API_KEY"; fail=1; }; }
  [ -n "$GEM" ] && { printf '%s' "$GEM" | $WR secret put GEMINI_API_KEY >"$WORK/s2.out" 2>&1 && say "secret GEMINI_API_KEY set" || { say "FAILED: secret GEMINI_API_KEY"; fail=1; }; }
  [ -z "${GROQ_API_KEY:-}" ] && [ -z "$GEM" ] && say "NOTE: no transcription key was given, so audio upload stays off"
fi

# ---- 5. site: copy, write the public config, deploy ----
cp -r "$ROOT/public" "$WORK/public"
HAVE_ASR=""; { [ -n "${GROQ_API_KEY:-}" ] || [ -n "$GEM" ]; } && [ $fail = 0 ] && HAVE_ASR="$WORKER"
cat > "$WORK/public/config.js" <<CFG
// Site configuration (public — NO secrets here). Written by tools/deploy.sh at deployment time.
window.ATHAR_CONFIG = {
  asrUrl: "$HAVE_ASR",
  llm: false,
  repo: "https://github.com/${GITHUB_REPOSITORY:-Ahmedanwernouser/athar-ledger}",
};
CFG
cd "$WORK"
$WR pages deploy public --project-name "$PROJECT" --branch main --commit-dirty=true >"$WORK/p.out" 2>&1 && say "site deployed" || { say "FAILED: pages deploy"; tail -25 "$WORK/p.out" | tee -a "$LOG"; fail=1; }

# ---- 6. checks from outside ----
sleep 20
say "site HTTP $(curl -sS -m 30 -o /dev/null -w '%{http_code}' "$SITE/")  config: $(curl -sS -m 30 "$SITE/config.js" | grep asrUrl | tr -s ' ')"
say "core data HTTP $(curl -sS -m 60 -o /dev/null -w '%{http_code} %{size_download} bytes' "$SITE/data/meta.json")"
say "Worker /health: $(curl -sS -m 30 "$WORKER/health")"
say "Worker refuses another origin: $(curl -sS -m 30 -X POST -H 'Origin: https://evil.example' "$WORKER/asr")"
# never leave an identifier in the published log
sed -i "s#$CLOUDFLARE_API_TOKEN#<TOKEN>#g; s#$CLOUDFLARE_ACCOUNT_ID#<ACCOUNT>#g; s#$KV#<KV>#g" "$LOG"
exit $fail
# run
