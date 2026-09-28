export function deploymentPolicy(eventName, ref, repository, event) {
  if (['push', 'workflow_dispatch'].includes(eventName) && ref === 'refs/heads/main')
    return 'production'
  if (
    eventName === 'pull_request' &&
    event.pull_request?.head?.repo?.full_name === repository &&
    event.pull_request?.base?.ref === 'main'
  )
    return 'preview'
  throw new Error('Contexte non autorisé: PR externe ou publication hors main')
}

export function assertCurrentRevision(policy, event, sha, current) {
  if (policy === 'production') {
    if (current.main !== sha) throw new Error('Révision main dépassée: relancer le dernier commit')
  } else if (
    current.state !== 'open' ||
    current.head !== event.pull_request.head.sha ||
    current.base !== event.pull_request.base.sha ||
    current.main !== event.pull_request.base.sha ||
    current.merge !== sha
  ) {
    throw new Error('PR dépassée ou base main modifiée: synchroniser et relancer la validation')
  }
}
