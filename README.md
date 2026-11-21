# Notes

Plain-text (`.txt`) notes that live in a GitHub repo. One codebase: runs in any browser and installs as an app on
Android, Windows, Linux and ChromeOS. Offline-first, no backend.

- **Sync** with a private GitHub repo (pull + one commit per push, conflict-safe).
- **Folders**: create, rename, move (drag & drop, or "Move to…" on touch), delete. Your existing repo layout is shown as-is.
- **Files**: upload anything, attach files into a note (paste or drag them in; the relative path is inserted); images/PDF/audio/video open in-app.
- **Editor**: plain text with list continuation, pins and search. (`.md` files in the repo still open with a formatting toolbar and live preview.)
- Light/dark theme + accent colour. Works offline; syncs when it can.

## Hosting

Deployed by GitHub Actions to GitHub Pages on every push to `main`; nothing runs on a personal machine.
No build step (marked + DOMPurify are vendored in `vendor/`).

## Put it online (so your phone can use it)

The app contains no secrets, so host it anywhere static. Easiest: push this folder to a **public** GitHub repo
(separate from your notes repo), then Settings → Pages → Source: *GitHub Actions*; `.github/workflows/pages.yml` deploys it.
(Pages from a *private* repo needs a paid plan; Cloudflare Pages / Netlify / any web server work too.)

Your notes stay in your private repo; the app only talks to `api.github.com` from your device.

## Install as an app

- **Android (Chrome/Edge/Firefox/Samsung)**: open the site → menu → *Install app* / *Add to Home screen*. Own icon, own window, offline.
- **Desktop (Chrome/Edge/Brave)**: install icon in the address bar.

## Connect GitHub

1. Create a **fine-grained token**: <https://github.com/settings/personal-access-tokens/new> → *Only select repositories* → your notes repo →
   Permissions → **Contents: Read and write**.
2. In the app: Settings → repo `owner/name`, paste the token. Optional: branch, and a subfolder of the repo to use as the notes root.

The token is stored only in this browser's local storage. The repo needs at least one commit (e.g. a README).

## How sync works

Each file remembers the git blob SHA it had at the last sync. On sync the app compares the branch tree with local files:
remote-only changes are downloaded, local-only changes are pushed together as **one commit**. If both sides changed the same
file, the remote version wins and yours is kept next to it as `name (conflict YYYY-MM-DD).md`; nothing is overwritten.
It syncs a few seconds after you stop typing, every minute while open, on focus, and on Ctrl+S.

Behaviour notes: empty folders are stored as a `.gitkeep`; pins are stored in `.notes-app.json` (so they sync);
dot-files are hidden in the sidebar but still synced; non-text files are downloaded on first open; attachments live in an
`attachments/` folder beside the note and are linked relatively (if you move a note, move its attachments too).
GitHub's API limits single files to 100 MB.

## Want a store-style native app?

It's plain web code, so it wraps directly with [Capacitor](https://capacitorjs.com) (Android APK) or
[Tauri](https://tauri.app) (Linux/Windows desktop) if you ever want one. The PWA install is usually enough.
