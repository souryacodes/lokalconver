// image-engine.js - the part of the image converter that draws and saves.
// It runs inside the Web Worker. If the browser has no worker or no
// OffscreenCanvas, image.js runs the same code on the page instead, so
// this file must work in BOTH places (no top-level use of `document`).
//
// Nothing here sends anything over the network.

import {
  LOSSY, MIME, TARGET_FORMATS,
  ImageError, abortError,
  bestQualityForTarget, buildIco, canvasSizeCandidates, computeOutputSize,
  containSize, encodeBmp24, halvingPlan, kbToBytes, parseSvgSize,
  reductionNote, scaleSize, shrinkScales, svgRasterSize, targetMessage,
} from './image-core.js';

// ---------- Drawing surfaces ----------

// OffscreenCanvas in a worker; a normal canvas on the page as the fallback.
export function makeSurface(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // fall through to a normal canvas
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new ImageError('This browser cannot draw pictures here.');
}

// Setting the size to 0 hands the memory back right away.
export function releaseSurface(surface) {
  try {
    surface.width = 0;
    surface.height = 0;
  } catch {
    // nothing to do
  }
}

// Phones can say "ok" to a big canvas and then draw nothing. So we write
// one pixel in the far corner and read it back.
export function canvasWorks(width, height) {
  let surface = null;
  try {
    surface = makeSurface(width, height);
    const ctx = surface.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = 'rgb(1, 2, 3)';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const px = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    return px[0] === 1 && px[1] === 2 && px[2] === 3 && px[3] === 255;
  } catch {
    return false;
  } finally {
    if (surface) releaseSurface(surface);
  }
}

// Saves a surface as a file. Browsers that cannot make the format quietly
// give a PNG instead, so we check the type and say so honestly.
export async function surfaceToBlob(surface, ext, quality) {
  const type = MIME[ext];
  const lossy = LOSSY.has(ext);
  let blob;
  if (typeof surface.convertToBlob === 'function') {
    blob = await surface.convertToBlob(lossy ? { type, quality } : { type });
  } else {
    blob = await new Promise((resolve) => surface.toBlob(resolve, type, lossy ? quality : undefined));
  }
  if (!blob) throw new Error('The browser could not save the picture.');
  if (blob.type !== type) {
    throw new ImageError(`This browser cannot save ${ext.toUpperCase()} files. Pick another format.`);
  }
  return blob;
}

// ---------- What can this browser do? ----------

// A real 2x2 AVIF (299 bytes). Used only to learn if the browser can read AVIF.
const AVIF_PROBE =
  'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAGAAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAIG1kYXQSAAoFGAA2BCAyDRsAGmmmhAAAr5H2l1Q=';

async function canDecodeAvif() {
  try {
    const bytes = Uint8Array.from(atob(AVIF_PROBE), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/avif' }));
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

async function canEncode(ext) {
  let surface = null;
  try {
    surface = makeSurface(2, 2);
    const ctx = surface.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 2, 2);
    await surfaceToBlob(surface, ext, 0.5);
    return true;
  } catch {
    return false;
  } finally {
    if (surface) releaseSurface(surface);
  }
}

let supportPromise = null;

// Runs the tiny tests ONCE and remembers the answer.
export function detectSupport() {
  supportPromise ??= (async () => {
    const [webp, avif, decodeAvif] = await Promise.all([canEncode('webp'), canEncode('avif'), canDecodeAvif()]);
    return { encode: { jpg: true, png: true, webp, avif }, decodeAvif };
  })();
  return supportPromise;
}

// ---------- Opening pictures ----------

function isBlob(x) {
  return typeof Blob !== 'undefined' && x instanceof Blob;
}

async function decodeWithImgElement(blob) {
  // Last resort on the page (not in a worker). Browsers turn photos upright
  // for <img> by themselves.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// imageOrientation 'from-image' turns phone photos upright using EXIF.
export async function decodeFile(file, ext = '') {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers do not know the option. Try without it.
  }
  try {
    return await createImageBitmap(file);
  } catch {
    // fall through
  }
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    try {
      return await decodeWithImgElement(file);
    } catch {
      // fall through
    }
  }
  if (ext === 'avif') throw new ImageError('This browser cannot open AVIF files. Try a newer browser.');
  throw new ImageError('Could not open this file as a picture. It may be damaged, or this browser may not support it.');
}

// SVG must be drawn on the PAGE: workers have no <img>. The SVG goes through
// an <img>, which never runs scripts or loads other files, so it is safe.
// Returns an ImageBitmap already at its final size, so the worker does not
// have to enlarge it (enlarging would blur it).
export async function rasteriseSvg(file, resize, notes) {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) {
    throw new ImageError('This SVG file is not valid.');
  }
  let intrinsic = parseSvgSize({
    width: root.getAttribute('width'),
    height: root.getAttribute('height'),
    viewBox: root.getAttribute('viewBox'),
  });
  if (!intrinsic) {
    intrinsic = { width: 1024, height: 1024 };
    notes.push('This SVG does not say how big it is, so a 1024×1024 canvas was used.');
  } else if (!root.hasAttribute('viewBox')) {
    // Without a viewBox the picture cannot be scaled, so add one.
    root.setAttribute('viewBox', `0 0 ${intrinsic.width} ${intrinsic.height}`);
  }

  const wanted = svgRasterSize(intrinsic, resize);
  const first = canvasSizeCandidates(wanted.width, wanted.height).find((c) => canvasWorks(c.width, c.height));
  if (!first) throw new ImageError('This device cannot draw a picture this big.');
  if (first.width !== wanted.width || first.height !== wanted.height) notes.push(reductionNote(wanted, first));

  // Firefox needs an explicit width and height to draw an SVG at a size.
  root.setAttribute('width', String(first.width));
  root.setAttribute('height', String(first.height));
  const svgText = new XMLSerializer().serializeToString(root);
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  let surface = null;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    surface = makeSurface(first.width, first.height);
    surface.getContext('2d').drawImage(img, 0, 0, first.width, first.height);
    return await createImageBitmap(surface);
  } catch {
    throw new ImageError('Could not draw this SVG file. It may use features this browser cannot show.');
  } finally {
    URL.revokeObjectURL(url);
    if (surface) releaseSurface(surface);
  }
}

