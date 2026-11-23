# Notes

Plain-text (`.txt`) notes that live in a private GitHub repo. One codebase: runs in any browser and installs as an
app on Android, Windows, Linux and ChromeOS. Offline-first, no backend: the app talks straight to the GitHub API.

**Features**
- **Sync** with a private repo: pull + one commit per push, conflict-safe, works offline and catches up later.
- **Folders**: create, rename, move (drag & drop, or *Move to…* on touch), delete with **Undo**. Your repo layout is shown as-is.
- **Minimal UI**: just the note list and the text. One button flips between editing and preview, the formatting bar only appears while you write, the list can be collapsed and there is a focus mode. Settings are limited to theme, accent colour, text size, font and sync interval.
- **Previews** (documents are shown as they are, not reformatted: PDFs with the real engine, Word as real pages, Excel and OpenOffice sheets with their colours/merges/number formats, PowerPoint and OpenDocument presentations as slides (own renderer: themes, layouts, cropped pictures, shapes, tables, charts); each viewer downloads once, on first use): markdown, CSV/TSV tables, JSON trees, syntax-highlighted code, HTML (sandboxed), Word/Excel/PowerPoint/OpenDocument, zip archives, fonts, PDF, audio, video and pictures.
- **Calendar** (tab in the sidebar): one continuous, vertically scrolling run of weeks like Apple Calendar, with the chosen day's events next to it (below it on a phone). Events are kept in `calendar.ics` in your notes repo, so they sync and work offline like notes (repeats supported; alarms and other fields in the file are preserved). Accounts are only ever added in **Settings → Accounts**.
  - **Calendar links, no sign-in** (read-only): paste Google Calendar's *Secret address in iCal format* (or a public iCloud/Outlook calendar link) under Settings → Calendars. One click on *Turn on automatic updates* opens GitHub with a small workflow prefilled; press *Commit new file*. The workflow downloads every link into `.google/` of your notes repo about every 15 minutes and the calendar shows it. No Google registration or OAuth needed, but keep the notes repo private (the links give read access).
  - **Google, any number of accounts** (optional): press *Add Google account* (the app ships a client ID in `DEFAULT_CLIENT_ID` in `js/gcal.js`; forks need their own, which can also be pasted under Settings → Accounts → Repository, token and Google client ID), as often as you like as often as you like. Events from all accounts show together, and new events go to the calendar you pick. To create the client ID (once, by whoever hosts the app; it is public by design, not a secret): Google Cloud Console → enable the Google Calendar API → Credentials → OAuth client ID (*Web application*) → add this site's address as an authorised JavaScript origin. There is no server: sign-in happens in the browser, a token lasts about an hour and is renewed quietly (if Google wants you again, the calendar says so and Settings has a *Sign in* button), and refreshes use conditional requests so nothing is downloaded when nothing changed.
  - **Apple / iCloud**: Apple offers no sign-in that a web page can use for calendars (iCloud's calendar server blocks browsers, and *Sign in with Apple* has no calendar access), so there is no honest way to add an iCloud account here. Export the calendar from Apple Calendar (File → Export) or iCloud and use *Import calendar file*; it is added to `calendar.ics`.
- **Move to another device**: *Settings → Accounts → Export settings* writes one file (`.notesvault`) with the GitHub repo and token, Google client ID and accounts, colours and the other settings, encrypted with a passphrase you choose (AES-256-GCM, PBKDF2 with 600 000 rounds). On the new device choose *Import settings* on the first screen; your notes then sync from the same repo and Google accounts only need *Sign in* (access tokens are never exported).
- **All files**: the whole repo as a real tree (branch lines) with sizes, folder totals and what isn't on this device yet. Hidden files are shown by default (Settings → Hidden files).
- **Data**: files other than notes download by themselves on Wi-Fi; on mobile data (or with Data Saver) the app shows the size and waits for your OK. Settings → More → Files switches between *Smart*, *Only when opened* and *Always*.
- **Files**: upload anything, attach files to notes (paste/drag them in), images/PDF/audio/video open in-app. Pictures are recognised by their content, so they display even without a `.png`/`.jpg` ending.
- **Editor**: plain text with list continuation, pins, search. `.md` files in the repo still open with a toolbar and live preview.
- **Phone**: sync button in the top bar, pull-down-to-refresh on the list, auto-sync when you open or leave the app,
  share text from any app into Notes (installed app), "New note" home-screen shortcut.
- **Look**: light / dark / black (OLED) theme, 8 accent colours + custom picker, text size. The accent colours the whole UI,
  the logo and the browser-tab icon. (An *installed* home-screen icon is a fixed image chosen at install time.)

## Setup

The app lives in this repo and is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.
Your notes live in a separate **private** repo. The app contains no secrets (this repo can be public).

1. Create a **fine-grained token**: <https://github.com/settings/personal-access-tokens/new> → *Only select repositories* → your notes
   repo → Permissions → **Contents: Read and write**. The notes repo needs at least one commit.
2. Open the app → Settings → repo `owner/name` + token. Optional: branch, and a subfolder of the repo to use as the notes root.
3. Android: Chrome menu → *Install app*. Desktop: install icon in the address bar.

The token is stored only in that browser's local storage.

## Updates

Every deploy gets its own cache. The app checks for a new version whenever you open it or return to it, installs it in the
background and reloads once, automatically (your typing is saved first). Nothing is re-downloaded unless the code changed.

## Data usage

| Situation | Cost |
|---|---|
| Nothing changed (open app, every 2 min while open) | 1 conditional request, answered `304 Not Modified` (headers only) |
| You edited notes | blobs + tree + commit + ref update. No repo listing |
| Someone else changed the repo | ref + commit + one tree listing + **only the changed files** |
| Big pictures | decoded once into a ~1280 px WebP kept on the device; lists and previews use that, the original opens on tap |
| First sync | all notes are downloaded; images, PDFs and other files only when you open them |

The markdown libraries (~45 KB gzipped) load only when you open a `.md` file. The check interval is configurable
(Settings → Sync), and it respects the browser's *Data Saver* setting. Uploads are limited to 25 MB.

## How sync works

Each file remembers the git blob SHA it had at the last sync. Remote-only changes are downloaded, local-only changes are
pushed as **one commit**. If both sides changed the same file, the remote version wins and yours is kept next to it as
`name (conflict YYYY-MM-DD).txt`: nothing is overwritten. Edits are pushed ~3 s after you stop typing, immediately when you
leave the app, and on Ctrl+S / the sync button / pull-down. *Settings → Full resync* re-checks everything if something looks off.

Notes: empty folders are stored as a `.gitkeep`; pins live in `.notes-app.json` (so they sync); dot-files are hidden but synced;
attachments go in an `attachments/` folder beside the note (move them along if you move the note); GitHub limits files to 100 MB.

## Development

No build step: plain ES modules (`js/`), vendored `marked` + `DOMPurify` (`vendor/`, only for `.md` preview).

```sh
python3 -m http.server 8080          # run locally (http://localhost:8080)
cd tests && npm i && npm test        # sync-engine tests + headless-browser tests (Playwright)
```
`tests/mock-github.mjs` is an in-memory GitHub used by both suites. Wrapping with [Capacitor](https://capacitorjs.com) or
[Tauri](https://tauri.app) for a store build is possible but the PWA install is usually enough.
