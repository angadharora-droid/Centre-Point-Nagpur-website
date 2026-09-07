import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const brand = 'Centre Point Hotel Nagpur';
const labels = {
  '/': 'Hotel in Ramdaspeth, Nagpur',
  '/our-rooms/': 'Rooms & Suites',
  '/accommodation/club-room/': 'Club Room',
  '/accommodation/cp-suite/': 'CP Suite',
  '/accommodation/deluxe-suite/': 'Deluxe Suite',
  '/accommodation/executive-rooms/': 'Executive Rooms',
  '/accommodation/premium-rooms/': 'Premium Rooms',
  '/accommodation/super-club/': 'Super Club Rooms',
  '/amenities/': 'Hotel Amenities',
  '/banquet-hall/': 'Banquet Halls & Events',
  '/board-room/': 'Board Room',
  '/bougainvillea/': 'Bougainvillea Restaurant',
  '/contact-us/': 'Contact & Location',
  '/dining-in-nagpur-explore-the-best-restaurants-at-hotel-centre-point/': 'Dining in Nagpur',
  '/foints/': 'Foints Loyalty Program',
  '/freakk-de-bistro/': 'Freakk De Bistro',
  '/golden-chamber/': 'Golden Chamber',
  '/grand-millennium/': 'Grand Millennium',
  '/gym/': 'Fitness Centre',
  '/high-steaks-rooftop/': 'High Steaks Rooftop',
  '/hotel-gallery/': 'Hotel Photo Gallery',
  '/luxurious-amenities-at-hotel-centre-point-nagpur/': 'A Guide to Hotel Amenities',
  '/meeting-point/': 'Meeting Point Restaurant',
  '/millennium/': 'Millennium Banquet Hall',
  '/palacio-2/': 'Palacio Banquet Hall',
  '/privacy-policy-2/': 'Privacy Policy',
  '/sammelan/': 'Sammelan Banquet Hall',
  '/sapphire/': 'Sapphire Banquet Hall',
  '/silver-chamber/': 'Silver Chamber',
  '/spa-gym/': 'Swimming Pool & Spa',
  '/steam-room/': 'Steam Room',
  '/studio-rooms/': 'Studio Rooms & Meetings',
  '/terms-cancellation-policy/': 'Terms & Cancellation Policy',
  '/unpulgged/': 'Unplugged',
  '/why-choose-hotel-centre-point-for-your-stay-in-nagpur/': 'Planning Your Stay in Nagpur',
};
const descriptions = {
  '/': 'Discover Centre Point Hotel in Ramdaspeth, Nagpur. Explore rooms and suites, dining, banquet venues and hotel amenities, and book your stay online.',
  '/our-rooms/': 'Explore rooms and suites at Centre Point Hotel Nagpur, including Executive, Premium, Club and suite options. View room details and book online.',
  '/contact-us/': 'Contact Centre Point Hotel Nagpur at 24, Central Bazar Road, Ramdaspeth. Find the hotel address, phone numbers and email for enquiries.',
  '/hotel-gallery/': 'Browse original photos of Centre Point Hotel Nagpur, including rooms, dining spaces, event venues and hotel interiors.',
  '/privacy-policy-2/': 'Read the privacy policy for Centre Point Hotel Nagpur, including information about how personal information is handled.',
  '/terms-cancellation-policy/': 'Read the terms and cancellation policy for Centre Point Hotel Nagpur before planning your stay or making a reservation.',
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m => [m[1].toLowerCase(), m[3]]));

export function seoSettings(env = process.env) {
  const raw = env.PUBLIC_SITE_URL?.trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  let origin = '';
  if (raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_SITE_URL must be an HTTPS origin without a path, credentials or query string');
    origin = url.origin;
  }
  const railwayEnv = env.RAILWAY_ENVIRONMENT_NAME?.trim();
  const production = (!env.VERCEL_ENV || env.VERCEL_ENV === 'production') && (!railwayEnv || railwayEnv === 'production');
  return { origin, indexable: Boolean(origin) && production };
}

