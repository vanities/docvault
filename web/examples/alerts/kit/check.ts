// Syntax-checks a dashboard's inline script by parsing it (no line-based extraction).
// Usage: bun run check.ts <dashboard.html>
const html = await Bun.file(process.argv[2]).text();
const start = html.indexOf('<script>');
const end = html.lastIndexOf('</script>');
if (start < 0 || end < start) throw new Error('no <script> block found');
const code = html.slice(start + '<script>'.length, end);
try {
  new Function(code);
  console.log(`[check] ${process.argv[2]} script parses (${code.length} chars)`);
} catch (err) {
  console.error(`[check] ${process.argv[2]} SYNTAX ERROR: ${(err as Error).message}`);
  process.exit(1);
}
