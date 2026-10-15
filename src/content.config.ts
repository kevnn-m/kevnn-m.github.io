// The shape of each content file in src/content/.
// If an entry is missing a required field, the build stops and names it.
import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { parse } from 'yaml';

// Keep entries in the order they are written in the file (Astro would
// otherwise sort them by id). Plain YAML parsing also keeps dates such as
// 2025-11-14 as text, so they show exactly as typed.
const inFileOrder = (text: string) =>
  (parse(text) as Record<string, unknown>[]).map((entry, i) => ({ ...entry, order: i }));
const yamlFile = (path: string) => file(path, { parser: inFileOrder });

const yearMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Use the format YYYY-MM');

const publications = defineCollection({
  loader: yamlFile('src/content/publications.yaml'),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      authors: z.array(z.string()).min(1),
      venue: z.string(),
      venueDetail: z.string().optional(),
      status: z.enum(['preprint', 'published']),
      date: yearMonth,
      tldr: z.string(),
      figure: image().optional(),
      figureAlt: z.string().optional(),
      figureCredit: z.string().optional(),
      note: z.string().optional(),
      selected: z.boolean().default(false),
      order: z.number(),
      links: z
        .object({
          paper: z.url(),
          pdf: z.url(),
          arxiv: z.url(),
          code: z.url(),
          poster: z.url(),
          project: z.url(),
        })
        .partial()
        .default({}),
    }),
});

const experience = defineCollection({
  loader: yamlFile('src/content/experience.yaml'),
  schema: z.object({
    title: z.string(),
    order: z.number(),
    items: z.array(
      z.object({
        what: z.string(),
        where: z.string().optional(),
        when: z.coerce.string().optional(),
        link: z.url().optional(),
      }),
    ),
  }),
});

const photoAlbum = (path: string) =>
  defineCollection({
    loader: yamlFile(path),
    schema: ({ image }) =>
      z.object({
        image: image().optional(),
        alt: z.string().optional(),
        caption: z.string().optional(),
        date: z.coerce.string().optional(),
        place: z.string().optional(),
        order: z.number(),
      }),
  });

const photos = photoAlbum('src/content/photos.yaml');
const cat = photoAlbum('src/content/cat.yaml');

const places = defineCollection({
  loader: yamlFile('src/content/places.yaml'),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      date: z.coerce.string().optional(),
      note: z.string().optional(),
      photo: image().optional(),
      order: z.number(),
    }),
});

const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      summary: z.string().optional(),
      cover: image().optional(),
      draft: z.boolean().default(false),
    }),
});

// Optional project page for a paper: src/content/projects/<paper id>.md
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    draft: z.boolean().default(false),
  }),
});

export const collections = { publications, projects, experience, photos, cat, places, writing };
