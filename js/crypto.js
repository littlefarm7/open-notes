/* Open Notes — locked notes are encrypted with AES-GCM, key derived from the PIN (PBKDF2) */
const Crypt = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  function available() {
    return !!(window.crypto && crypto.subtle);
  }
  function newSalt() {
    return b64(crypto.getRandomValues(new Uint8Array(16)));
  }
  async function deriveKey(pin, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: unb64(salt), iterations: 200000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { iv: b64(iv), data: b64(data) };
  }
  async function decrypt(key, payload) {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.data));
    return JSON.parse(dec.decode(data));
  }
  return { available, newSalt, deriveKey, encrypt, decrypt };
})();
