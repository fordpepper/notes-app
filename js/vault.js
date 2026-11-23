// One encrypted file with everything needed to set up another device: the GitHub repo + token, Google client ID
// and accounts, colours and other preferences. AES-256-GCM, key derived from a passphrase with PBKDF2 (600 000 rounds).
// The file is useless without the passphrase, and the passphrase is never stored.
const enc = new TextEncoder(), dec = new TextDecoder(), ROUNDS = 600000;
const b64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const key = async (pass, salt, rounds) => crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export async function seal(data, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt, ROUNDS), enc.encode(JSON.stringify(data)));
  return JSON.stringify({ app: 'notes-app', v: 1, kdf: 'PBKDF2-SHA256', rounds: ROUNDS, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) });
}
export async function open(text, pass) {
  let f; try { f = JSON.parse(text); } catch { f = null; }
  if (f?.app !== 'notes-app' || !f.data) throw new Error('This is not a settings file from this app.');
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, await key(pass, unb64(f.salt), f.rounds || ROUNDS), unb64(f.data)))); }
  catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
}
