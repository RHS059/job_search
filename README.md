# Nightshift — remote design job radar

A Dracula-themed, responsive tracker with filters, direct posting links, status history, JSON export, and scheduled discovery across all nine requested platforms.

## Run

Requires Node.js 22+. Run `npm ci` and `npx playwright install chromium`, then `npm test` and `npm start`, and open http://127.0.0.1:3000. Click **Find more jobs**, or run `npm run collect`. Back up `data/jobs.json`. Do not run the CLI collector and server against the same local file simultaneously; use the app's search button or GitHub storage for concurrency.

## Shared storage and scheduling

The **Discover fresh design jobs** GitHub Action runs at minute 17 every three hours, with a manual Actions trigger. Schedules are best effort and may be delayed or disabled by GitHub after prolonged repository inactivity. The workflow must be on the default branch with Actions enabled. It uses the built-in `GITHUB_TOKEN`; no personal token is needed for Actions.

To connect the app to the same JSON as the Action, set `JOBS_REPOSITORY=RHS059/job_search` and a server-side `GITHUB_TOKEN` with Contents read/write permission before starting. Writes retry SHA conflicts against the latest data, preserving concurrent changes. Without these variables, the app uses local JSON independently of the Action. Never put a GitHub token into the frontend.

For hosting, set `HOST=0.0.0.0`, `APP_TOKEN` to a long random access key, and optionally `PORT`. Put the app behind HTTPS. The browser asks for the app key and keeps it in session storage. Never use a GitHub token as the app key. Network binding requires `APP_TOKEN`. This is a single-user tracker. Static hosting alone cannot persist status changes.

Alternatively set `ENABLE_SCHEDULER=true` for local collection at startup and every three hours while the app is running. Avoid enabling both schedulers unnecessarily.

## Lifecycle

- Posting age is advisory: older jobs and jobs without a verified posting date can enter the store. Missing, invalid, and future dates are saved as null and shown as Not provided. Explicitly expired posts are still excluded. Date-only values use midnight UTC.
- Discovered/in-progress jobs become inactive 72 hours after storage if never applied.
- Applied/interviewed jobs become ghosted after 14 days without updates. Configure `ghostAfterDays` in `config.json`. Rejected and offer-extended jobs never automatically ghost.
- All eight statuses can be selected; inactive/ghosted jobs can be reactivated. Check-in resets the update clock. History records manual and automatic changes.
- Canonical URLs remove tracking parameters and normalize Greenhouse aliases. Company/platform/requisition IDs provide additional deduplication. Distinct cross-platform posts without shared IDs cannot reliably be recognized as the same vacancy.
- Aging runs on collection and app reads, catching up after downtime.

## Source coverage

Yandex Search discovers links across all nine platforms. JavaScript-only search responses are rendered with Chromium through Playwright. Original posting pages supply `JobPosting` JSON-LD; search snippets never establish freshness. Add known posting URLs to `seedUrls` in `config.json` to bypass indexing. Metadata contract: https://developers.yandex.com/search/docs/appearance/structured-data/job-posting

All nine platforms support Yandex discovery and structured-data verification. Greenhouse and Lever additionally have direct public API discovery. JavaScript-only pages (often Workday), bot-blocked pages, missing dates, and unindexed jobs may be skipped. Search availability affects discovery. Diagnostics stay in background logs and the stored collection report. Empty results mean no verified matches were stored, not that no jobs exist. Remote roles may have regional restrictions; check original postings.

## Validation and operations

`npm test` runs domain boundary tests, source/failure contract tests, and a real HTTP/file integration journey. CI runs these on pushes and PRs. Coverage includes date boundaries, deduplication, lifecycle transitions, redirects, authentication, origin validation, concurrent writes, and conflicts. Fixtures never seed real job data.

Standard-library Node, JSON, and plain HTML/CSS/JS keep the personal app easy to run and audit. Modules separate lifecycle rules, storage, external sources, collection, and presentation. Atomic local file replacement and GitHub SHA checks protect writes. A database/queue would be appropriate for multi-user scale. No cross-browser or high-scale certification is claimed.

Rollback by reverting application changes while retaining job data. Back up JSON before schema changes. Inspect Actions and the persisted search report when collection fails. No credentials are committed.

## Yandex URL discovery

Each run saves deduplicated URLs in `data/jobs.json` under `discoveredUrls`, with source, platform, first-seen and last-seen timestamps. This is an unverified URL ledger, not the jobs table. Original postings and public board APIs establish role and remote eligibility; posting age no longer blocks admission. URLs persist even when the posting cannot be read or its date is absent. Yandex may require interactive verification on automated runners; the collector does not bypass it. If any platform search fails or is skipped, the action fails after saving any results and sets searchComplete to false; supplemental API results do not make a blocked search successful. The UI does not display these diagnostics.

## Pacing and independent fallback

Yandex requests (including a rendered retry) are separated by 10 seconds. An HTTP 403/429 or verification challenge stops Yandex for the rest of the run. Its cooldown is saved in JSON for subsequent runs: three hours minimum, or a longer Retry-After header. No challenge bypass or automatic rapid retries.

Public Greenhouse and Lever APIs run independently on every collection. There is no configured company shortlist. API lookups follow company boards learned from actual search results only. They supplement search and cannot replace platform-wide discovery. API requests are paced one second apart per provider; a block stops that provider for the run. Posting-page fetches are sequential and paced too.

Greenhouse `first_published` supplies the publication date; `updated_at` never qualifies an old job as new. API URLs are retained even if no recent job qualifies. Lever dates still require posting-page verification. Public APIs may still rate-limit; the fallback avoids dependence on search-engine scraping, not all possible outages.

API contracts: https://docs.greenhouse.io/job-board.html and https://github.com/lever/postings-api

Remote detection reads job descriptions as well as titles, locations and explicit remote metadata. The three-day inactivity clock still starts at storage time; this is independent of posting age.

The nine `searchDomains` are exactly the requested platform domains. Each is queried with all seven requested role phrases AND remote, without employer restrictions. `platforms` also accepts platform host aliases when processing posting links. Previously saved jobs are retained.
