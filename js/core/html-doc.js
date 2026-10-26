// Wraps converted HTML into one complete, standalone page for DOWNLOAD ONLY.
// The page carries its own strict policy: no scripts, no network, only inline CSS and data: images.
// So even odd content from the source file cannot run anything when the file is opened later.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#0e1330;background:#fff}
h1,h2,h3,h4{line-height:1.25}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}
td,th{border:1px solid #c9cde0;padding:.35rem .6rem;text-align:left}pre,code{font-family:ui-monospace,Consolas,monospace;background:#f1f2f8}
pre{padding:.75rem;overflow-x:auto}code{padding:.1rem .3rem}blockquote{margin-left:0;padding-left:1rem;border-left:4px solid #c9cde0;color:#5a6385}`;

export function wrapHtmlDocument({ title, bodyHtml, lang = 'en' }) {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title || 'Document')}</title>
<style>${CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
