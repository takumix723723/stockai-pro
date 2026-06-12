/**
 * クライアント側 API キャッシュ + 重複リクエスト統合 + 失敗時フォールバック
 */
(function (global) {
  const store = new Map();
  const inflight = new Map();
  const DEFAULT_TIMEOUT_MS = 25000;

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  async function fetchJson(url, options = {}) {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const init = { ...options };
    delete init.timeout;
    delete init.ttl;
    delete init.force;
    const res = await withTimeout(fetch(url, init), timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchJsonCached(url, options = {}) {
    const ttl = options.ttl ?? 30000;
    const force = !!options.force;
    const now = Date.now();
    const cached = store.get(url);

    if (!force && cached && now - cached.t < ttl) {
      return { ...cached.data, _fromClientCache: true };
    }

    if (inflight.has(url)) {
      return inflight.get(url);
    }

    const task = (async () => {
      try {
        const data = await fetchJson(url, options);
        store.set(url, { t: Date.now(), data });
        return data;
      } catch (err) {
        if (cached) {
          return { ...cached.data, _stale: true, _cacheError: String(err) };
        }
        throw err;
      } finally {
        inflight.delete(url);
      }
    })();

    inflight.set(url, task);
    return task;
  }

  async function postJsonCached(url, body, options = {}) {
    const key = url + '::' + JSON.stringify(body);
    const ttl = options.ttl ?? 15000;
    const now = Date.now();
    const cached = store.get(key);
    if (cached && now - cached.t < ttl) return cached.data;

    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      try {
        const res = await withTimeout(fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
          body: JSON.stringify(body),
        }), options.timeout ?? DEFAULT_TIMEOUT_MS);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        store.set(key, { t: Date.now(), data });
        return data;
      } catch (err) {
        if (cached) return { ...cached.data, _stale: true };
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, task);
    return task;
  }

  function invalidate(urlPrefix) {
    for (const k of store.keys()) {
      if (k.startsWith(urlPrefix)) store.delete(k);
    }
  }

  global.ApiCache = { fetchJsonCached, postJsonCached, fetchJson, invalidate };
})(window);