// ---------- Drawing at a new size ----------

// Draws `src` at width x height in steps of at most half (see halvingPlan).
// `background` (a colour or null) is painted first, under the picture.
async function renderTo(src, srcW, srcH, width, height, background, check) {
  // A device that can draw the FINAL size may still refuse a bigger middle
  // step. Such middle steps are skipped (the picture is then drawn in one
  // bigger jump, which is a little less smooth but never fails).
  const plan = halvingPlan(srcW, srcH, width, height)
    .filter((step, i, all) => i === all.length - 1 || canvasWorks(step.width, step.height));
  let current = src;
  let currentSurface = null;
  for (let i = 0; i < plan.length; i += 1) {
    check();
    const step = plan[i];
    const surface = makeSurface(step.width, step.height);
    const ctx = surface.getContext('2d');
    if (!ctx) throw new ImageError('Could not start the drawing area.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (background && i === plan.length - 1) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, step.width, step.height);
    }
    ctx.drawImage(current, 0, 0, step.width, step.height);
    if (currentSurface) releaseSurface(currentSurface);
    current = surface;
    currentSurface = surface;
  }
  return currentSurface;
}

// ---------- The three kinds of output ----------

function bmpBlob(surface, width, height) {
  const ctx = surface.getContext('2d');
  const bytes = encodeBmp24(width, height, (y0, rows) => ctx.getImageData(0, y0, width, rows).data);
  return new Blob([bytes], { type: MIME.bmp });
}

async function makeSingle(bitmap, wanted, toExt, options, c) {
  // jpg and bmp cannot be see-through, so they get the background colour.
  const background = toExt === 'jpg' || toExt === 'bmp' ? options.background : null;
  for (const size of canvasSizeCandidates(wanted.width, wanted.height)) {
    if (!canvasWorks(size.width, size.height)) continue;
    let surface = null;
    try {
      c.onProgress(0.4, 'Drawing picture');
      surface = await renderTo(bitmap, bitmap.width, bitmap.height, size.width, size.height, background, c.check);
      c.onProgress(0.8, 'Saving');
      const blob = toExt === 'bmp'
        ? bmpBlob(surface, size.width, size.height)
        : await surfaceToBlob(surface, toExt, options.quality / 100);
      if (size.width !== wanted.width || size.height !== wanted.height) c.notes.push(reductionNote(wanted, size));
      return {
        blob,
        width: size.width,
        height: size.height,
        quality: LOSSY.has(toExt) ? options.quality : null,
        fits: true,
        message: null,
      };
    } catch (err) {
      // Our own messages and "cancel" go straight up. Anything else is most
      // likely "out of memory", so we try a smaller canvas.
      if (err instanceof ImageError || err?.name === 'AbortError') throw err;
    } finally {
      if (surface) releaseSurface(surface);
    }
  }
  throw new ImageError('This picture is too big for this device to convert.');
}

