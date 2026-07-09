// Shared lucide icon resolution for FX nodes. The catalog (`postFxCatalog.ts`)
// stores each effect's icon as a string name; this maps that name to its lucide
// component so BOTH the Add menu and the in-graph FX node title render the same
// icon from one source of truth. Three-free (no renderer import).
import {
  Aperture,
  Box,
  CircleDot,
  Coffee,
  Columns3,
  Contrast,
  Film,
  Focus,
  Grid2x2,
  Haze,
  History,
  Layers,
  Map as MapIcon,
  PenLine,
  Repeat,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Sun,
  Zap,
} from 'lucide-react';

export const FX_ICONS: Record<string, typeof Box> = {
  Grid2x2,
  Layers,
  Film,
  Columns3,
  PenLine,
  History,
  Sparkles,
  Contrast,
  CircleDot,
  Aperture,
  Coffee,
  Sun,
  SlidersHorizontal,
  Focus,
  Haze,
  Zap,
  Spline,
  Repeat,
  Map: MapIcon,
};

// Resolve a catalog icon name to its lucide component, falling back to a neutral
// box so an unknown/typo'd name renders something rather than crashing.
export function fxIconComponent(name: string): typeof Box {
  return FX_ICONS[name] ?? Box;
}
