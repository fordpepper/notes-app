// Read-only calendars from "secret address" links (Google Calendar, iCloud public calendars, Outlook, ...). No sign-in needed:
// the links live in .google/links.txt in the notes repo, a small GitHub Actions workflow downloads each one into
// .google/<n>.ics every ~15 minutes, and the calendar reads those files like any other.
import * as M from './model.js';
import * as I from './ics.js';

export const DIR = '.google/', LINKS = DIR + 'links.txt', WF = '.github/workflows/calendar-links.yml';
const COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#12a594'];

export const WORKFLOW = `name: Fetch calendar links
on:
  schedule: [{ cron: '*/15 * * * *' }]
  workflow_dispatch:
  push:
    paths: ['${LINKS}']
permissions:
  contents: write
concurrency: calendar-links
jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Download calendars
        run: |
          [ -f ${LINKS} ] || exit 0
          n=0
          while IFS= read -r line || [ -n "$line" ]; do
            url="$(printf '%s' "\${line##*|}" | tr -d '\\r' | xargs)"
            url="\${url/#webcal:\\/\\//https://}"
            case "$url" in https://*) ;; *) continue;; esac
            n=$((n+1))
            if curl -fsSL --max-time 60 "$url" | sed '/^DTSTAMP/d' > ".google/$n.tmp" && grep -q BEGIN:VCALENDAR ".google/$n.tmp"; then
              mv ".google/$n.tmp" ".google/$n.ics"
            else
              echo "Could not read calendar $n"; rm -f ".google/$n.tmp"
            fi
          done < ${LINKS}
          for f in .google/*.ics; do [ -e "$f" ] || continue; i="$(basename "$f" .ics)"; [ "$i" -le "$n" ] 2>/dev/null || rm -f "$f"; done
      - name: Save changes
        run: |
          git config user.name "calendar-links"
          git config user.email "calendar-links@users.noreply.github.com"
          git add -A ${DIR}
          git diff --cached --quiet || { git commit -m "Update calendars" && git push; }
`;

/** [{n, name, url}] from the links file: one per line, "Name | link" or just the link. */
export function parseLinks(text) {
  const out = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const i = line.lastIndexOf('|'), url = (i < 0 ? line : line.slice(i + 1)).trim().replace(/^webcal:\/\//i, 'https://');
    if (!/^https:\/\//i.test(url)) continue;
    const n = out.length + 1;
    out.push({ n, name: (i < 0 ? '' : line.slice(0, i).trim()) || `Calendar ${n}`, url, color: COLORS[(n - 1) % COLORS.length] });
  }
  return out;
}
export const linksText = () => { const r = M.files.get(LINKS); return r && !r.deleted && typeof r.content === 'string' ? r.content : ''; };
export const feeds = () => parseLinks(linksText());
export const hasWorkflow = () => M.exists(WF);
export async function saveLinks(text) {
  text = text.trim() ? text.trim() + '\n' : '';
  if (M.exists(LINKS)) await M.saveText(LINKS, text); else if (text) await M.create(LINKS, text);
}
/** Prefilled "new file" page on GitHub, so adding the workflow is one click on Commit. */
export const workflowUrl = c => `https://github.com/${c.owner}/${c.repo}/new/${encodeURIComponent(c.branch || 'main')}?filename=${encodeURIComponent(WF)}&value=${encodeURIComponent(WORKFLOW)}`;

const rid = e => { const x = (e.extra || []).find(l => /^RECURRENCE-ID/i.test(l)); if (!x) return ''; const i = x.indexOf(':'); return I.icsDate(x.slice(i + 1), x.slice(0, i))?.key.slice(0, 10) || ''; };

/** Read-only events of every linked calendar that touch [from, to). */
export function events(from, to) {
  const out = [];
  for (const f of feeds()) {
    const r = M.files.get(`${DIR}${f.n}.ics`);
    if (!r || r.deleted || typeof r.content !== 'string') continue;
    const all = I.parseICS(r.content).filter(e => !(e.extra || []).some(l => /^STATUS:CANCELLED/i.test(l)));
    const moved = new Set(all.filter(e => rid(e)).map(e => `${e.id}|${rid(e)}`));
    for (const e of all) for (const o of I.occurrences(e, from, to)) {
      if (e.rrule && moved.has(`${e.id}|${o.start.slice(0, 10)}`)) continue;
      out.push({ ...o, source: 'feed', writable: false, color: f.color, acct: f.name, id: `${f.n}:${e.id}` });
    }
  }
  return out;
}
