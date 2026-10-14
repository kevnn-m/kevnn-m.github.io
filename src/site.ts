// Site-wide settings. Edit these values; every page reads from here.

const EMAIL = 'kevin.guo.1@vanderbilt.edu';

export const SITE = {
  name: 'Kevin Guo',
  // Shown under your name in the hero and in link previews.
  role: 'Ph.D. Student, Biomedical Informatics',
  affiliation: 'Vanderbilt University',
  description:
    'Kevin Guo is a Ph.D. student at Vanderbilt University working on reliable AI systems for high-stakes settings.',
  email: EMAIL,

  // Buttons under the bio. Remove a line to hide that button.
  links: [
    { label: 'Email', href: `mailto:${EMAIL}`, icon: 'email' },
    { label: 'Scholar', href: 'https://scholar.google.com/citations?hl=en&user=3VM1a_oAAAAJ', icon: 'scholar' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/kevin-guo-644587236/', icon: 'linkedin' },
    { label: 'Substack', href: 'https://kevnnm.substack.com', icon: 'substack' },
    // { label: 'CV', href: '/files/curriculum_vitae.pdf', icon: 'cv' },
  ],

  // Used to put your name in bold in author lists.
  authorNames: ['Kevin H. Guo', 'Kevin H Guo', 'Kevin Guo'],

  // Google Analytics 4 ID. Set to '' to turn analytics off.
  googleAnalytics: 'G-JBHJLD3DXK',

  // Public visit counter (https://abacus.jasoncameron.dev).
  // Visits are only counted on the live site, never on localhost.
  counter: { namespace: 'kevnn-m-github-io', key: 'visits', liveHost: 'kevnn-m.github.io' },
} as const;

// `match` (optional): highlight the item on pages whose path starts with it.
export const NAV: { label: string; href: string; match?: string }[] = [
  { label: 'About', href: '/' },
  { label: 'Publications', href: '/#publications', match: '/publications/' },
  { label: 'Writing', href: '/writing/' },
  { label: 'Photography', href: '/photography/' },
  { label: 'Map', href: '/map/' },
  { label: 'Resources', href: '/resources/' },
];
