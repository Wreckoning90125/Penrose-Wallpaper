export type SeedOption = {
  value: string;
  label: string;
};

export type FamilyOption = {
  value: string;
  label: string;
  maxGeneration: number;
  seeds: SeedOption[];
  showOrientMode?: boolean;
};

const FAMILY_OPTIONS_BY_ID: Record<string, FamilyOption> = {
  '0': {
    value: '0',
    label: 'P3 rhombi',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Sun' },
      { value: '1', label: 'Star' },
      { value: '2', label: 'Cartwheel' },
      { value: '3', label: 'Ace' },
    ],
  },
  '1': {
    value: '1',
    label: 'P2 kites and darts',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Sun' },
      { value: '1', label: 'Star' },
    ],
  },
  '2': {
    value: '2',
    label: 'Chair L-trominoes',
    maxGeneration: 7,
    // Chair "orient" is exactly the same bucket as Type, so hide the duplicate
    // UI mode for now. Keep this as an explicit per-family switch; other families
    // need review before deciding whether their edge-direction mode is valid.
    showOrientMode: false,
    seeds: [
      { value: '0', label: 'Pinwheel' },
      { value: '1', label: 'Small' },
      { value: '2', label: 'Large' },
    ],
  },
  '3': {
    value: '3',
    label: 'Dodecagonal',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Rosette' },
      { value: '1', label: 'Drift' },
      { value: '2', label: 'Quasi' },
    ],
  },
  '4': {
    value: '4',
    label: 'Pinwheel right triangles',
    maxGeneration: 6,
    seeds: [
      { value: '0', label: 'Square' },
      { value: '1', label: 'Triangle' },
      { value: '2', label: 'Rectangle' },
    ],
  },
  '5': {
    value: '5',
    label: 'Ammann-Beenker',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Star' },
      { value: '1', label: 'Drift' },
      { value: '2', label: 'Quasi' },
    ],
  },
  '6': {
    value: '6',
    label: 'Heptagonal',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Star' },
      { value: '1', label: 'Drift' },
      { value: '2', label: 'Quasi' },
    ],
  },
  '7': {
    value: '7',
    label: 'Binary Godreche-Lancon',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Bear' },
      { value: '1', label: 'Dog' },
    ],
  },
  '8': {
    value: '8',
    label: 'Tuebingen triangle',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Sun' },
      { value: '1', label: 'Triangle' },
    ],
  },
  '9': {
    value: '9',
    label: 'P1 pentagon-star-boat',
    maxGeneration: 7,
    seeds: [{ value: '0', label: 'Sun' }],
  },
  '10': {
    value: '10',
    label: 'Danzer triangle',
    maxGeneration: 7,
    seeds: [
      { value: '0', label: 'Sun' },
      { value: '1', label: 'Triangle' },
    ],
  },
  '11': {
    value: '11',
    label: 'Hat monotile',
    maxGeneration: 5,
    seeds: [
      { value: '0', label: 'H metatile' },
      { value: '1', label: 'T metatile' },
      { value: '2', label: 'P metatile' },
      { value: '3', label: 'F metatile' },
    ],
  },
  '12': {
    value: '12',
    label: 'Spectre monotile',
    maxGeneration: 5,
    seeds: [
      { value: '0', label: 'Gamma' },
      { value: '1', label: 'Delta' },
      { value: '2', label: 'Theta' },
      { value: '3', label: 'Lambda' },
      { value: '4', label: 'Xi' },
      { value: '5', label: 'Pi' },
      { value: '6', label: 'Sigma' },
      { value: '7', label: 'Phi' },
      { value: '8', label: 'Psi' },
    ],
  },
  '13': {
    value: '13',
    label: 'Equithirds',
    maxGeneration: 10,
    seeds: [
      { value: '0', label: 'Equilateral' },
      { value: '1', label: 'Wide' },
    ],
  },
  '14': {
    value: '14',
    label: 'Cromwell KRT',
    maxGeneration: 5,
    seeds: [
      { value: '0', label: 'Kite' },
      { value: '1', label: 'Rhombus' },
      { value: '2', label: 'Trapezium' },
      { value: '3', label: 'Star' },
    ],
  },
  '15': {
    value: '15',
    label: 'Gailiunas spirals',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: '{3,6,3}' },
      { value: '1', label: '{3,9,4}' },
      { value: '2', label: '{3,12,5}' },
      { value: '3', label: '{3,15,6}' },
      { value: '4', label: '{3,18,7}' },
      { value: '5', label: '{3,21,8}' },
      { value: '6', label: '{3,24,9}' },
      { value: '7', label: '{3,27,10}' },
      { value: '8', label: '{3,30,11}' },
      { value: '9', label: '{3,33,12}' },
      { value: '10', label: '{3,36,13}' },
      { value: '11', label: '{4,8,3}' },
      { value: '12', label: '{4,12,4}' },
      { value: '13', label: '{4,16,5}' },
      { value: '14', label: '{4,20,6}' },
      { value: '15', label: '{4,24,7}' },
      { value: '16', label: '{4,28,8}' },
      { value: '17', label: '{4,32,9}' },
      { value: '18', label: '{4,36,10}' },
      { value: '19', label: '{5,10,3}' },
      { value: '20', label: '{5,15,4}' },
      { value: '21', label: '{5,20,5}' },
      { value: '22', label: '{5,25,6}' },
      { value: '23', label: '{5,30,7}' },
      { value: '24', label: '{5,35,8}' },
      { value: '25', label: '{6,12,3}' },
      { value: '26', label: '{6,18,4}' },
      { value: '27', label: '{6,24,5}' },
      { value: '28', label: '{6,30,6}' },
      { value: '29', label: '{6,36,7}' },
      { value: '30', label: '{7,14,3}' },
      { value: '31', label: '{7,21,4}' },
      { value: '32', label: '{7,28,5}' },
      { value: '33', label: '{7,35,6}' },
      { value: '34', label: '{8,16,3}' },
      { value: '35', label: '{8,24,4}' },
      { value: '36', label: '{8,32,5}' },
      { value: '37', label: '{9,18,3}' },
      { value: '38', label: '{9,27,4}' },
      { value: '39', label: '{9,36,5}' },
      { value: '40', label: '{10,20,3}' },
      { value: '41', label: '{10,30,4}' },
      { value: '42', label: '{11,22,3}' },
      { value: '43', label: '{11,33,4}' },
      { value: '44', label: '{12,24,3}' },
      { value: '45', label: '{12,36,4}' },
      { value: '46', label: '{13,26,3}' },
      { value: '47', label: '{14,28,3}' },
      { value: '48', label: '{15,30,3}' },
      { value: '49', label: '{16,32,3}' },
      { value: '50', label: '{17,34,3}' },
      { value: '51', label: '{18,36,3}' },
    ],
  },
  '16': {
    value: '16',
    label: 'Cairo pentagons',
    maxGeneration: 8,
    seeds: [{ value: '0', label: 'Standard' }],
  },
  '17': {
    value: '17',
    label: 'Socolar-Taylor half-hexes',
    maxGeneration: 7,
    seeds: [
      { value: '0', label: 'Generating triad' },
      { value: '1', label: 'A hex supertile' },
    ],
  },
};

