// The glue between the Convert page and the engine registry (js/core/registry.js).
// Why a separate file: the page asks plain questions ("what should this become?")
// and this file turns the registry's richer answers into plain lists.
// It has no DOM code, so it can be tested with node --test.

export function createConvertServices(registry) {
  return {
    // The registry's best pick comes first, then every other target it can really make.
    suggestTarget(fromExt, file) {
      const best = registry.suggestTarget(fromExt, file);
      if (!best) return null;
      const others = registry.findTargets(fromExt, file).map((t) => t.ext).filter((ext) => ext !== best.ext);
      return { target: best.ext, alternatives: others };
    },
    findConverter: (fromExt, toExt) => registry.getConverter(fromExt, toExt),
    listTargets: (fromExt) => registry.findTargets(fromExt).map((t) => t.ext),
  };
}
