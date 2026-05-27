export const FAMILIES = [
  {
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
  {
    value: '1',
    label: 'P2 kites and darts',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Sun' },
      { value: '1', label: 'Star' },
    ],
  },
  {
    value: '9',
    label: 'P1 pentagon-star-boat',
    maxGeneration: 7,
    seeds: [{ value: '0', label: 'Sun' }],
  },
  {
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
  {
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
  {
    value: '8',
    label: 'Tuebingen triangle',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Sun' },
      { value: '1', label: 'Triangle' },
    ],
  },
  {
    value: '7',
    label: 'Binary Godreche-Lancon',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Bear' },
      { value: '1', label: 'Dog' },
    ],
  },
  {
    value: '5',
    label: 'Ammann-Beenker',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Star' },
      { value: '1', label: 'Drift' },
      { value: '2', label: 'Quasi' },
    ],
  },
  {
    value: '3',
    label: 'Dodecagonal',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Rosette' },
      { value: '1', label: 'Drift' },
      { value: '2', label: 'Quasi' },
    ],
  },
  {
    value: '6',
    label: 'Heptagonal',
    maxGeneration: 8,
    seeds: [
      { value: '0', label: 'Star' },
      { value: '1', label: 'Drift' },
      { value: '2', label: 'Quasi' },
    ],
  },
  {
    value: '10',
    label: 'Danzer triangle',
    maxGeneration: 7,
    seeds: [
      { value: '0', label: 'Sun' },
      { value: '1', label: 'Triangle' },
    ],
  },
  {
    value: '4',
    label: 'Pinwheel right triangles',
    maxGeneration: 6,
    seeds: [
      { value: '0', label: 'Square' },
      { value: '1', label: 'Triangle' },
      { value: '2', label: 'Rectangle' },
    ],
  },
  {
    value: '2',
    label: 'Chair L-trominoes',
    maxGeneration: 7,
    seeds: [
      { value: '0', label: 'Pinwheel' },
      { value: '1', label: 'Small' },
      { value: '2', label: 'Large' },
    ],
  },
];

const FAMILY_BY_VALUE = new Map(FAMILIES.map(family => [family.value, family]));

export function familyByValue(value) {
  return FAMILY_BY_VALUE.get(String(value)) ?? FAMILIES[0];
}

export function seedOptionsForFamily(value) {
  return familyByValue(value).seeds;
}

export function maxGenerationForFamily(value) {
  return familyByValue(value).maxGeneration;
}

export function seedLabel(familyValue, seedValue) {
  const seed = seedOptionsForFamily(familyValue).find(item => item.value === String(seedValue));
  return seed?.label ?? `Seed ${seedValue}`;
}
