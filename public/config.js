// Site configuration (public — NO secrets here). Set asrUrl to your Cloudflare Worker after deploying it.
window.ATHAR_CONFIG = {
  asrUrl: "https://athar-asr.athar-7399079d.workers.dev",   // the project's Worker; it also answers http://localhost:8788 ("" = audio upload disabled)
  llm: false,                    // true only if the Worker has LLM_PROVIDER configured (optional "by meaning" helper)
  repo: "https://github.com/Ahmedanwernouser/athar-ledger",                      // full URL of the project's repository, shown in the footer ("" = no link)
};
