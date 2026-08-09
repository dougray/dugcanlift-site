/**
 * CORS proxy for Open Food Facts, for the LIFT web app.
 *
 * Open Food Facts doesn't reliably send Access-Control-Allow-Origin, so
 * browsers block direct calls. This forwards the request server-side, where
 * CORS doesn't apply, and adds the header on the way back.
 *
 * Usage:
 *   /search?q=peanut+butter
 *   /barcode/0722252100900
 *
 * Deploy at dash.cloudflare.com -> Workers & Pages -> Create -> paste this.
 */

// Only these origins may call the proxy. Without this it's an open relay and
// will be found and abused.
const ALLOWED_ORIGINS = [
  'https://www.dugcanlift.com',
  'https://dugcanlift.com',
  'http://localhost:4000',
];

// Only these upstreams may be reached. Same reasoning.
const OFF = 'https://world.openfoodfacts.org';

const FIELDS = 'code,product_name,brands,serving_size,nutriments';

const USER_AGENT = 'LIFT/1.0 (https://www.dugcanlift.com)';

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'public, max-age=300',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    try {
      let upstream;

      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return json({ error: 'Missing q' }, 400, origin);
        // Cap the page size — this proxy is for one small app, not bulk export.
        const size = Math.min(parseInt(url.searchParams.get('page_size') || '20', 10) || 20, 50);
        upstream = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}` +
          `&search_simple=1&action=process&json=1&page_size=${size}&fields=${FIELDS}`;

      } else if (url.pathname.startsWith('/barcode/')) {
        const code = url.pathname.slice('/barcode/'.length).replace(/[^0-9]/g, '');
        if (!code) return json({ error: 'Missing barcode' }, 400, origin);
        upstream = `${OFF}/api/v2/product/${code}.json?fields=${FIELDS}`;

      } else {
        return json({ error: 'Not found. Use /search?q= or /barcode/<code>' }, 404, origin);
      }

      const res = await fetch(upstream, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        // Cloudflare's edge cache — repeat lookups don't hammer Open Food Facts.
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      if (!res.ok) {
        return json({ error: `Open Food Facts returned ${res.status}` }, 502, origin);
      }

      const data = await res.json();
      return json(data, 200, origin);

    } catch (e) {
      return json({ error: 'Proxy failed: ' + (e.message || 'unknown') }, 502, origin);
    }
  },
};
