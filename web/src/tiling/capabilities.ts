export type SourceOverlayKind = 'none' | 'penrose-robinson' | 'ammann-beenker-truchet';
export type SurfaceOrnamentKind = 'generic-tile-local' | 'd4-substitution';
export type SourceOverlayColorMode = 'semantic-user-tinted';
export type PenroseCompositionEdgeRule = 'none' | 'base-base' | 'leg-leg';

export function sourceOverlayKindForFamily(family: number): SourceOverlayKind {
  if (family === 0 || family === 1) return 'penrose-robinson';
  if (family === 5) return 'ammann-beenker-truchet';
  return 'none';
}

export function familySupportsSourceOverlay(family: number): boolean {
  return sourceOverlayKindForFamily(family) !== 'none';
}

export function sourceOverlayActiveForStyle(family: number, style: number): boolean {
  return familySupportsSourceOverlay(family) && style >= 3.5;
}

export function sourceOverlayColorModeForFamily(family: number): SourceOverlayColorMode | null {
  return familySupportsSourceOverlay(family) ? 'semantic-user-tinted' : null;
}

export function familySupportsWieringaRoof(family: number): boolean {
  return family === 0;
}

export function penroseCompositionEdgeRuleForFamily(family: number): PenroseCompositionEdgeRule {
  if (family === 0) return 'base-base';
  if (family === 1) return 'leg-leg';
  return 'none';
}

export function familyUsesD4TruchetLaw(family: number): boolean {
  return family === 18;
}

export function surfaceOrnamentKindForFamily(family: number): SurfaceOrnamentKind {
  return familyUsesD4TruchetLaw(family) ? 'd4-substitution' : 'generic-tile-local';
}

export function familySupportsSurfaceOrnament(family: number): boolean {
  return family >= 0;
}
