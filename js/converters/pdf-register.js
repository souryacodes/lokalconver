// pdf-register.js - registers the PDF converters that fit the Convert page with the app's registry.
//
// The Convert page turns ONE file into ONE other format, so only these four belong in the registry:
//   images -> pdf     pdf -> png, jpg     pdf -> txt     pdf -> pdf (smaller; used by the PDF presets)
//
// Merge, split and rotate need several files, a page list or a direction. They live on the
// PDF tools page (js/ui/pdf-tools.js), which uses the same converter objects from pdf.js.
//
// Nothing is loaded here: pdf.js only imports small helper files. The PDF engines (pdf-lib, pdf.js, fflate)
// are read from js/vendor/ the first time a PDF job runs.
import { registerConverter } from '../core/registry.js';
import { pdfConverters } from './pdf.js';

export const CONVERT_PAGE_PDF_IDS = ['images-to-pdf', 'pdf-to-images', 'pdf-to-text', 'pdf-compress'];

for (const converter of pdfConverters) {
  if (CONVERT_PAGE_PDF_IDS.includes(converter.id)) registerConverter(converter);
}