const FAMILY_DISPLAY_ORDER = [
  '9', '1', '0',       // Penrose systems: P1 / P2 / P3.
  '8', '10', '13', '14', // Triangle / Robinson-graph substitutions.
  '6', '5', '3', '7',  // Rotational/quasicrystal families.
  '4', '2', '16', '17', // Other compact tiling families.
  '15',                // Spiral constructions.
  '11', '12',          // Monotiles/metatiles.
] as const;

export const FAMILIES: FamilyOption[] = FAMILY_DISPLAY_ORDER.map(value => FAMILY_OPTIONS_BY_ID[value]!);

const FAMILY_BY_VALUE = new Map(Object.entries(FAMILY_OPTIONS_BY_ID));

export function familyByValue(value: string | number | boolean): FamilyOption {
  return FAMILY_BY_VALUE.get(String(value)) ?? FAMILIES[0]!;
}

export function seedOptionsForFamily(value: string | number | boolean): SeedOption[] {
  return familyByValue(value).seeds;
}

export function maxGenerationForFamily(value: string | number | boolean): number {
  return familyByValue(value).maxGeneration;
}

export function seedLabel(familyValue: string | number | boolean, seedValue: string | number | boolean): string {
  const seed = seedOptionsForFamily(familyValue).find(item => item.value === String(seedValue));
  return seed?.label ?? `Seed ${seedValue}`;
}
