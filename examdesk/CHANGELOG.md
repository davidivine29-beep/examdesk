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
