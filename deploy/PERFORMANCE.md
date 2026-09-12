# Production rollout

1. Deploy this source to the existing Railway service. Docker now builds images,
   CSS and compression once; container startup only refreshes runtime settings and
   SEO. Keep Railway Serverless disabled if a continuously warm origin is required.
   No Railway plan, resources, region or sleep settings were changed here.
2. Generate the scoped rule with
   `node scripts/cloudflare-rule.mjs YOUR_LIVE_HOSTNAME`. In the existing
   Cloudflare zone, add this as a Cache Rule (Eligible for cache, respect origin
   Edge TTL and Browser TTL). Preserve all existing unrelated rules. The rule
   allows only captured public HTML routes and GET/HEAD, excluding Authorization
   requests. API, admin, runtime JS and unknown paths are outside its allowlist.
3. Purge the site's HTML URLs from Cloudflare after deployment so cached HTML
   picks up the new hashed assets. Allow up to five minutes for HTML newly cached in
   other CDNs. Old unversioned CSS already cached by browsers cannot be remotely
   expired; the rebuilt HTML references different filenames and avoids those entries.
4. Request the live homepage twice with `curl -sSI https://YOUR_LIVE_HOSTNAME/`.
   The second request should show `cf-cache-status: HIT` (assuming the request
   reaches the same edge cache). Confirm `Age` grows, HTML uses `s-maxage=300`,
   API responses remain `no-store`, and direct `.webp` responses are `image/webp`.
5. Check live menus, room gallery, Swiftbook widget and enquiry submission on
   desktop and mobile. Script execution has been deferred as an ordered group,
   and unused ElementsKit rules are pruned with runtime-script/state safeguards;
   browser interaction QA is still required before treating visual compatibility
   as confirmed.

The checked-in Sites manifest points to a separate static-only preview. It cannot
run `backend/server.mjs` or the MongoDB API. Publishing that preview is not a
Railway deployment and cannot apply these origin/cache changes to the live site.

Cloudflare does not cache HTML by default; origin cache headers alone cannot make
it eligible: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
Cache-rule settings: https://developers.cloudflare.com/cache/how-to/cache-rules/settings/
Explicit WebP URLs avoid requiring image-variant configuration:
https://developers.cloudflare.com/cache/advanced-configuration/vary-for-images/
