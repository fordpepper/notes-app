// Text-area editing helpers: formatting commands and smart Enter/Tab.
// All edits go through execCommand('insertText') so the browser's undo stack keeps working.
import * as U from './util.js';

export function insertText(ed, t) {
  ed.focus();
  if (!document.execCommand('insertText', false, t)) { ed.setRangeText(t, ed.selectionStart, ed.selectionEnd, 'end'); ed.dispatchEvent(new Event('input', { bubbles: true })); }
}
export function wrap(ed, l, r = l, placeholder = '') {
  const s = ed.selectionStart, e = ed.selectionEnd, sel = ed.value.slice(s, e);
  if (sel && ed.value.slice(s - l.length, s) === l && ed.value.slice(e, e + r.length) === r) {      // already wrapped: unwrap
    ed.setSelectionRange(s - l.length, e + r.length); insertText(ed, sel); ed.setSelectionRange(s - l.length, s - l.length + sel.length); return;
  }
  const body = sel || placeholder;
  insertText(ed, l + body + r);
  ed.setSelectionRange(s + l.length, s + l.length + body.length);
}
const lineRange = ed => {
  const v = ed.value, a = v.lastIndexOf('\n', ed.selectionStart - 1) + 1; let b = v.indexOf('\n', ed.selectionEnd);
  return [a, b < 0 ? v.length : b];
};
function replaceLines(ed, fn) {
  const [a, b] = lineRange(ed), out = fn(ed.value.slice(a, b).split('\n')).join('\n');
  ed.setSelectionRange(a, b); insertText(ed, out); ed.setSelectionRange(a, a + out.length);
}
export const linePrefix = (ed, pre) => replaceLines(ed, lines => { const all = lines.every(l => l.startsWith(pre)); return lines.map(l => all ? l.slice(pre.length) : pre + l); });
export function cycleHeading(ed) {
  replaceLines(ed, ([line, ...rest]) => { const m = line.match(/^(#{1,5}) /); return [m ? (m[1].length >= 3 ? line.slice(m[0].length) : '#' + line) : '# ' + line, ...rest]; });
}
export function codeSnippet(ed) {
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  if (sel.includes('\n')) insertText(ed, '```\n' + sel + '\n```'); else wrap(ed, '`', '`', 'code');
}
export function linkSnippet(ed) {
  const s = ed.selectionStart, sel = ed.value.slice(s, ed.selectionEnd) || 'text';
  insertText(ed, `[${sel}](url)`);
  ed.setSelectionRange(s + sel.length + 3, s + sel.length + 6);
}

/** Install smart keys. `getPath()` returns the open file's path. */
export function bindKeys(ed, getPath) {
  ed.addEventListener('keydown', e => {
    const p = getPath(), mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && U.isMarkdown(p)) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); return wrap(ed, '**', '**', 'bold'); }
      if (k === 'i') { e.preventDefault(); return wrap(ed, '*', '*', 'italic'); }
      if (k === 'k') { e.preventDefault(); return linkSnippet(ed); }
    }
    if (e.isComposing) return;
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (ed.selectionStart !== ed.selectionEnd || e.shiftKey) replaceLines(ed, lines => lines.map(l => e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l));
      else insertText(ed, '  ');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && U.isNote(p) && ed.selectionStart === ed.selectionEnd) {
      const v = ed.value, s = ed.selectionStart, start = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(start, s);
      let m = line.match(/^(\s*)(?:([-*+•])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?(.*)$/);
      if (m) {
        e.preventDefault();
        if (!m[6]) { ed.setSelectionRange(start, s); insertText(ed, ''); return; }                  // empty item: leave the list
        insertText(ed, `\n${m[1]}${m[2] || `${+m[3] + 1}${m[4]}`} ${m[5] ? '[ ] ' : ''}`);
        return;
      }
      m = line.match(/^(\s*>+)\s?(.*)$/);
      if (m) { e.preventDefault(); if (!m[2]) { ed.setSelectionRange(start, s); insertText(ed, ''); } else insertText(ed, `\n${m[1]} `); }
    }
  });
}