export function optimizePage(html, route, settings) {
  const label = labels[route];
  const indexable = settings.indexable && Boolean(label);
  const title = route === '/' ? `${brand} | Rooms, Dining & Banquets` : `${label || 'Page'} | ${brand}`;
  const description = descriptions[route] || (label ? `Explore ${label} at ${brand} in Ramdaspeth. View details and photographs, and contact the hotel to plan your visit.` : 'Additional information from Centre Point Hotel Nagpur.');
  const canonical = settings.origin ? new URL(route, settings.origin).href : '';
  const imagePath = '/wp-content/uploads/2024/08/DSC09123-min-scaled.jpg';
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) throw new Error(`Missing head in ${route}`);
  let head = headMatch[1];
  const originalImageTag = [...head.matchAll(/<meta\b[^>]*>/gi)].find(m => attributes(m[0]).property === 'og:image');
  const originalImage = originalImageTag && attributes(originalImageTag[0]).content;
  const image = settings.origin ? new URL(originalImage?.startsWith('/') ? originalImage : imagePath, settings.origin).href : '';
  head = head.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<meta\b[^>]*>/gi, tag => {
      const a = attributes(tag); const key = (a.name || a.property || '').toLowerCase();
      return ['description', 'robots', 'googlebot', 'viewport'].includes(key) || /^(og:|twitter:|article:)/.test(key) ? '' : tag;
    })
    .replace(/<link\b[^>]*>/gi, tag => {
      const a = attributes(tag);
      return ['canonical', 'pingback', 'shortlink'].includes(a.rel) || a.type === 'application/rss+xml' || a.type === 'application/json' ? '' : tag;
    });
  const tags = [
    `<title>${escape(title)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="description" content="${escape(description)}">`,
    `<meta name="robots" content="${indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="en_IN">',
    `<meta property="og:site_name" content="${brand}">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escape(title)}">`,
    `<meta name="twitter:description" content="${escape(description)}">`,
  ];
  if (canonical) {
    tags.push(`<link rel="canonical" href="${escape(canonical)}">`, `<meta property="og:url" content="${escape(canonical)}">`, `<meta property="og:image" content="${escape(image)}">`, `<meta name="twitter:image" content="${escape(image)}">`, `<meta property="og:image:alt" content="${brand}">`);
    const home = settings.origin + '/';
    const graph = [
      { '@type': 'WebSite', '@id': home + '#website', url: home, name: brand, inLanguage: 'en-IN' },
      { '@type': 'WebPage', '@id': canonical + '#webpage', url: canonical, name: title, description, isPartOf: { '@id': home + '#website' }, inLanguage: 'en-IN' },
    ];
    if (route === '/') graph.push({ '@type': 'Hotel', '@id': home + '#hotel', name: brand, url: home, image, telephone: '+91-9266923456', email: 'info.nagpur@cpgh.in', address: { '@type': 'PostalAddress', streetAddress: '24, Central Bazar Road, Ramdaspeth', addressLocality: 'Nagpur', addressRegion: 'Maharashtra', postalCode: '440010', addressCountry: 'IN' } });
    else if (label) graph.push({ '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Home', item: home }, { '@type': 'ListItem', position: 2, name: label, item: canonical } ] });
    tags.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c')}</script>`);
  }
  return { html: html.replace(headMatch[0], `<head>${head}\n${tags.join('\n')}\n</head>`), canonical, indexable };
}

export async function applySeo(directory, env = process.env) {
  const settings = seoSettings(env);
  const urls = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name === 'index.html') {
        const relative = path.relative(directory, file).split(path.sep).join('/');
        const route = '/' + relative.replace(/index\.html$/, '');
        const result = optimizePage(await readFile(file, 'utf8'), route, settings);
        await writeFile(file, result.html);
        if (result.indexable) urls.push(result.canonical);
      }
    }
  }
  await walk(directory);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.sort((a, b) => a.localeCompare(b)).map(url => `  <url><loc>${escape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile(path.join(directory, 'sitemap.xml'), sitemap);
  // Permit crawling so crawlers can read noindex on preview and excluded pages.
  await writeFile(path.join(directory, 'robots.txt'), `User-agent: *\nAllow: /\n${settings.indexable ? `Sitemap: ${settings.origin}/sitemap.xml\n` : ''}`);
  console.log(`SEO: ${urls.length} indexable pages; ${settings.origin || 'set PUBLIC_SITE_URL to enable production indexing'}.`);
}
