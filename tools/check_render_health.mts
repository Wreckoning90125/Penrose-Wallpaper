import {
  CenterHealthTracker,
  RENDER_BORKED_MESSAGE,
  RENDER_OCCLUDED_MESSAGE,
  centerPixelIsBlack,
  centerPointIsOccluded,
} from '../web/src/render/renderHealth.ts';

const blackPixel = { alpha: 255, blue: 0, green: 0, red: 0 };
const dimPixel = { alpha: 255, blue: 4, green: 0, red: 0 };
const clearPixel = { alpha: 0, blue: 0, green: 0, red: 0 };

if (!centerPixelIsBlack(blackPixel)) {
  throw new Error('center black probe did not trip on black');
}

if (centerPixelIsBlack(dimPixel)) {
  throw new Error('center black probe tripped on visible color');
}

if (centerPixelIsBlack(clearPixel)) {
  throw new Error('center black probe tripped on clear pixel');
}

if (!RENDER_BORKED_MESSAGE.includes('render is borked')) {
  throw new Error('render health message missing regression text');
}

if (!centerPointIsOccluded(false, false)) {
  throw new Error('center occlusion probe did not trip when canvas is covered');
}

if (centerPointIsOccluded(true, false)) {
  throw new Error('center occlusion probe tripped on exposed canvas');
}

if (!centerPointIsOccluded(true, true)) {
  throw new Error('forced center occlusion probe did not trip');
}

const tracker = new CenterHealthTracker();
if (tracker.sample(blackPixel, false, true, false) !== null) {
  throw new Error('render health warning fired before the debounce frame');
}
const blackReport = tracker.sample(blackPixel, false, true, false);
if (blackReport?.message !== RENDER_BORKED_MESSAGE) {
  throw new Error('render health warning did not fire on repeated black center');
}
if (tracker.sample(blackPixel, false, true, false) !== null) {
  throw new Error('render health warning repeated without a visible reset');
}
if (tracker.sample(dimPixel, false, true, false) !== null) {
  throw new Error('render health warning fired on visible reset');
}
const forcedReport = tracker.sample(dimPixel, true, true, false);
if (forcedReport !== null) {
  throw new Error('forced render health probe fired before the debounce frame');
}
const forcedRepeatReport = tracker.sample(dimPixel, true, true, false);
if (forcedRepeatReport?.message !== RENDER_BORKED_MESSAGE) {
  throw new Error('forced render health probe did not fire');
}

const occlusionTracker = new CenterHealthTracker();
if (occlusionTracker.sample(dimPixel, false, false, false) !== null) {
  throw new Error('occlusion health warning fired before the debounce frame');
}
const occlusionReport = occlusionTracker.sample(dimPixel, false, false, false);
if (occlusionReport?.message !== RENDER_OCCLUDED_MESSAGE) {
  throw new Error('occlusion health warning did not fire on repeated covered center');
}

console.log('render health ok');
