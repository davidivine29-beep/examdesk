# ExamDesk

A simple computer-based test (CBT) app for school mid-term and end-of-term tests.
Classes are the centre of it: each class has its own class list, papers and results.
Children pick their class, then their name, then the subject, and write the paper in a browser.
Teachers upload class lists (.xlsx or .csv) and papers (.docx), and see every child's results in one place.

It runs on any phone, tablet or computer with a modern browser, and keeps working if the internet drops mid-test.

## What teachers can do
- Upload a class list from Excel or CSV (names only, no ID numbers).
- Upload a paper from Word. Mark correct answers with `[CORRECT]`. The import preview shows how the first questions were read.
- Set the duration, pass mark, shuffling, and whether children see their score.
- See results per class, per child (all subjects together) and per paper, and save them as Excel.

## Put it online (about 15 minutes, free)
You need a free [GitHub](https://github.com) account and a free [Netlify](https://netlify.com) account.

1. On GitHub, make a new repository and upload all the files from this folder (the "Add file > Upload files" button works in the browser).
2. On Netlify, choose **Add new site > Import an existing project**, connect GitHub, and pick the repository.
3. Leave the settings as they are and deploy. Netlify reads `netlify.toml`, builds the page and sets up the small server function.
4. Open your new site address.

## First use (do this straight away)
1. Open your site, press **Examiner**, and create your passcode (at least 8 characters).
2. Add your classes, class lists and papers.
3. Go to **Publish and backup** and press **Save to server**.
   The first save locks the site to your passcode, so do it before sharing the address.
4. Give children the site address. Every device gets whatever you last saved.

## Changing things later
Edit in ExamDesk and press **Save to server**. Devices pick the change up the next time they open the page.
Do not save during a sitting: a child already inside a test keeps the version they started with.

## Written questions and templates
Papers can mix multiple choice, fill-in-the-blank and theory questions. In the examiner page open **Papers** and use **Templates to fill in** to download a Word file for each kind (or put the sample in the paste box). The templates explain the format inside them.

- **Marks:** put the section marks in the heading (`Section B | 10 marks`, or `| 2 marks each`) and they are shared equally; end a question with `[3 marks]` to give it its own.
- **Fill in the blank:** gaps are `____`; the next line is `Answer: photosynthesis | photosynthesise`. Two gaps use `Answer 1:` and `Answer 2:`.
- **Theory:** a `Rubric: sunlight | carbon dioxide / CO2 | chlorophyll (2)` line lists the keywords.
- Theory scores stay **Provisional** until a teacher confirms them in the **Marking** tab. Every change is kept with the marker\u2019s name and the time.

## Results
When a child submits, the paper is marked on their device and the result is saved there first. It is then sent
to the school server in the background, and the child sees either "saved to the school server" or
"saved on this device, will be sent when the connection is back".

- If the network drops, the result stays on the device and is sent automatically later, as soon as the device is online
  and ExamDesk is open. It is never deleted from the device after sending, so there is always a second copy.
- On the examiner pages, results from every device come from the server. Press **Refresh results** to pull the latest.
  A banner on the examiner page shows how many results on this device still have not reached the server.
- **Before devices go back to their owners:** open ExamDesk once on each device while it has internet.
  This sends anything still waiting.
- **Save results file** and **Merge results file** still work as a manual backup.
- **Clear results** (Publish and backup page) clears the device and, when signed in, the server too. Use it between terms.
- Phones and tablets cannot send in the background while the page is closed, so a result waiting on a device is sent
  the next time ExamDesk is opened there.

## Things to know before you rely on it
- **Papers include the answer key** in what the page downloads, so a technical child could find the answers.
  Use it for classroom tests, not for high-stakes exams.
- **The passcode** stops access to the examiner pages and is checked on the server. It must be at least 8 characters.
  After 10 wrong guesses in 10 minutes the server locks the passcode for 5 minutes.
- **Anyone can send a result, only the examiner can read them.** The server only accepts a result for a class, paper and
  child that exist in the saved setup, and keeps at most 3 copies per child and paper.
- **First visit needs internet.** After one visit the page also opens offline.
- **Forgot the passcode?** In your Netlify site, open the **Blobs** storage for the site and delete the `auth` entry, then set a new passcode.
  (Check Netlify's current documentation for where Blobs appear in the dashboard.)

## One site per school
Each school gets its own copy: in Netlify, add a new site from the same repository and name it, for example,
`examdesk-schoolname`. Each site has its own storage, so schools never see each other's classes or results.
The school then adds its own classes, class lists and papers. Set the **School name** on the Publish and backup page:
it appears in the browser tab and as the name of the installed app.
Pushing a change to the repository redeploys every linked site, so test before you push.

## Installing as an app
Phones and computers can install the page to the home screen or desktop, with the ExamDesk icon.
After an update to the icons, remove the old installed copy and install it again.

## Cloudflare Pages without Git (drag and drop)
Run `npm run build:cloudflare`. It makes a folder `cloudflare-upload` holding the finished site and one bundled `_worker.js`.
In the Cloudflare dashboard create a Pages project with **Upload assets**, drag that folder in and deploy, then create a D1 database
and bind it to the project as `DB` (Settings, then Bindings), and redeploy once. Cloudflare's drag-and-drop deploys accept a `_worker.js`
but do not compile a `functions` folder, which is why this bundled file exists. The same folder is shipped ready-made as `examdesk-cloudflare-upload.zip`.

## Hosting on Cloudflare Pages from Git
The server part also runs on Cloudflare Pages with a D1 database (free tier). Labels in Cloudflare's dashboard change now and then.
1. In the Cloudflare dashboard open **Workers & Pages**, create a **Pages** project and connect it to your GitHub repository.
2. Build settings: framework **None**, build command left empty, build output directory **public**. Save and deploy.
3. Create a D1 database (**Storage & databases**, then **D1**), for example named `examdesk`.
4. In your Pages project open **Settings**, then **Bindings**, add a **D1 database** binding with the variable name **DB**, pick your database, and save.
5. Redeploy (Deployments, then retry the latest deployment) so the binding takes effect.
6. Open the site, create the examiner passcode, add your classes and press **Save to server**.
The server code is `functions/api/[[route]].js`, using the adapter in `lib/d1-store.mjs`. The Netlify version is `netlify/functions/api.mjs`. Both share `lib/handler.mjs`.

## Not on Netlify?
All server logic is in `lib/handler.mjs` and works with any storage that has `get(key)` and `set(key, value)`.
`netlify/functions/api.mjs` shows the wiring. Adding another host means writing one small file like it.
Without any server, the page still works as a static site: use **Download page file** and upload it to your host to update.

## Developing
```
npm install
npm run build   # makes public/index.html from src/examdesk.html
npm test        # tests the server logic (accounts, lockout, results)
```
The app is one file, `src/examdesk.html`. `build.mjs` puts the two libraries (JSZip, SheetJS) inside it.

## Licence
Add a LICENSE file before publishing. (MIT lets anyone reuse it freely. AGPL requires modified versions to stay open.)


## Licensing a school (vendor)

1. Create the school's site from this repo (Base directory as needed). In the site's environment variables set `TIER` (core, growth, campus or max) and `XD_VENDOR_KEY` (a long random secret only you know, 16+ characters), then redeploy.
2. Set the licence: `node tools/set-licence.mjs https://SITE.netlify.app YOUR-KEY core 2027-01-31 "School name"`.
3. Renew or upgrade the same way. It takes effect immediately, no redeploy (a higher tier's features also need the site's `TIER` raised and a redeploy).
4. Check a school: `node tools/set-licence.mjs https://SITE.netlify.app`.

Rules: over the student cap or past the paid-until date plus 14 grace days, the school cannot save setup changes. Sittings and result submissions are never blocked. Without a licence record the site runs unlimited (for your own testing).
