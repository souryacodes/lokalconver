// docs.js - registers the document and data converters with the app's registry.
//
//   docx -> txt, html, md        md -> html          txt -> pdf
//   csv <-> json                 xlsx -> csv, json
//
// The list itself lives in index.js (the test page uses it too). Conversions that
// need the LokalConver Bridge (Word/PowerPoint/Excel to PDF) are NOT registered:
// the Convert page lists every registered target as a real choice, and a choice
// that can only fail would be dishonest.
import { registerConverter } from '../core/registry.js';
import { converters } from './index.js';

for (const converter of converters) {
  if (converter.available !== false) registerConverter(converter);
}
