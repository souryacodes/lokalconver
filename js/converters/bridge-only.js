// Conversions that need the LokalConver Bridge (Tier 3, step S12). They are LISTED so people can see them,
// but they cannot run in the browser, and nothing here pretends otherwise.
import { ConvertError } from '../core/errors.js';

export const BRIDGE_BADGE = 'Needs the LokalConver Bridge';
export const BRIDGE_HELP = 'This runs in a small helper app on your own computer, so the file still stays with you. The helper is not available in this version yet.';

const make = (from, label) => ({
  id: `${from}-pdf-bridge`,
  from: [from],
  to: ['pdf'],
  engine: 'bridge',
  available: false,
  label,
  estimate: () => ({ downloadKB: null }),
  async load() { throw bridgeError(label); },
  async run() { throw bridgeError(label); },
});

function bridgeError(label) {
  return new ConvertError('BRIDGE_REQUIRED', `${label} needs the LokalConver Bridge. ${BRIDGE_HELP}`);
}

export const bridgeConverters = [
  make('docx', 'Word to PDF'),
  make('pptx', 'PowerPoint to PDF'),
  make('xlsx', 'Excel to PDF'),
];
