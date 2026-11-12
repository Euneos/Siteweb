import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
const base = process.env.CHECK_BASE_URL || 'http://localhost:4321'
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local simulated submissions only')
const output = process.env.CHECK_SCREENSHOTS
if (output) await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.addInitScript(() => sessionStorage.setItem('euneos-study-dismissed', '1'))
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${base}/suivi/sondage-annee2`)
    const typography = await page.evaluate(() => {
      const size = element => parseFloat(getComputedStyle(element).fontSize)
      const question = size(document.querySelector('.survey-choices legend'))
      const proposal = size(document.querySelector('.survey-rank > span'))
      const note = size(document.querySelector('.survey-ranking-instructions'))
      return { sameQuestions: [...document.querySelectorAll('.survey-question-title')].every(element => size(element) === question), proposal, question, note }
    })
    if (!typography.sameQuestions || typography.proposal > typography.question || typography.proposal - typography.note < 2 * 96 / 72) throw new Error(`Typography mismatch at ${width}: ${JSON.stringify(typography)}`)
    for (const key of ['students', 'families', 'support']) {
      if (!await page.locator(`[name=${key}Other]`).isVisible()) throw new Error(`Missing visible Other field: ${key}`)
      await page.locator(`[name=${key}Other]`).fill('Proposition complémentaire')
      if (!await page.locator(`[name=${key}][value=Autre]`).isChecked()) throw new Error(`Other choice not selected: ${key}`)
    }
    await page.locator('[name=activitiesRank0]').selectOption('1')
    if (await page.locator('[name=activitiesRank1] option[value="1"]').count()) throw new Error('Used rank still offered')
    await page.locator('[name=activitiesRank0]').selectOption('3')
    if (!await page.locator('[name=activitiesRank1] option[value="1"]').count()) throw new Error('Released rank missing')
    if (await page.locator('[name=activitiesRank1] option[value="3"]').count()) throw new Error('New rank still offered')
    await page.locator('[name=activitiesRank0]').selectOption('1')
    if (!await page.locator('#priority-description').isVisible()) throw new Error('Priority examples missing')
    await page.locator('[name=activitiesRank6]').selectOption('2')
    await page.locator('[name=activitiesOther]').fill('Une rencontre entre établissements')
    await page.locator('[name=training][value="Oui."]').check()
    await page.locator('[name=trainingCount]').fill('2')
    await page.locator('[name=students][value=Autre]').check()
    await page.locator('[name=studentsOther]').fill('Journal des élèves')
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Overflow at ${width}`)
    if (output && [390, 1440].includes(width))
      await page.screenshot({ path: `${output}/sondage-${width}.png`, fullPage: true })
    await page.locator('[name=training][value="Non."]').check()
    if (await page.locator('[name=trainingCount]').isVisible())
      throw new Error('Conditional answer still visible')
    console.log(`✓ Sondage ${width}px, conditions et débordements`)
  }
  for (const [name, value] of Object.entries({
    school: 'Collège fictif',
    city: 'Ville test',
    name: 'Référente test',
    email: 'test@example.invalid',
  }))
    await page.locator(`#survey-form [name=${name}]`).fill(value)
  await page.locator('#survey-form button[type=submit]').click()
  await page.getByText('Simulation réussie : aucune réponse enregistrée.').waitFor()
  console.log('✓ Envoi simulé, sans stockage réel')
} finally {
  await browser.close()
}
