# Auto Job Agent — Setup

## Daily use: the dashboard

Double-click **`Auto Job.cmd`** in this folder. It starts the dashboard and n8n if needed, then opens http://localhost:5680.

- **Apply now** (the round button): runs today's search, tailoring and sending. A progress ring shows the stage.
- **n8n status / Start n8n**: top bar.
- **Apply every day at 9:00**: switches the schedule and the reply watcher on or off. This restarts n8n, which takes about a minute.
- **Applications**: every application with its status stamp. Click one to see the tailored PDF, cover email and panel notes, download the PDF, or re-tailor it.
- **Master resume**: upload a new .docx/.pdf. You check the converted version before it replaces the current one; old versions go to `resume/history/`.
- **Settings**: job titles, pay limits and applications per day.

- **Your search so far**: jobs found, matched, applied and replies (this week or all time). A bar shows how many were tailored and how many got the master resume as-is, plus how many wait in the pending pool.
- **Job library**: every job ever found, with its match score (0–100), what happened to it, and why skipped jobs were skipped. Click a row to see which skills matched.

**Match score:** jobs scoring 80+ get your master resume as-is (only the cover email is written). Lower scores get full `/hiring-panel` tailoring. Change the threshold in Settings.

**Relevant jobs:** a job is applied to only if it is in **Lahore or remote**, passes the pay/seniority rule, scores at least the minimum match score (70), and isn't restricted to female applicants. Everything else is recorded as Skipped, with the reason, in the job library.

**Daily limit:** "Applications a day" is 0, meaning every relevant job is applied to, with a safety limit of 40 a day. Set a number in Settings to cap it again.

**Job sources:**

| Source | How | Cost |
|---|---|---|
| LinkedIn + Indeed jobs | Apify, daily | ~$0.84/month |
| Google search | Apify Google Search, 3 rotating searches a day (`config.json` → `sources.googleSearch.queries`) | ~$0.41/month |
| LinkedIn hiring posts | Apify, public "we're hiring" posts from the last 24h | ~$0.96/month |
| Google Alerts | RSS feed links pasted in Settings | free |
| Job-site email alerts | Alert emails in your Gmail from Rozee.pk, Mustakbil, Glassdoor, Bayt, BrightSpyre, Jobz.pk, Google Alerts | free |

Google results, posts and alerts are only leads. `scripts/extract-jobs.js` opens each page, and Claude Haiku pulls out the job details and drops anything that isn't a job posting (about 1 request per 6 leads). After that they go through the same rules as every other job.

**Pending pool:** relevant jobs beyond the daily limit stay pending for up to 14 days and are applied to first on later days. All jobs live in `data/jobs.db`.

`node dashboard/seed-demo.js` then `node dashboard/demo.js` opens a preview on port 5681 with sample data, without touching your real files. After code changes, run `scripts/update-live.ps1`.

## How it works

**Workflow 1 — Daily Scrape, Tailor & Apply** (every day 09:00 PKT)

1. **Read config**, then check this month's Apify spend. If it has reached **$2.80**, nothing is scraped.
2. **Scrape** LinkedIn and Indeed PK (daily). Estimated cost is about **$0.66/month**. Google Jobs was dropped as too costly ($0.30 per run).
3. **Filter:** keep a job if its listed pay (top of the range) is at least the minimum pay set in Settings (**100,000 PKR/month**), or if no pay is listed and it is a **senior** role. Junior roles and internships are dropped. Jobs paying **≥ 200k** go first.
4. **Dedup** against `tracker/applications.xlsx`, by job ID and by company + title across sources. A job is never applied to twice.
5. **Daily cap:** at most `maxApplicationsPerDay` jobs (0 means no cap, with a safety limit of 40 a day).
6. For each job:
   - **Tailor:** `/hiring-panel` (a panel of Claude reviewers) rebuilds the resume for the posting. A cleanup pass then removes `[ADD:]` placeholders and writes the cover email, and the resume is rendered to an ATS-friendly PDF.
   - **If the listing contains an email:** send it through Gmail with the resume and a one-page cover letter attached as PDFs. Status = `Emailed`.
   - **If not:** status = `Apply manually`. The tailored PDF is ready in `applications/<date>-<company>-<role>/`.
   - **Log the row** in the Excel tracker.
7. **Email you a daily report:** what was sent, what to apply to manually, and Apify spend.

**LinkedIn feed** (with every Apply now, optional)

