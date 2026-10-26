// Read a file as text without guessing wrongly in silence.
// Order: BOM (UTF-8 / UTF-16) -> strict UTF-8 -> Windows-1252 with a warning.
export function decodeText(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), warning: null };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), warning: null };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), warning: null };
  } catch {
    // Excel "CSV (Comma delimited)" on Windows often saves this way.
    return {
      text: new TextDecoder('windows-1252').decode(b),
      warning: 'This file is not UTF-8. It was read as Windows-1252, so check any accented letters.',
    };
  }
}
