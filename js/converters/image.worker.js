// image.worker.js - runs the heavy drawing and saving off the main thread,
// so the page never freezes. One worker per job: cancelling is just
// worker.terminate(), which stops work at once.

import { convertImage } from './image-engine.js';

self.onmessage = async (event) => {
  try {
    const { blob, info } = await convertImage({
      ...event.data,
      onProgress: (value, text) => self.postMessage({ type: 'progress', value, text }),
    });
    self.postMessage({ type: 'done', blob, info });
  } catch (err) {
    self.postMessage({
      type: 'error',
      code: err?.code ?? 'internal',
      message: err?.message || 'Something went wrong while converting.',
    });
  }
};
