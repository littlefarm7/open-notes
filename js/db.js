/* Open Notes — IndexedDB storage */
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('open-notes', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      const req = fn(os);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return {
    all: store => run(store, 'readonly', os => os.getAll()),
    get: (store, key) => run(store, 'readonly', os => os.get(key)),
    put: (store, value, key) => run(store, 'readwrite', os => key === undefined ? os.put(value) : os.put(value, key)),
    del: (store, key) => run(store, 'readwrite', os => os.delete(key)),
    clear: store => run(store, 'readwrite', os => os.clear())
  };
})();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
