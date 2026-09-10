// Print one reviewable Cache Rule. Add it to the existing ruleset; do not replace
// other rules. This does not make API, admin or arbitrary paths cache eligible.
import { filesIn } from './performance.mjs';
const host = process.argv[2];
if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error('Usage: node scripts/cloudflare-rule.mjs LIVE_HOSTNAME');
const paths = new Set();
for (const file of await filesIn('site')) {
  if (!file.endsWith('.html')) continue;
  const url = '/' + file.slice(5);
  paths.add(url);
  if (url.endsWith('/index.html')) {
    const route = url.slice(0, -10);
    paths.add(route);
    if (route !== '/') paths.add(route.slice(0, -1));
  }
}
console.log(JSON.stringify({
  description: 'Cache public hotel HTML only', enabled: true, action: 'set_cache_settings',
  expression: `(http.host eq ${JSON.stringify(host)} and http.request.method in {"GET" "HEAD"} and http.request.uri.path in {${[...paths].sort((a, b) => a.localeCompare(b)).map(p => JSON.stringify(p)).join(' ')}} and not any(http.request.headers.names[*] eq "authorization"))`,
  action_parameters: {cache: true, edge_ttl: {mode: 'respect_origin'}, browser_ttl: {mode: 'respect_origin'}},
}, null, 2));
