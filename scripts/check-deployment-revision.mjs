import { readFileSync } from 'node:fs'
import { deploymentPolicy, assertCurrentRevision } from './lib/deployment-policy.mjs'

// Run after acquiring the global deployment lock, and again before each remote
// stage. GitHub concurrency serializes runs, but does not promise FIFO order.
export async function checkDeploymentRevision() {
  const env = process.env
  if (env.GITHUB_ACTIONS !== 'true' || !env.GITHUB_TOKEN)
    throw new Error('Contexte GitHub CI requis')
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const policy = deploymentPolicy(
    env.GITHUB_EVENT_NAME,
    env.GITHUB_REF,
    env.GITHUB_REPOSITORY,
    event,
  )
  const get = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    })
    if (!response.ok) throw new Error('Impossible de vérifier la révision courante GitHub')
    return response.json()
  }
  const main = await get('git/ref/heads/main')
  const current = { main: main.object.sha }
  if (policy === 'preview') {
    const pr = await get(`pulls/${event.number}`)
    Object.assign(current, {
      state: pr.state,
      head: pr.head.sha,
      base: pr.base.sha,
      merge: pr.merge_commit_sha,
    })
  }
  assertCurrentRevision(policy, event, env.GITHUB_SHA, current)
  return policy
}
if (import.meta.main)
  checkDeploymentRevision()
    .then(() => console.log('Révision courante vérifiée.'))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
