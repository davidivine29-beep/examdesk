## Teacher accounts and arms (Growth and above)
- The administrator adds teachers (Teachers page) with a name and passcode. Each teacher is a **form teacher** of a class or a single arm, a **subject teacher** for a subject in a class, or both, in any number of classes.
- Teachers sign in with "I am a teacher" and only see the classes, arms and subjects assigned to them. The server enforces it: results and marks outside their scope are never sent, and marks outside it are refused.
- A form teacher can change any mark for their children; a subject teacher marks only their subject. Every change is recorded under the teacher\u2019s own name, which cannot be set to someone else\u2019s.
- Classes can be split into arms (A, B, ...) with each child placed in one; the register and class export show the arm.
- Passcodes cannot match the administrator\u2019s; wrong guesses lock only that teacher; removing a teacher ends their access. Core licences are refused by the server.

## Written questions and marking (stage 2, in every tier)
- Three question types: multiple choice, fill in the blank (auto-marked) and theory (keyword rubric).
- Marks: a section\u2019s marks are shared equally between its questions, or a question can state its own (`[3 marks]`, parts `4a.` `4b.`). Children see the total marks.
- Fill in the blank: case, spacing and trailing punctuation ignored; `1,000` and `1000` are the same; a one-letter slip in a word of five or more letters earns half marks; several accepted answers with `|`.
- Theory: the software ticks rubric keywords (synonyms with `/`, a mark after a keyword with `(2)`), suggests a mark, and the result stays **Provisional** until the teacher confirms or changes each theory mark. Papers can also have theory written on paper, with marks typed in by the teacher.
- Marking tab: keyword highlights, per-question marks, confirm one or all, accept a spelling, marker name. Every change is kept (original, who, when) and syncs between examiner devices (`/api/marks`).
- Results, child pages, register, analysis and the .xlsx exports show Provisional or Final.
- Downloadable .docx templates (multiple choice, fill in the blank, theory, all types) and the same text for the paste box.
- Server: results may carry typed answers (up to 100 KB each); `/api/marks` is examiner-only and follows the licence rules; clearing results clears marks.

## Licence foundation (stage 1)
- Each school site now has a licence record: plan (core, growth, campus, max), student cap, paid-until date, grace days and enforcement (block or warn).
- Only the vendor key can set it (environment variable `XD_VENDOR_KEY` on the site; at least 16 characters). Use `tools/set-licence.mjs`.
- Saving the setup is refused above the student cap (a school already over its cap can still shrink or edit) and after the paid-until date plus grace. Candidate sittings, result submissions, examiner sign-in and reading results are never blocked.
- Examiner Publish and backup page shows a Licence card; messages explain a refused save in plain words.
- `TIER` build setting (core, growth, campus, max; default core) leaves higher-tier code out of the build.

# Changes

## v2
- Git-free Cloudflare upload folder (bundled `_worker.js`). The server no longer uses Node-only code, so it also runs on Cloudflare Workers.
- Server runs on Cloudflare Pages (D1) as well as Netlify. Same tests run against both storage adapters.
- The built `public/index.html` is now committed, so the site works even if no build runs.
- ExamDesk logo in the page header.
- Results are sent to the server when a child submits, kept on the device first, and retried until they arrive.
  Candidates and examiners see clear status lines. Examiner pages read results from the server.
- Clear confirmation toast when papers are added, visible wherever you are on the page.
- The "lines skipped" notice on paper import is now a calm note, and only becomes a warning when a skipped line looks like a question.
- ExamDesk icon, home-screen name and installable app manifest. The school name becomes the tab and app name.
- Passcode must be at least 8 characters, with a server lockout after repeated wrong guesses.
- Service worker also caches the icons for offline use.

## v1
- Class-based CBT, Word paper import, Excel class lists, per-child results, offline use, Save to server.
