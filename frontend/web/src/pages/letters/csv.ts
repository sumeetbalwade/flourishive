/** Splits one CSV line, honouring "quoted, values". */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The first line names the columns (field keys such as recipientName); each next line is one person. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = splitCsv(lines[0]!);
  return lines.slice(1).map((l) => {
    const cells = splitCsv(l);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']).filter(([h]) => h));
  });
}
