/**
 * Seed a practical T2D-focused drug catalog for autocomplete.
 * Full RxTerms monthly import: npm run catalog:import -- path/to/RxTerms.csv
 */
import '../src/loadEnv.js';
import { replaceCatalog } from '../src/services/catalog.js';
import { prisma } from '../src/db.js';

const SEED = [
  {
    displayName: 'Metformin (Oral-pill)',
    synonyms: ['Glucophage', 'Glumetza'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '500 mg', form: 'tablet', rxcui: '861004' },
      { strength: '850 mg', form: 'tablet', rxcui: '861007' },
      { strength: '1000 mg', form: 'tablet', rxcui: '861010' },
    ],
  },
  {
    displayName: 'Glipizide (Oral-pill)',
    synonyms: ['Glucotrol'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '5 mg', form: 'tablet', rxcui: '310490' },
      { strength: '10 mg', form: 'tablet', rxcui: '310489' },
    ],
  },
  {
    displayName: 'Sitagliptin (Oral-pill)',
    synonyms: ['Januvia'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '25 mg', form: 'tablet', rxcui: '665033' },
      { strength: '50 mg', form: 'tablet', rxcui: '665038' },
      { strength: '100 mg', form: 'tablet', rxcui: '665041' },
    ],
  },
  {
    displayName: 'Empagliflozin (Oral-pill)',
    synonyms: ['Jardiance'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '10 mg', form: 'tablet', rxcui: '1545653' },
      { strength: '25 mg', form: 'tablet', rxcui: '1545658' },
    ],
  },
  {
    displayName: 'Dapagliflozin (Oral-pill)',
    synonyms: ['Farxiga'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '5 mg', form: 'tablet', rxcui: '1488564' },
      { strength: '10 mg', form: 'tablet', rxcui: '1488569' },
    ],
  },
  {
    displayName: 'Semaglutide (Injectable)',
    synonyms: ['Ozempic', 'Wegovy'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '0.25 mg/dose', form: 'pen', rxcui: '1991306' },
      { strength: '0.5 mg/dose', form: 'pen', rxcui: '1991311' },
      { strength: '1 mg/dose', form: 'pen', rxcui: '1991316' },
      { strength: '2 mg/dose', form: 'pen', rxcui: '2557507' },
    ],
  },
  {
    displayName: 'Semaglutide (Oral-pill)',
    synonyms: ['Rybelsus'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '3 mg', form: 'tablet', rxcui: '2557500' },
      { strength: '7 mg', form: 'tablet', rxcui: '2557501' },
      { strength: '14 mg', form: 'tablet', rxcui: '2557502' },
    ],
  },
  {
    displayName: 'Tirzepatide (Injectable)',
    synonyms: ['Mounjaro', 'Zepbound'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '2.5 mg/dose', form: 'pen', rxcui: '2601723' },
      { strength: '5 mg/dose', form: 'pen', rxcui: '2601730' },
      { strength: '7.5 mg/dose', form: 'pen', rxcui: '2601737' },
      { strength: '10 mg/dose', form: 'pen', rxcui: '2601744' },
      { strength: '12.5 mg/dose', form: 'pen', rxcui: '2601751' },
      { strength: '15 mg/dose', form: 'pen', rxcui: '2601758' },
    ],
  },
  {
    displayName: 'Dulaglutide (Injectable)',
    synonyms: ['Trulicity'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '0.75 mg/dose', form: 'pen', rxcui: '1551300' },
      { strength: '1.5 mg/dose', form: 'pen', rxcui: '1551306' },
      { strength: '3 mg/dose', form: 'pen', rxcui: '2268125' },
      { strength: '4.5 mg/dose', form: 'pen', rxcui: '2268131' },
    ],
  },
  {
    displayName: 'Empagliflozin / Metformin (Oral-pill)',
    synonyms: ['Synjardy', 'Synjardy XR', 'Syndardy'],
    isBrand: false,
    genericDisplayName: 'empagliflozin / metformin',
    strengthsAndForms: [
      { strength: '5 mg / 500 mg', form: 'tablet', rxcui: '1665356' },
      { strength: '5 mg / 1000 mg', form: 'tablet', rxcui: '1665362' },
      { strength: '12.5 mg / 500 mg', form: 'tablet', rxcui: '1665365' },
      { strength: '12.5 mg / 1000 mg', form: 'tablet', rxcui: '1665369' },
    ],
  },
  {
    displayName: 'Canagliflozin (Oral-pill)',
    synonyms: ['Invokana'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '100 mg', form: 'tablet', rxcui: '1373458' },
      { strength: '300 mg', form: 'tablet', rxcui: '1373464' },
    ],
  },
  {
    displayName: 'Insulin Glargine (Injectable)',
    synonyms: ['Lantus', 'Basaglar', 'Toujeo'],
    isBrand: false,
    strengthsAndForms: [{ strength: '100 unit/mL', form: 'pen', rxcui: '311040' }],
  },
  {
    displayName: 'Insulin Lispro (Injectable)',
    synonyms: ['Humalog', 'Admelog'],
    isBrand: false,
    strengthsAndForms: [{ strength: '100 unit/mL', form: 'pen', rxcui: '311040' }],
  },
  {
    displayName: 'Liraglutide (Injectable)',
    synonyms: ['Victoza', 'Saxenda'],
    isBrand: false,
    strengthsAndForms: [{ strength: '6 mg/mL', form: 'pen', rxcui: '897122' }],
  },
  {
    displayName: 'Hydrochlorothiazide (Oral-pill)',
    synonyms: ['HCTZ', 'Microzide'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '12.5 mg', form: 'tablet', rxcui: '310798' },
      { strength: '25 mg', form: 'tablet', rxcui: '310809' },
    ],
  },
  {
    displayName: 'Lisinopril (Oral-pill)',
    synonyms: ['Prinivil', 'Zestril'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '5 mg', form: 'tablet', rxcui: '314076' },
      { strength: '10 mg', form: 'tablet', rxcui: '314077' },
      { strength: '20 mg', form: 'tablet', rxcui: '314078' },
    ],
  },
  {
    displayName: 'Losartan (Oral-pill)',
    synonyms: ['Cozaar'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '25 mg', form: 'tablet', rxcui: '979492' },
      { strength: '50 mg', form: 'tablet', rxcui: '979485' },
      { strength: '100 mg', form: 'tablet', rxcui: '979480' },
    ],
  },
  {
    displayName: 'Amlodipine (Oral-pill)',
    synonyms: ['Norvasc'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '2.5 mg', form: 'tablet', rxcui: '197361' },
      { strength: '5 mg', form: 'tablet', rxcui: '197362' },
      { strength: '10 mg', form: 'tablet', rxcui: '197363' },
    ],
  },
  {
    displayName: 'Atorvastatin (Oral-pill)',
    synonyms: ['Lipitor'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '10 mg', form: 'tablet', rxcui: '617312' },
      { strength: '20 mg', form: 'tablet', rxcui: '617318' },
      { strength: '40 mg', form: 'tablet', rxcui: '617310' },
      { strength: '80 mg', form: 'tablet', rxcui: '617311' },
    ],
  },
  {
    displayName: 'Rosuvastatin (Oral-pill)',
    synonyms: ['Crestor'],
    isBrand: false,
    strengthsAndForms: [
      { strength: '5 mg', form: 'tablet', rxcui: '859419' },
      { strength: '10 mg', form: 'tablet', rxcui: '859421' },
      { strength: '20 mg', form: 'tablet', rxcui: '859423' },
      { strength: '40 mg', form: 'tablet', rxcui: '859420' },
    ],
  },
];

const result = await replaceCatalog(
  SEED.map((e) => ({ ...e, sourceVersion: 'seed-t2d-v2' })),
  'seed-t2d-v2',
);
console.log(`Seeded ${result.count} catalog entries (${result.sourceVersion})`);
await prisma.$disconnect();
