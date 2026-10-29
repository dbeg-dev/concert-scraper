// Shared HTTP helper. Uses a browser-like User-Agent because several NYC
// venue sites reject default Node clients.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries 429 and 5xx with exponential backoff so a busy venue site doesn't drop data.
async function getText(url, { timeoutMs = 20000, headers = {}, retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...headers },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (res.ok) return await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) throw new Error(`HTTP ${res.status} for ${url}`);
      await sleep(2000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function getJson(url, opts = {}) {
  return JSON.parse(await getText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } }));
}

// Run async tasks with a concurrency cap so we don't hammer a venue site.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Some sites (the Frick) reject Node's fetch outright but answer curl, which
// every GitHub runner has. Used only as a fallback.
function getTextCurl(url, { timeoutMs = 30000 } = {}) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile('curl', ['-sSL', '--compressed', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', USER_AGENT, '-w', '\n%{http_code}', url],
      { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error(`curl failed for ${url}: ${err.message}`));
        const cut = stdout.lastIndexOf('\n');
        const code = Number(stdout.slice(cut + 1));
        if (code >= 200 && code < 300) resolve(stdout.slice(0, cut));
        else reject(new Error(`HTTP ${code} for ${url} (curl)`));
      });
  });
}

module.exports = { getText, getTextCurl, getJson, mapLimit, sleep, USER_AGENT };
