// Minimal in-memory GitHub Git Data API (refs, commits, trees, blobs) for tests.
import crypto from 'node:crypto';

export function createMock({ owner = 'me', repo = 'notes' } = {}) {
  const blobs = new Map(), commits = new Map(), trees = new Map();      // trees: tree sha -> Map(path -> blob sha)
  let head = null, n = 0;
  const log = [];                                           // every request: "GET /git/ref/heads/main -> 200"
  const sha1 = b => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
  const addBlob = b => { const s = sha1(b); blobs.set(s, b); return s; };
  const mkCommit = (tree, parent) => { const id = 'c' + (++n).toString(16).padStart(39, '0'), ts = 'T' + id; trees.set(ts, new Map(tree)); commits.set(id, { tree: trees.get(ts), treeSha: ts, parent }); head = id; return id; };

  const api = {
    log, blobs, commits,
    get head() { return head; },
    tree: () => commits.get(head).tree,
    text: p => blobs.get(commits.get(head).tree.get(p))?.toString(),
    message: () => commits.get(head).message,
    has: p => commits.get(head).tree.has(p),
    seed(files) { mkCommit(new Map(Object.entries(files).map(([p, c]) => [p, addBlob(Buffer.isBuffer(c) ? c : Buffer.from(c))])), null); },
    set(p, text) { const t = new Map(commits.get(head).tree); t.set(p, addBlob(Buffer.from(text))); mkCommit(t, head); },
    del(p) { const t = new Map(commits.get(head).tree); t.delete(p); mkCommit(t, head); },
    count: re => log.filter(l => re.test(l)).length,
    resetLog: () => { log.length = 0; },
    failNext: null,                                          // e.g. { status: 401, message: 'Bad credentials' }
    // Returns {status, json?, raw?, headers?} for a request.
    handle(method, pathname, headers, body) {
      const p = pathname.replace(`/repos/${owner}/${repo}`, '');
      const json = (o, status = 200, h = {}) => ({ status, json: o, headers: h });
      if (api.failNext) { const f = api.failNext; api.failNext = null; return json({ message: f.message }, f.status); }
      let r;
      if (p === '') return json({ default_branch: 'main', private: true, permissions: { push: true } });
      if (p === '/git/ref/heads/main' && method === 'GET') {
        const etag = `"ref-${head}"`;
        if (headers['if-none-match'] === etag) return { status: 304, headers: { etag } };
        return json({ object: { sha: head } }, 200, { etag });
      }
      if ((r = p.match(/^\/git\/commits\/(\w+)$/)) && method === 'GET') return json({ tree: { sha: commits.get(r[1]).treeSha } });
      if ((r = p.match(/^\/git\/trees\/(\w+)$/)) && method === 'GET') return json({ truncated: false, tree: [...trees.get(r[1])].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644', size: blobs.get(sha)?.length })) });
      if (p === '/git/blobs' && method === 'POST') return json({ sha: addBlob(Buffer.from(body.content, 'base64')) });
      if ((r = p.match(/^\/git\/blobs\/(\w+)$/))) { const b = blobs.get(r[1]); return b ? { status: 200, raw: b, headers: {} } : json({ message: 'Not Found' }, 404); }
      if (p === '/git/trees' && method === 'POST') {
        if (!trees.has(body.base_tree)) return json({ message: 'base_tree is not a tree' }, 422);
        const t = new Map(trees.get(body.base_tree));
        for (const e of body.tree) { if (e.sha === null) { if (!t.has(e.path)) return json({ message: 'bad delete ' + e.path }, 422); t.delete(e.path); } else t.set(e.path, e.sha); }
        const id = 'x' + (++n); trees.set(id, t); return json({ sha: id });
      }
      if (p === '/git/commits' && method === 'POST') {
        if (body.parents[0] !== head) return json({ message: 'stale parent' }, 422);
        const id = 'c' + (++n).toString(16).padStart(39, '0'); commits.set(id, { tree: trees.get(body.tree), treeSha: body.tree, parent: body.parents[0], message: body.message });
        return json({ sha: id });
      }
      if (p === '/git/refs/heads/main' && method === 'PATCH') { if (commits.get(body.sha).parent !== head) return json({ message: 'not ff' }, 422); head = body.sha; return json({}); }
      return json({ message: 'Not Found ' + p }, 404);
    },
  };
  return api;
}
