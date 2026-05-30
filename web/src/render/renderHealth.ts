export type CenterPixel = {
  alpha: number;
  blue: number;
  green: number;
  red: number;
};

export type CenterHealthReport = {
  message: string;
  pixel: CenterPixel;
  reason: CenterHealthReason;
};

export const RENDER_BORKED_MESSAGE = '[render-health] render is borked: center pixel is black';
export const RENDER_OCCLUDED_MESSAGE = '[render-health] render is borked: center tile is occluded';
export type CenterHealthReason = 'black-pixel' | 'occluded';

export function centerPixelIsBlack(pixel: CenterPixel): boolean {
  return pixel.alpha > 0 && Math.max(pixel.red, pixel.green, pixel.blue) <= 3;
}

export function centerPointIsOccluded(topElementIsCanvas: boolean, forced: boolean): boolean {
  return forced || !topElementIsCanvas;
}

export class CenterHealthTracker {
  blackFrames = 0;
  occludedFrames = 0;
  warned = false;

  sample(
    pixel: CenterPixel,
    forcedBlack: boolean,
    topElementIsCanvas: boolean,
    forcedOccluded: boolean,
  ): CenterHealthReport | null {
    const blackCenter = forcedBlack || centerPixelIsBlack(pixel);
    const occludedCenter = centerPointIsOccluded(topElementIsCanvas, forcedOccluded);
    if (!blackCenter && !occludedCenter) {
      this.blackFrames = 0;
      this.occludedFrames = 0;
      this.warned = false;
      return null;
    }

    if (blackCenter) {
      this.blackFrames += 1;
    } else {
      this.blackFrames = 0;
    }
    if (occludedCenter) {
      this.occludedFrames += 1;
    } else {
      this.occludedFrames = 0;
    }

    const reason: CenterHealthReason | null =
      this.occludedFrames >= 2 ? 'occluded' : this.blackFrames >= 2 ? 'black-pixel' : null;
    if (!reason || this.warned) return null;

    this.warned = true;
    return {
      message: reason === 'occluded' ? RENDER_OCCLUDED_MESSAGE : RENDER_BORKED_MESSAGE,
      pixel,
      reason,
    };
  }
}
