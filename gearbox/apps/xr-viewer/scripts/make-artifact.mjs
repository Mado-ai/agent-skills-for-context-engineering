/**
 * Converts the vite single-file build into an Artifact-compatible fragment.
 *
 * The Artifact host supplies its own <!doctype>, <html>, <head> and <body>, so the
 * page content must not bring its own. This lifts the inlined <style> and <script>
 * out of the built document and emits just the content.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../dist/index.html');
const out = resolve(here, '../dist/artifact.html');

const html = readFileSync(src, 'utf8');

const headMatch = /<head>([\s\S]*?)<\/head>/i.exec(html);
const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);

if (!headMatch || !bodyMatch) {
  console.error('[artifact] could not locate <head> / <body> in the build output');
  process.exit(1);
}

// Keep <style> and <script> from head; drop <meta>, <title> and <link> — the host
// provides the document shell and the title comes from the publish call.
const headKeep = [...headMatch[1].matchAll(/<(style|script)\b[\s\S]*?<\/\1>/gi)]
  .map((m) => m[0])
  .join('\n');

const fragment = `${headKeep}\n${bodyMatch[1].trim()}\n`;

if (!/<canvas|<div id="stage"/.test(fragment)) {
  console.error('[artifact] fragment is missing the stage element — refusing to write');
  process.exit(1);
}

writeFileSync(out, fragment, 'utf8');
console.log(`[artifact] wrote ${out} (${(fragment.length / 1024).toFixed(0)} kB)`);
