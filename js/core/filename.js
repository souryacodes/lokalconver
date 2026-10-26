// Safe download names. The name comes from the user's file, so treat it as untrusted.
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function safeBaseName(name, fallback = 'file') {
  let base = String(name ?? '').split(/[\\/]/).pop();        // drop any folder part
  base = base.replace(/\.[A-Za-z0-9]{1,8}$/, '');            // drop ONE extension
  base = base.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '') // control + bidi tricks
    .replace(/[<>:"|?*\\/]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');                        // no leading/trailing dots or spaces
  if (base.length > 80) base = base.slice(0, 80).trim();
  if (!base || WIN_RESERVED.test(base)) return fallback;
  return base;
}

export function outputName(inputName, toExt) {
  const ext = String(toExt).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${safeBaseName(inputName)}.${ext || 'bin'}`;
}
