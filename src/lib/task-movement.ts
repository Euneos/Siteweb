import type { TeamTask, TaskInput } from './team-tasks'

/** A contributor card keeps its role when dragged; only the owner card reassigns ownership. */
export function moveTask(
  task: TeamTask,
  sourcePerson: string,
  targetPerson: string,
  status: string,
): TaskInput {
  const next: TaskInput = {
    title: task.title,
    description: task.description,
    person: task.person,
    contributors: [...task.contributors],
    status,
    priority: task.priority,
    due_on: task.due_on,
    blocked: task.blocked,
    blocker: task.blocker,
    archived: status === 'terminee' ? task.archived : false,
  }
  if (sourcePerson === targetPerson) return next
  if (sourcePerson === task.person) {
    next.person = targetPerson
    next.contributors = next.contributors.filter((person) => person !== targetPerson)
  } else {
    if (!task.contributors.includes(sourcePerson))
      throw new Error('Cette personne ne contribue plus à la tâche. Actualisez le tableau.')
    if (targetPerson === task.person || task.contributors.includes(targetPerson))
      throw new Error(
        'Cette personne participe déjà à la tâche. Modifiez les rôles en ouvrant la fiche.',
      )
    next.contributors = next.contributors.map((person) =>
      person === sourcePerson ? targetPerson : person,
    )
  }
  return next
}
