# Nightshift — remote design job radar

A Dracula-themed, responsive tracker with filters, direct posting links, status history, JSON export, and scheduled discovery across all nine requested platforms.

## Run

Requires Node.js 22+. No dependencies to install. Run `npm test`, then `npm start`, and open http://127.0.0.1:3000. Click **Find more jobs**, or run `npm run collect`. Back up `data/jobs.json`. Do not run the CLI collector and server against the same local file simultaneously; use the app's search button or GitHub storage for concurrency.

## Shared storage and scheduling

The **Discover fresh design jobs** GitHub Action runs at minute 17 every three hours, with a manual Actions trigger. Schedules are best effort and may be delayed or disabled by GitHub after prolonged repository inactivity. The workflow must be on the default branch with Actions enabled. It uses the built-in `GITHUB_TOKEN`; no personal token is needed for Actions.

To connect the app to the same JSON as the Action, set `JOBS_REPOSITORY=RHS059/job_search` and a server-side `GITHUB_TOKEN` with Contents read/write permission before starting. Writes retry SHA conflicts against the latest data, preserving concurrent changes. Without these variables, the app uses local JSON independently of the Action. Never put a GitHub token into the frontend.

For hosting, set `HOST=0.0.0.0`, `APP_TOKEN` to a long random access key, and optionally `PORT`. Put the app behind HTTPS. The browser asks for the app key and keeps it in session storage. Never use a GitHub token as the app key. Network binding requires `APP_TOKEN`. This is a single-user tracker. Static hosting alone cannot persist status changes.

Alternatively set `ENABLE_SCHEDULER=true` for local collection at startup and every three hours while the app is running. Avoid enabling both schedulers unnecessarily.

## Lifecycle

- Only verified posts strictly younger than 72 hours enter the store. Exactly 72 hours, invalid/missing/future dates, and expired posts are excluded. Date-only values use midnight UTC.
- Discovered/in-progress jobs become inactive 72 hours after storage if never applied.
- Applied/interviewed jobs become ghosted after 14 days without updates. Configure `ghostAfterDays` in `config.json`. Rejected and offer-extended jobs never automatically ghost.
- All eight statuses can be selected; inactive/ghosted jobs can be reactivated. Check-in resets the update clock. History records manual and automatic changes.
- Canonical URLs remove tracking parameters and normalize Greenhouse aliases. Company/platform/requisition IDs provide additional deduplication. Distinct cross-platform posts without shared IDs cannot reliably be recognized as the same vacancy.
- Aging runs on collection and app reads, catching up after downtime.

## Source coverage

Bing RSS discovers links across all nine platforms. Original posting pages supply `JobPosting` JSON-LD; search snippets never establish freshness. Add known posting URLs to `seedUrls` in `config.json` to bypass indexing. Metadata contract: https://developers.google.com/search/docs/appearance/structured-data/job-posting

All platforms use a shared structured-data adapter, not bespoke ATS API integrations. JavaScript-only pages (often Workday), bot-blocked pages, missing dates, and unindexed jobs may be skipped. Search availability affects discovery. Diagnostics stay in background logs and the stored collection report. Empty results mean no verified matches were stored, not that no jobs exist. Remote roles may have regional restrictions; check original postings.

## Validation and operations

`npm test` runs domain boundary tests, source/failure contract tests, and a real HTTP/file integration journey. CI runs these on pushes and PRs. Coverage includes date boundaries, deduplication, lifecycle transitions, redirects, authentication, origin validation, concurrent writes, and conflicts. Fixtures never seed real job data.

Standard-library Node, JSON, and plain HTML/CSS/JS keep the personal app easy to run and audit. Modules separate lifecycle rules, storage, external sources, collection, and presentation. Atomic local file replacement and GitHub SHA checks protect writes. A database/queue would be appropriate for multi-user scale. No cross-browser or high-scale certification is claimed.

Rollback by reverting application changes while retaining job data. Back up JSON before schema changes. Inspect Actions and the persisted search report when collection fails. No credentials are committed.
