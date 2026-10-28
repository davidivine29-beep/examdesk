// Storage adapter for Cloudflare D1 (SQLite). Creates its one table on first use.
export function d1Store(db) {
  let ready;
  const init = () => (ready ||= db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)').run());
  return {
    async get(k) {
      await init();
      const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
      return r ? r.v : null;
    },
    async set(k, v) {
      await init();
      await db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v).run();
    },
    async delete(k) {
      await init();
      await db.prepare('DELETE FROM kv WHERE k = ?').bind(k).run();
    },
    async list(prefix) {
      await init();
      const r = await db.prepare('SELECT k FROM kv WHERE substr(k, 1, ?) = ? ORDER BY k').bind(prefix.length, prefix).all();
      return (r.results || []).map((x) => x.k);
    },
  };
}
