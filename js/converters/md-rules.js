// Extra Turndown rules for Word documents. Turndown has no table support of its own,
// and base64 images would make the Markdown huge, so images are left out (and counted).
export function addDocxRules(td, notes) {
  td.addRule('lcImage', { filter: 'img', replacement: () => '' });
  td.addRule('lcTable', {
    filter: 'table',
    replacement(_content, node) {
      const rows = Array.from(node.rows).map((tr) =>
        Array.from(tr.cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
      const line = (r) => `| ${pad(r).join(' | ')} |`;
      notes.tables = (notes.tables || 0) + 1;
      return `\n\n${[line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n')}\n\n`;
    },
  });
  return td;
}