// "Under N KB": bigger sizes first, and quality searched at each size.
async function makeTargeted(bitmap, wanted, toExt, options, target, c) {
  if (!TARGET_FORMATS.includes(toExt)) throw new ImageError('Target size works with jpg, webp or avif output.');
  const maxBytes = kbToBytes(target.maxKB);
  const first = canvasSizeCandidates(wanted.width, wanted.height).find((s) => canvasWorks(s.width, s.height));
  if (!first) throw new ImageError('This picture is too big for this device to convert.');
  if (first.width !== wanted.width || first.height !== wanted.height) c.notes.push(reductionNote(wanted, first));

  const background = toExt === 'jpg' ? options.background : null;
  const scales = shrinkScales(first.width, first.height);
  let smallest = null;

  for (let i = 0; i < scales.length; i += 1) {
    c.check();
    const size = scales[i] === 1 ? first : scaleSize(first.width, first.height, scales[i]);
    c.onProgress(Math.min(0.9, 0.1 + 0.8 * (i / scales.length)), `Fitting under ${target.maxKB} KB`);
    let surface = null;
    try {
      surface = await renderTo(bitmap, bitmap.width, bitmap.height, size.width, size.height, background, c.check);
      const found = await bestQualityForTarget((q) => surfaceToBlob(surface, toExt, q), maxBytes, { signal: c.signal });
      const candidate = {
        blob: found.result,
        width: size.width,
        height: size.height,
        quality: Math.round(found.quality * 100),
        fits: found.fits,
      };
      if (found.fits) return finishTarget(candidate, target, first, c);
      if (!smallest || candidate.blob.size < smallest.blob.size) smallest = candidate;
    } finally {
      if (surface) releaseSurface(surface);
    }
  }
  // Impossible: give back the smallest we made, and say so honestly.
  return finishTarget(smallest, target, first, c);
}

function finishTarget(candidate, target, first, c) {
  const message = targetMessage({
    fits: candidate.fits,
    maxKB: target.maxKB,
    bytes: candidate.blob.size,
    width: candidate.width,
    height: candidate.height,
    fromWidth: first.width,
    fromHeight: first.height,
  });
  c.notes.push(message);
  return { ...candidate, message };
}

// Icons: one PNG per size inside one .ico file. The picture is centred in a
// square with see-through edges, so it is never stretched.
async function makeIco(bitmap, options, c) {
  const sizes = [...options.icoSizes].sort((a, b) => b - a);
  const biggest = sizes[0];
  if (Math.max(bitmap.width, bitmap.height) < biggest) {
    c.notes.push(`The picture is smaller than ${biggest} px, so the biggest icon sizes are enlarged and may look soft.`);
  }
  const fit = containSize(bitmap.width, bitmap.height, biggest);
  const scaled = await renderTo(bitmap, bitmap.width, bitmap.height, fit.width, fit.height, null, c.check);
  const square = makeSurface(biggest, biggest);
  square.getContext('2d').drawImage(
    scaled,
    Math.round((biggest - fit.width) / 2),
    Math.round((biggest - fit.height) / 2),
  );
  releaseSurface(scaled);

  const entries = [];
  try {
    for (const size of sizes) {
      c.check();
      c.onProgress(0.3 + 0.6 * (entries.length / sizes.length), `Making ${size}×${size} icon`);
      const surface = size === biggest ? square : await renderTo(square, biggest, biggest, size, size, null, c.check);
      const png = await surfaceToBlob(surface, 'png');
      entries.push({ size, data: new Uint8Array(await png.arrayBuffer()) });
      if (surface !== square) releaseSurface(surface);
    }
  } finally {
    releaseSurface(square);
  }
  entries.sort((a, b) => a.size - b.size); // small to big, the usual order
  const blob = new Blob([buildIco(entries)], { type: MIME.ico });
  return { blob, width: biggest, height: biggest, quality: null, fits: true, message: null };
}

// ---------- The one function the worker calls ----------

// source: a File/Blob to open, OR an ImageBitmap that is already open
//   (SVG and HEIC are opened on the page first). Either way this function
//   closes the bitmap when it is done.
// options: already checked by validateOptions.
// target: null, or { maxKB } for "under N KB".
export async function convertImage({ source, ext, toExt, options, target = null, onProgress = () => {}, signal }) {
  const notes = [];
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  let bitmap = null;
  try {
    onProgress(0.05, 'Opening picture');
    bitmap = isBlob(source) ? await decodeFile(source, ext) : source;
    check();
    const wanted = computeOutputSize(bitmap.width, bitmap.height, options.resize);
    const c = { notes, check, onProgress, signal };

    let result;
    if (toExt === 'ico') result = await makeIco(bitmap, options, c);
    else if (target) result = await makeTargeted(bitmap, wanted, toExt, options, target, c);
    else result = await makeSingle(bitmap, wanted, toExt, options, c);

    onProgress(1, 'Done');
    return {
      blob: result.blob,
      info: {
        width: result.width,
        height: result.height,
        bytes: result.blob.size,
        quality: result.quality,
        fits: result.fits,
        message: result.message,
        notes,
      },
    };
  } finally {
    bitmap?.close?.();
  }
}
