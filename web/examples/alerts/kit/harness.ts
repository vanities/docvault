// Builds a test page that loads a dashboard in a script-only sandbox and feeds it a source
// exactly like DocVault does (postMessage after the frame says it is ready, auto height).
// Usage: bun run harness.ts <dashboard.html> <source.json> <out.html>
const [dashPath, sourcePath, outPath] = process.argv.slice(2);
const dashboard = await Bun.file(dashPath).text();
const source = JSON.parse(await Bun.file(sourcePath).text());
const theme = {
  mode: 'dark',
  colors: {
    'surface-50': '#111318',
    'surface-100': '#16181e',
    'surface-200': '#1c1f26',
    'surface-300': '#24272f',
    'surface-700': '#626a7c',
    'surface-800': '#8891a5',
    'surface-950': '#d8dde9',
    'accent-400': '#34d399',
    'warn-400': '#fbbf24',
    'danger-400': '#f87171',
  },
};
// The dashboard's own </script> would end this page's script early, so escape "</".
const srcdoc = JSON.stringify(dashboard).replace(/<\//g, '<\\/');
const html = `<!doctype html><meta charset="utf-8"><title>harness</title>
<style>body{margin:0;background:#111318}main{max-width:1152px;margin:0 auto;padding:24px}iframe{width:100%;border:1px solid #262a33;border-radius:12px;background:#111318}</style>
<main><iframe id="f" sandbox="allow-scripts" style="height:300px"></iframe></main>
<script>
const source = ${JSON.stringify(source).replace(/<\//g, '<\\/')};
const f = document.getElementById('f');
const post = () => f.contentWindow.postMessage({ type: 'docvault:alert', version: 1, source, theme: ${JSON.stringify(theme)} }, '*');
addEventListener('message', (e) => { if (e.source !== f.contentWindow) return;
  if (e.data.type === 'docvault:alert:ready') post();
  if (e.data.type === 'docvault:alert:height') f.style.height = Math.min(6000, Math.max(160, Math.ceil(e.data.height))) + 'px'; });
f.onload = post;
f.srcdoc = ${srcdoc};
</script>`;
await Bun.write(outPath, html);
console.log(`[harness] ${outPath} bytes=${html.length}`);
