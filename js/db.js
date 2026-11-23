// Tiny IndexedDB wrapper: one object store holding every file record.
let dbp;
const open = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open('notes-app', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'path' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
  const t = db.transaction('files', mode);
  let out; const rq = fn(t.objectStore('files'));
  if (rq) rq.onsuccess = () => out = rq.result;
  t.oncomplete = () => res(out);
  t.onerror = t.onabort = () => rej(t.error);
}));
export const db = {
  all: () => tx('readonly', s => s.getAll()),
  put: r => tx('readwrite', s => s.put(r)),
  /** Many records in one transaction: far cheaper than one transaction each (esp. in Firefox). */
  putMany: rs => rs.length ? tx('readwrite', s => { for (const r of rs) s.put(r); }) : Promise.resolve(),
  del: p => tx('readwrite', s => s.delete(p)),
  clear: () => tx('readwrite', s => s.clear()),
};
