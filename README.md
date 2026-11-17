# Auto Job

A dashboard on your own PC that runs your job search. Every day it finds new jobs, scores each one against your resume, rewrites your resume for the ones worth applying to, emails the application with your resume and a cover letter attached, and tells you when an employer replies.

Your resume, applications and job library stay on your PC. The only things that leave it are the emails you send, the job searches (Apify), and the text Claude reads to write for you.

## What it does

- **Finds jobs daily** from LinkedIn and Indeed, Google searches, job-alert emails, RSS feeds, and hiring posts in your own LinkedIn feed.
- **Scores every job 0 to 100** against your resume, and records why a job was skipped (pay, city, seniority, low match).
- **Tailors your resume.** A strong match (80+) gets your master resume as it is. A weaker one is rewritten for the posting by a panel of Claude reviewers, using only facts from your resume.
- **Applies by email** through your Gmail, with the resume and a one-page cover letter as PDFs. If the posting has no email address, the PDFs are ready for you to apply by hand.
- **Lets you add a job yourself:** paste a post or drop a screenshot, and it goes through the same steps.
- **Watches for replies.** It drafts an answer in Gmail Drafts (never sends it), adds a calendar reminder, and shows a notification.
- **Prepares you for interviews** with answers you can say out loud, and writes emails, cover letters and answers to application-form questions.
- **Keeps a record:** an Excel tracker and a searchable library of every job it has seen.

## What you need

- Windows 10 or 11
- [Node.js](https://nodejs.org) 24 or newer
- [n8n](https://n8n.io): `npm install -g n8n`
- [Claude Code](https://claude.com/claude-code), signed in with a Claude subscription: `npm install -g @anthropic-ai/claude-code`
- Microsoft Edge or Google Chrome (used to make the PDFs)
- An [Apify](https://apify.com) account for the job searches
- A Gmail account and a free Google Cloud OAuth client (steps in [SETUP.md](SETUP.md))
- Optional: the Claude in Chrome extension, for the LinkedIn feed check

## Quick start

1. Download this repository (Code, then Download ZIP) and unzip it, or clone it.
2. In the folder, run:
   ```
   powershell -ExecutionPolicy Bypass -File setup.ps1
   ```
   This installs the packages, creates your `config.json` and `resume\master-resume.md` from the examples, installs the Claude skills, and builds the n8n workflow files.
3. Put your name, email, phone and job titles in `config.json`, and replace `resume\master-resume.md` with your own resume.
4. Follow **One-time setup** in [SETUP.md](SETUP.md): the n8n account, the three credentials, and importing the workflows.
5. Double-click **`Auto Job.cmd`**. The dashboard opens at http://localhost:5680.

**Just want to look?** Run `node dashboard/seed-demo.js`, then `node dashboard/demo.js`, and open http://localhost:5681. It shows sample data and sends nothing.

## Make it yours

The example settings are for an HR job search in Lahore, Pakistan, with pay in PKR. Change these in `config.json` (most are also in the dashboard's Settings tab):

- `search.keywords`: the job titles to search for.
- `filters.allowedCities`, `filters.allowRemote`: where you can work.
- `filters.minMonthlyPkr`, `filters.targetMonthlyPkr`, `filters.usdToPkr`: your pay limits.
- `matching.minScore`, `matching.sendAsIsAt`: how good a match must be to apply, and to send your resume unchanged.
- `candidate.degreeNote`: one honest line about your degree, used when a posting asks for a degree (for example "in the final year of an MBA, expected 2027").
- `linkedin.checkFeed`: set to `false` to turn the LinkedIn feed check off.

The time zone is `Asia/Karachi` in `start-n8n.ps1` and `scripts/build-workflows.js`.

## Things to know before you run it

- **It sends real emails from your Gmail.** Set "Applications a day" to 1 in Settings for your first runs and read what goes out.
- **It never invents facts.** Resumes, emails and cover letters are built only from your master resume. A thin master resume gives thin applications.
- **LinkedIn does not allow automated activity.** The feed check only reads your home feed in your own Chrome, once per run. It never likes, comments or messages; it drafts a comment for you to post yourself. Use it at your own risk, or turn it off.
- **Costs.** The job searches are capped at 3 USD a month by default (`limits.apifyMonthlyBudgetUsd`). Each tailored application uses about 9 Claude requests from your plan.
- **Google sign-in expires weekly** while your Google Cloud OAuth app is in Testing mode. Reconnect the Gmail credential in n8n when sending fails.

## Tests

```
npm test
```

Runs the offline tests. They scrape nothing and send nothing.

## Credits

- The `hiring-panel` skill is by Alex Chen ([@nocodealex](https://chen.media)), MIT license.
- The `humanizer` skill is by Siqi Chen ([blader/humanizer](https://github.com/blader/humanizer)), MIT license.

## License

[MIT](LICENSE)
