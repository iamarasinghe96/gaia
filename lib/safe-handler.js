// Wraps a serverless handler so every failure, including one while loading modules,
// is answered as JSON { ok: false, error: 'server', detail } and written to the log.
// The detail is the error type and message only, with anything that looks like a key removed.
const clean = err => `${(err && err.name) || 'Error'}: ${String((err && err.message) || err)}`
  .replace(/(app_key|app_id|key|token|secret)=[^&\s]+/gi, '$1=…').replace(/\s+/g, ' ').slice(0, 180);

export function safeHandler(load) {
  let ready = null;
  return async function handler(req, res) {
    try {
      ready = ready || load();
      const inner = await ready;
      return await inner(req, res);
    } catch (err) {
      ready = null;
      console.error('handler failed', err);
      if (res.headersSent) return;
      res.setHeader('Cache-Control', 'no-store');
      res.status(500).json({ ok: false, error: 'server', detail: clean(err) });
    }
  };
}
