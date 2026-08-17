import cloudflare from '@astrojs/cloudflare'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const site = process.env.SITE_URL ?? 'https://euneos.fr'

export default defineConfig({
  site,
  // Les 4 pages sont du contenu pur -> servies statiquement depuis le CDN.
  // Les endpoints de formulaire sont marques `prerender = false` (rendu a la demande).
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: 'fr',
    locales: ['fr'],
    routing: { prefixDefaultLocale: false },
  },
})
