/**
 * Converts the vite single-file build into an Artifact-compatible fragment.
 *
 * The Artifact host supplies its own <!doctype>, <html>, <head> and <body>, so the
 * page content must not bring its own.
 *
 * This walks the document by index rather than by regex. A ~500 kB inlined bundle
 * contains literal `<body` and `<head` substrings inside JavaScript, so a pattern like
 * /<body[^>]*>([\s\S]*?)<\/body>/ happily matches from inside the script and silently
 * duplicates it — which is exactly what happened before this was rewritten.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../dist/index.html');
const out = resolve(here, '../dist/artifact.html');

const html = readFileSync(src, 'utf8');

function fail(message) {
  console.error(`[artifact] ${message}`);
  process.exit(1);
}

// The real structural tags each appear exactly once in vite's output. If that stops
// being true, stop rather than guess.
const countOf = (needle) => html.split(needle).length - 1;
for (const tag of ['<head>', '</head>', '</body>']) {
  if (countOf(tag) !== 1) fail(`expected exactly one ${tag}, found ${countOf(tag)}`);
}

const headStart = html.indexOf('<head>') + '<head>'.length;
const headEnd = html.indexOf('</head>');
const head = html.slice(headStart, headEnd);

// Find <body> only after </head>, so a `<body` inside the bundle cannot win.
const bodyOpen = html.indexOf('<body', headEnd);
if (bodyOpen === -1) fail('no <body> after </head>');
const bodyContentStart = html.indexOf('>', bodyOpen) + 1;
const bodyEnd = html.lastIndexOf('</body>');
if (bodyEnd <= bodyContentStart) fail('malformed body range');
const body = html.slice(bodyContentStart, bodyEnd);

// Keep <style> and <script> from head; drop <meta>, <title> and <link> — the host
// provides the shell and the title comes from the publish call.
const keep = [];
let cursor = 0;
for (;;) {
  const styleAt = head.indexOf('<style', cursor);
  const scriptAt = head.indexOf('<script', cursor);
  const candidates = [styleAt, scriptAt].filter((i) => i !== -1);
  if (candidates.length === 0) break;

  const start = Math.min(...candidates);
  const tag = start === styleAt ? 'style' : 'script';
  const close = head.indexOf(`</${tag}>`, start);
  if (close === -1) fail(`unterminated <${tag}> in head`);

  keep.push(head.slice(start, close + `</${tag}>`.length));
  cursor = close + 1;
}

const fragment = `${keep.join('\n')}\n${body.trim()}\n`;

// Sanity gates: the two things that must be true for the page to work at all.
if (!fragment.includes('id="stage"')) fail('fragment is missing the stage element');
const scriptCount = fragment.split('<script').length - 1;
if (scriptCount !== 1) fail(`expected exactly one script, found ${scriptCount}`);
if (fragment.length > html.length) fail('fragment is larger than the source — duplication');

writeFileSync(out, fragment, 'utf8');
console.log(
  `[artifact] wrote ${out} (${(fragment.length / 1024).toFixed(0)} kB, ${scriptCount} script)`,
);
