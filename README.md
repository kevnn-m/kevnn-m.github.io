# kevnn-m.github.io

Personal site of Kevin Guo, built with [Astro](https://astro.build).

## Run it on your computer

Needs Node.js 22.12 or newer (`node --version`). If you don't have it,
install the LTS version from https://nodejs.org (or `brew install node` on a
Mac). If you use nvm, `nvm use` reads the version from `.nvmrc`.

Then, in the repo folder:

```sh
npm install      # once, and after package.json changes
npm run dev      # opens a live preview at http://localhost:4321
npm run build    # builds the final site into dist/ (CI does this too)
```

## Where things are

All the content you edit is in `src/content/`:

| To change... | Edit |
|---|---|
| Hero bio | `src/content/about.md` |
| Research section | `src/content/research.md` |
| News | `src/content/news.md` |
| Papers | `src/content/publications.yaml` (figures go in `src/content/pubs/`) |
| A paper's project page | `src/content/projects/<paper id>.md` |
| Experience | `src/content/experience.yaml` |
| Photos | `src/content/photos.yaml` (images go in `src/content/photos/`) |
| Map pins | `src/content/places.yaml` |
| Blog posts | `src/content/writing/<post>.md` |
| Resources page | `src/content/resources.md` |
| Name, links, analytics, counter | `src/site.ts` |
| Colors and fonts | `src/styles/tokens.css` |

Each data file has comments at the top that explain its fields. If a field is
wrong or missing, `npm run build` stops and names the file and the field.

### Add a paper

Copy an entry in `publications.yaml`, change it, and put the figure in
`src/content/pubs/`. Set `selected: true` to show it in the "Selected" tab.

### Add a project page for a paper

Make `src/content/projects/<paper id>.md`. The title, authors, figure, and
links come from `publications.yaml`, so the file only needs the extra text.
The card then gets a "Project page" button. See `stop-listening.md` for an
example. Files with `draft: true` show only in `npm run dev`.

### Add a blog post

Make `src/content/writing/<name>.md` with a `title` and `date` at the top.
See `example-post.md`. Posts with `draft: true` show only in `npm run dev`.

## Home-page scene (banner)

A painted landscape drawn in code, with an illustration on top:

| Part | File |
|---|---|
| Colors (day and night) | `src/scene/palette.ts` |
| Sky, clouds, moon, stars | `src/scene/sky.ts` |
| Hills (shapes, bushes) | `src/scene/hills.ts` |
| Grass in the wind (WebGL) | `src/scene/grass.ts`, wind in `src/scene/wind.ts` |
| Flying papers, fireflies | `src/scene/flyers.ts` |
| The illustration (me, cat, book, papers, camera) | `src/scene/art/vignette.svg` |
| Hover labels, idle motion, the cat | `src/scene/vignette.ts` |
| Layout, parallax, animation loop | `src/scene/scene.ts` |
| Markup and styles | `src/components/HomeScene.astro` |

The links in the illustration are `<a>` elements inside the SVG; change their
`href` there. The cat opens the album at `/cat/` (photos in
`src/content/cat.yaml`). Set your cat's name in `src/site.ts` (`catName`).

## Deploy

Every push to `main` builds and deploys the site with GitHub Actions
(`.github/workflows/deploy.yml`). Pushes to other branches only build, as a
check. One-time setup: repo **Settings → Pages → Source → GitHub Actions**.
