// Builds a self-contained dashboard.html: kit.html with an add-on's render(source) inlined.
// Usage: bun run assemble.ts <render.js> <out.html> "<Title>"
import path from 'node:path';

const [renderPath, outPath, title = 'Alert dashboard'] = process.argv.slice(2);
if (!renderPath || !outPath) {
  console.error('usage: bun run assemble.ts <render.js> <out.html> "<Title>"');
  process.exit(2);
}
const kit = await Bun.file(path.join(import.meta.dir, 'kit.html')).text();
const render = await Bun.file(renderPath).text();
if (!/function render\s*\(/.test(render))
  throw new Error(`${renderPath} must define function render(source)`);
if (!kit.includes('/*__RENDER__*/')) throw new Error('kit.html lost its /*__RENDER__*/ slot');
const html = kit
  .replace('/*__RENDER__*/', () => render.trim())
  .replace('__TITLE__', () => title.replace(/[<&>]/g, ''));
await Bun.write(outPath, html);
console.log(`[assemble] ${path.basename(renderPath)} -> ${outPath} bytes=${html.length}`);
