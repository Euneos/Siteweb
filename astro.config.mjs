import cloudflare from '@astrojs/cloudflare'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

const site = process.env.SITE_URL ?? 'https://euneos.fr'
const pagesHorsSitemap = ['/style-guide', '/etat-candidatures']

export default defineConfig({
  site,
  // Les pages publiques sont servies statiquement depuis le CDN.
  // Les endpoints et la page de suivi NocoDB sont rendus a la demande.
  output: 'static',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [sitemap({ filter: (page) => !pagesHorsSitemap.some((chemin) => page.includes(chemin)) })],
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: 'fr',
    locales: ['fr'],
    routing: { prefixDefaultLocale: false },
  },
})
