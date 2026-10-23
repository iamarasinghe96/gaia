# Working rules for this repo

- Change only what the owner asks for. Do not reword, reorder, reformat or remove anything else.
- The AI prompts (`tools/AI_CV_Prompt.txt`, `tools/AI_Cover_Letter_Prompt.txt`) are guarded by
  `tests/prompt-guard.test.js`. Every approved prompt change is recorded in `tests/prompt-ledger.json`
  (what it was, what it became, and why). Add a ledger entry only for a change the owner asked for.
- Never drop saved user data. When a profile field changes shape, keep the old value and the old
  CV Bank line working (see the address, languages and Location Note handling in `tools/cv-builder.html`).
- Run `npm test` before every commit.
- Never commit personal data (CVs, CV Banks, IDs, phone numbers, addresses) or secrets.
