import { mountDocConverters } from '../js/ui/doc-converters.js';
import { mountFingerprint } from '../js/ui/fingerprint.js';

mountDocConverters(document.getElementById('docs'));
mountFingerprint(document.getElementById('fingerprint'));
