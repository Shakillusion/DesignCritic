# Deploying DesignCritic AI on Vercel (free, no card)

This puts the app online around the clock without a credit card. Every service below has a free plan you sign up for with your GitHub account.

| Piece | Service | Used for |
|---|---|---|
| App + API | **Vercel Hobby** | Runs the site; redeploys automatically on every push to GitHub |
| Database | **Turso** (hosted SQLite) | Projects, designs, critiques, settings |
| Files | **Vercel Blob** (private store) | Uploads, renders, exports, assets |
| Rendering | Serverless Chromium (bundled) | Rendering, PDF/PNG export and QA checks |

Your computer stays exactly as it is: without these settings the app keeps using the local SQLite file, local storage folder and Edge.

The whole setup takes about 15 minutes, all in the browser.

## 1. Create the database (Turso)

1. Go to <https://turso.tech> and choose **Sign up** → **Continue with GitHub**.
2. Create a database: **Databases → Create database**. Name it `designcritic` and pick the region closest to you; remember it for step 3.
3. Open the database and copy its **URL**, which looks like `libsql://designcritic-<you>.turso.io`.
4. Click **Create token** (or **Generate token**), with read & write access and no expiry. Copy the token.

The app creates all its tables on first start, so there's nothing to run.

## 2. Import the repo into Vercel

1. Go to <https://vercel.com/signup> → **Continue with GitHub**. Choose the free **Hobby** plan.
2. **Add New… → Project** → import **Shakillusion/DesignCritic**. Vercel detects Next.js automatically.
3. Before clicking **Deploy**, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DESIGNCRITIC_PASSWORD` | A password for signing in to your app (**required**: the site is public) |
| `TURSO_DATABASE_URL` | The `libsql://…` URL from step 1 |
| `TURSO_AUTH_TOKEN` | The token from step 1 |
| `GEMINI_API_KEY` | Your free Gemini key (and/or the two below) |
| `GROQ_API_KEY` | Optional, free |
| `OPENROUTER_API_KEY` | Optional, free |
| `TAVILY_API_KEY`, `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY` | Optional, free |
| `DESIGNCRITIC_CONTACT` | Your site address or email (public image APIs ask for one) |

4. Click **Deploy**. The first build takes a few minutes.

## 3. Add file storage (Vercel Blob)

1. In your Vercel project: **Storage → Create → Blob**. Name it `designcritic-files`, choose **Private** access if asked, and pick the same region as the database.
2. Connect it to the project for all environments. Vercel adds `BLOB_READ_WRITE_TOKEN` for you.
3. Redeploy so the app sees it: **Deployments → … on the latest → Redeploy**.

Optional but recommended: **Settings → Functions → Function Region** set to the same region as Turso. Every database query crosses that distance, so the closer the better.

## 4. Open your app

Visit the `https://<project>.vercel.app` address Vercel shows, sign in with your password, and check **Settings → Integrations**: the AI engine and "Serverless Chromium" should both show as ready.

From now on, every `git push` to `main` redeploys automatically.

## Limits on the free plans

- **Non-commercial use only** on Vercel Hobby.
- **5-minute limit per job.** Each background job must finish within Vercel's 300-second function limit, so on Vercel:
  - generation does **one** QA correction round
  - extra variations, a correction round or the final critique are **skipped, with a note**, if time runs short. Run them again from the studio or the assistant.
  - A job cut off anyway is marked failed within a few minutes, so it never spins forever.
- **4 MB uploads.** Vercel limits request bodies to about 4.5 MB. Larger photos are automatically re-encoded in the browser to fit; PDFs over 4 MB must be compressed first.
- **First render after idle** can take several extra seconds while Chromium unpacks.
- If you exceed a free allowance, the service pauses or throttles until the month resets. It never bills you.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No database configured" | `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` missing; add them and redeploy |
| "No file storage configured" | Connect the Blob store (step 3) and redeploy |
| Sign-in page doesn't appear | `DESIGNCRITIC_PASSWORD` isn't set, so the app is open to everyone. Set it and redeploy. |
| A job says "ran past the server time limit" | Use fewer variations or QA rounds (Settings), then try again |

Logs: Vercel project → **Logs**.
