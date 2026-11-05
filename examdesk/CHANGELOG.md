## Campus plan
- **White-label.** The school's own logo, name and colour replace ExamDesk wording on every page, the candidate screen and printouts.
- **Stores 1,000 children comfortably.** Data is mirrored to the browser's database as well as local storage, so large rolls and result sets do not hit storage limits.
- **AI report card comments.** Pick preset chips (good but could be better, not very good, pays attention in class, very kind, and so on), add rough notes, and the AI smooths them into a comment. One child or the whole class; counted against the site's comment allowance.
- **Random papers from a question pool.** Set how many questions each child gets; every child is drawn a different paper, and the intro page shows the drawn count.
- **Annual report card and year-end promotion.** Close each term, print the annual card (average as a percentage, class position optional), then promote children to the next class in one step, with a confirmation.
- **Activity log and exam officer role.** Setup changes, passcode changes, result clearing and teacher changes are logged. A teacher can be an exam officer with school-wide marking rights but no access to the log.
- **Exam integrity log.** While a child writes, the page notes each time it was left and for how long, and when the device went offline. Shown as a flag on results and a table in Analysis. It is a prompt to look, not a verdict.
- **School overview.** One page for the administrator: every class, subject averages across classes, pass rates, top child per class, papers nobody has written, and a downloadable school broadsheet (.xlsx).

## Scheduled papers, blank papers, answer keys off devices, tighter security
- **Scheduled papers.** Each paper can have an *Opens at* and *Closes at* time. Switch the paper on, set the times, and it opens and closes itself. Devices receive the paper up to 12 hours early (so a device prepared the evening before works) but keep it shut until the opening time. A child already writing when it closes may finish.
- **Blank question paper and teacher's copy** (Growth and above): Report cards tab → Printouts for a paper. Same layout as the answer script; the teacher's copy marks the right answers.
- **Class position on report cards** is its own tick-box on the Report cards tab.
- **Keep the answers off children's devices** (per-paper setting). The pupil's device never receives the key, explanations or marking points. The pupil sees "Test submitted"; the score appears on the teacher's side once the answers reach the server. Needs the school server; on a site with no server the key is on the device as before.
- **Stored passcodes are salted and stretched** (PBKDF2, 100,000 rounds). Sites on older plain hashes upgrade automatically at the next sign-in.
- **Set-up code.** In the vendor console a site can be given a set-up code; the first save of a brand-new site must carry it, so a stranger who finds the link first cannot claim the site.
- **Security headers** on every page (no sniffing, no framing, no referrer, no camera/mic/location). API replies are never cached.

## Report cards (Growth and above)
- New **Report cards** tab on each class. Prints a mid-term card (score out of 40) or an end-of-term card (mid-term out of 40 + end-term exam out of 60 = total out of 100, with grade and remark), one page per child, or the whole class at once. Use the browser's Print, or choose Save as PDF.
- In each paper's settings choose **Counts on the report card as** mid-term or end-of-term exam. Papers of the same subject combine; a child's total and average only appear once every subject has a mark; unconfirmed (provisional) marks are starred.
- School details (address, contacts, section tags, logo, term, academic year, next term, signature name) are set once and shared by every class; age, reg. no and the two comments are typed per child. Class position shows when the class setting "Show class positions" is on. Grades: A 70+, B 60+, C 50+, D 45+, E 40+, F below.
- Passport photos are stored on the computer where you add them (not in the shared setup), so print from that computer. Candidates opening a class never receive reg. numbers or comments.

## Answer scripts (Growth and above)
- Report cards tab → **Answer scripts**: print a pupil's paper with their own answers, the mark beside each question, the correct answers and the total, laid out like the school's paper (header, NAME/CLASS/SUBJECT/DATE, sections). Works for imported papers with sections. Questions and options appear in the order that pupil saw them. Print one pupil or everyone who sat the paper.
- Saved results now keep the question order and option order (`ord`, `perm`). Results saved before this update print in paper order.

## Candidate device set-up
- On the Classes page the administrator can press **Set up this device for candidates**. Every class opens on that device for 12 hours, so children pick their names with no code. Press Lock afterwards. Other devices (children's own phones) still ask for the class code.

## Question bank and AI questions (Growth and above)
- A shared **Question bank** page (administrator and teachers). Questions are saved one per record with subject, class, topic and kind. Write one by hand, save the questions of any paper to the bank, or pick bank questions to build a new paper (administrator).
- **Generate with AI** makes up to 20 draft questions (multiple choice, fill-in-the-blank or theory with a keyword rubric) for a subject, level and topic, optionally from notes the teacher pastes. Drafts are never used until a teacher accepts them; each shows the answer and a one-line reason. The teacher checks the answers.
- Allowance per term: Growth 100, Campus 500, Campus Max 1,000 generations. Unused term allowance does not carry over. Extra packs bought from you never expire and are used after the term allowance. Two replacements per set of drafts are free; further ones cost a generation. A failed or unusable AI reply is never charged.
- Each school uses its own Anthropic key, set as the environment variable `XD_AI_KEY` on that school's site (with the model fixed to Sonnet 5.5). Without it the button is off and the rest of the bank still works.
- Vendor console: shows generations left and whether the AI key is set, adds +100/+200/+500 packs, and a "start a new term" box that resets the term allowance.

## Private class lists and administrator reset
- On a school server the public page now learns class names only. A child opens a class by typing its **class access code**; only then do that class's names and open papers reach the device. Codes are made automatically (6 characters) and can be changed or renewed with **New code** in the class Settings. After a renewal the old code no longer opens the class, but results written under it still arrive.
- Results must carry the class token; guessing codes or tokens is counted per network address and locked for 5 minutes after 40 wrong tries.
- Locking the examiner pages removes the class lists from that device. A device that holds only the public or a teacher's partial copy can never overwrite the real setup.
- **Forgotten administrator passcode:** in the vendor console choose *Reset administrator passcode*. It sets a temporary passcode (shown once), signs out anyone signed in, and leaves classes, papers and results untouched. The school then changes it under Publish and backup.
- A class must be opened with the internet, then keeps working on that device for 6 hours even offline.

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