Claude opens LinkedIn in your own Chrome (it needs the Claude in Chrome extension and you signed in to LinkedIn), reads your home feed, and picks out hiring posts for your kind of role. Each new post goes through the same scoring and applying steps. It only reads: the comment it drafts appears in the job library for you to post yourself. Turn it off with `"linkedin": { "checkFeed": false }` in `config.json`.

**Workflow 2 — Reply Watcher** (polls Gmail every 15 min)

When an inbox email matches an application (same Gmail thread, the contact email, the company's domain, or the company name in the subject):

- Claude drafts a reply. It goes to **Gmail Drafts** in the same thread and is **never sent automatically**.
- A 30-minute **Google Calendar** event "Reply: Company – Role" is created (today +1h during working hours, otherwise 10:00 the next day).
- The tracker row is set to `Reply received`, with a summary.

**Workflows 3 and 4** are started by the dashboard: applying to a job you picked in the job library, and sending an email you wrote in the Emails & letters tab.

## One-time setup (you)

First run `powershell -ExecutionPolicy Bypass -File setup.ps1` in this folder. It installs the packages, creates `config.json` and `resume/master-resume.md` from the examples, installs the Claude skills and builds the workflow files.

### 1. Your resume and keywords
- Save your master resume as **`resume/master-resume.md`**. PDF or DOCX is fine too; set the path in `config.json` → `candidate.masterResume`.
- In `config.json` fill in `candidate.name`, `phone`, `linkedin`, and **`search.keywords`** (job titles, e.g. `["senior data analyst", "analytics manager"]`). Each keyword runs as its own search; the job budget is split across them.

### 2. Log the Claude CLI in (once)
```
claude
```
Run `/login`, sign in with your Claude account, then exit. n8n runs `claude -p` with this login. Each tailored job uses about 9 Claude calls from your plan.

### 3. Start n8n and create your owner account
```
powershell -ExecutionPolicy Bypass -File start-n8n.ps1
```
Open http://localhost:5678 and create the local owner account. It only exists on this PC.

### 4. Credentials in n8n (Credentials → Add)
| Name (use exactly) | Type | What to enter |
|---|---|---|
| **Apify API** | Header Auth | Name: `Authorization`, Value: `Bearer <your Apify token>` (Apify Console → Settings → API & Integrations) |
| **Gmail account** | Gmail OAuth2 API | Google Cloud OAuth client (see below) |
| **Google Calendar account** | Google Calendar OAuth2 API | Same OAuth client |

**Google OAuth client** (one time, about 5 minutes) at https://console.cloud.google.com:
1. Create a project, then enable the **Gmail API** and the **Google Calendar API**.
2. OAuth consent screen: External, add yourself as a **Test user**.
3. Credentials → Create OAuth client ID → *Web application*. Redirect URI: `http://localhost:5678/rest/oauth2-credential/callback`
4. Paste the Client ID and Secret into both n8n credentials and click **Sign in with Google**.

### 5. Import the workflows
```
powershell -ExecutionPolicy Bypass -File scriptssetup-credentials.ps1
powershell -ExecutionPolicy Bypass -File scriptsimport-workflows.ps1
```
The first command records the IDs of the three credentials you just made, so the workflows are linked to them. The second builds and imports the four workflows. Run both again whenever you add or rename a credential.

Open http://localhost:5678 and check each workflow: on any node showing a red credential warning, select the credential you made. Then switch on **Apply every day** and **Watch replies** in the dashboard.

## Tips and limits
- **Keep the PC on and logged in at 09:00.** `Auto Job.cmd` starts n8n when you open the dashboard. To start it at logon, put a shortcut to `start-n8n.ps1` in your Startup folder.
- **Close `applications.xlsx` in Excel during runs.** Excel locks the file, so the run can't write to it and records a failure.
- To **test safely**, set `maxApplicationsPerDay` to 1. Then in n8n open Workflow 1 and click **Test workflow**.
- Change the schedule in the first node, or the filters in `config.json` (no rebuild needed). If you edit `scripts/build-workflows.js`, run `node scripts/build-workflows.js` and re-import.
- Gmail allows about 500 sends/day for personal accounts. The safety limit of 40 a day stays far below that.
- `/hiring-panel` never invents facts. If your master resume lacks numbers or metrics, the panel drops those claims rather than making them up. A strong master resume gives strong tailored resumes.
