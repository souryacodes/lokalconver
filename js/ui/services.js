// The glue between the Convert page and the engine registry (js/core/registry.js).
// Why a separate file: the page asks plain questions ("what should this become?")
// and this file turns the registry's richer answers into plain lists.
// It has no DOM code, so it can be tested with node --test.

// Files that can be made smaller while keeping their format (JPG and WEBP are lossy,
// so a quality or size target really changes the file; a PDF is drawn again as pictures).
// The registry has no same-format routes on purpose, so this extra path is only used by
// presets such as "Photo under 50 KB" and "PDF under 500 KB".
const SHRINKABLE = ['jpg', 'webp', 'pdf'];

export function createConvertServices(registry) {
  const findShrinker = (ext) => (SHRINKABLE.includes(ext)
    ? registry.listConverters().find((c) => c.from.includes(ext) && c.to.includes(ext)) ?? null
    : null);

  return {
    findShrinker,
    // The registry's best pick comes first, then every other target it can really make.
    suggestTarget(fromExt, file) {
      const best = registry.suggestTarget(fromExt, file);
      if (!best) return null;
      const others = registry.findTargets(fromExt, file).map((t) => t.ext).filter((ext) => ext !== best.ext);
      return { target: best.ext, alternatives: others };
    },
    findConverter: (fromExt, toExt) => registry.getConverter(fromExt, toExt) ?? (fromExt === toExt ? findShrinker(fromExt) : null),
    listTargets: (fromExt) => registry.findTargets(fromExt).map((t) => t.ext),
  };
}
