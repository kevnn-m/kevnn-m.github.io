import { getCollection } from 'astro:content';

// Project pages that should be built. Drafts show only on your computer.
export const getProjects = () =>
  getCollection('projects', (p) => import.meta.env.DEV || !p.data.draft);
