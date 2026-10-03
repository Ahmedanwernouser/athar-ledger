// Site configuration (public — NO secrets here). Set asrUrl to your Cloudflare Worker after deploying it.
window.ATHAR_CONFIG = {
  asrUrl: "",                    // e.g. "https://athar-asr.YOUR-ACCOUNT.workers.dev"   ("" = audio upload disabled)
  llm: false,                    // true only if the Worker has LLM_PROVIDER configured (optional "by meaning" helper)
  repo: "",                      // full URL of the project's repository, shown in the footer ("" = no link)
};
