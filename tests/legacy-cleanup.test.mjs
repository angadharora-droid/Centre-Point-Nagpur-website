import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {cleanLegacyRuntime, bundleScripts, lazyBooking, dedupeHeadLinks} from '../scripts/legacy-cleanup.mjs';

void test('removes obsolete generators and unused Pro runtime without removing styling', () => {
 const html = '<meta name="generator" content="WordPress"><link rel="stylesheet" href="/wp-content/plugins/elementor-pro/style.css"><script src="/wp-content/plugins/elementor-pro/assets/js/frontend.min.js"></script><script id="elementor-pro-frontend-js-before">var elementorProFrontendConfig={}</script>';
 const out=cleanLegacyRuntime(html);
 assert.ok(!out.includes('<script'));
 assert.ok(!out.includes('generator'));
 assert.ok(out.includes('<link'));
});
void test('retains booking runtime and its config when MotoPress UI is present', () => {
 const html='<form class="mphb-sc-search-form"></form><script id="mphb-js-extra">var MPHB={}</script><script src="/wp-content/plugins/motopress-hotel-booking/a.js" id="mphb-js"></script>';
 assert.ok(cleanLegacyRuntime(html).includes('var MPHB'));
 assert.ok(cleanLegacyRuntime(html).includes('a.js'));
});
void test('bundling preserves execution order and keeps URL-sensitive runtimes separate', async t => {
 const root=await mkdtemp(path.join(tmpdir(),'cp-bundle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'a.js'),'window.order=[1];');
 await writeFile(path.join(root,'b.js'),'window.order.push(2);');
 await writeFile(path.join(root,'runtime.js'),'window.url=document.currentScript.src;');
 const out=await bundleScripts('<script defer src="/a.js"></script><div>content</div><script defer src="/b.js"></script><script defer src="/runtime.js"></script>',root);
 const url=out.match(/src="(\/assets\/[^"']+)"/)[1];
 const context={window:{}};
 vm.runInNewContext(await readFile(path.join(root,url),'utf8'),context);
 assert.deepEqual([...context.window.order],[1,2]);
 assert.ok(out.includes('/runtime.js'));assert.ok(out.includes('<div>content</div>'));
 assert.equal((out.match(/<script/g)||[]).length,2);
});
void test('booking request starts on interaction, preserving vendor attributes', () => {
 const out=lazyBooking('<body><script src="https://www.swiftbook.io/plugin/js/booking-service.min.js" id="propInfo" propertyid="hotel"></script><div id="quickbook-widget"></div></body>');
 assert.ok(!out.includes('<script src="https://www.swiftbook.io'));
 assert.ok(out.includes('Check availability'));
 assert.ok(out.includes('id="quickbook-widget" class="widget-loaded"'));
 assert.ok(out.includes("button.addEventListener('click'"));
 assert.ok(out.includes('"propertyid":"hotel"'));
 assert.ok(out.includes('script.onerror'));
});
void test('drops the redundant cdnjs Font Awesome sheet when the theme bundles it locally', () => {
 const local = "<link rel='stylesheet' href='/wp-content/themes/hoteller/css/font-awesome.min.css'>";
 const cdn = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" media="all" onload="this.media=\'all\'" />';
 assert.ok(!cleanLegacyRuntime(local + cdn).includes('cdnjs.cloudflare.com'));
 assert.ok(cleanLegacyRuntime(local + cdn).includes('/themes/hoteller/css/font-awesome'));
 assert.ok(cleanLegacyRuntime(cdn).includes('cdnjs.cloudflare.com')); // kept when no local sheet
});
void test('dedupeHeadLinks drops repeat stylesheet and preconnect requests, keeps the first', () => {
 const fa = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" media="all" onload="this.media=\'all\'" />';
 const faAgain = '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer" />';
 const pc = '<link rel="preconnect" href="https://fonts.googleapis.com">';
 const out = dedupeHeadLinks(fa + faAgain + pc + pc + '<link rel="stylesheet" href="/assets/site.css">');
 assert.equal((out.match(/font-awesome/g) || []).length, 1);
 assert.equal((out.match(/fonts\.googleapis\.com/g) || []).length, 1);
 assert.ok(out.includes('/assets/site.css'));
 assert.ok(out.includes("onload=\"this.media='all'\"")); // first occurrence is the one kept
});
void test('dedupeHeadLinks leaves distinct hrefs and non-dedup rels untouched', () => {
 const html = '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"><link rel="icon" href="/f.png"><link rel="icon" href="/f.png">';
 assert.equal(dedupeHeadLinks(html), html);
});
void test('removes duplicate Google Fonts requests only when local families are present', () => {
 const local='<link rel="stylesheet" href="/wp-content/uploads/elementor/google-fonts/css/cormorantgaramond.css">';
 const remote='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&display=swap">';
 assert.ok(!cleanLegacyRuntime(local+remote).includes('fonts.googleapis.com'));
 assert.ok(cleanLegacyRuntime(remote).includes('fonts.googleapis.com'));
});
