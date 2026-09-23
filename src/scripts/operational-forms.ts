const form = document.querySelector<HTMLFormElement>('#operational-form')
if (form) {
  const feedback = document.querySelector<HTMLElement>('#operational-feedback')!
  const people = document.querySelector<HTMLElement>('#of-participants')
  const addPerson = document.querySelector<HTMLButtonElement>('#of-add-person')
  const count = document.querySelector<HTMLElement>('#of-participants-count')
  const trainers = document.querySelector<HTMLElement>('#of-trainers')
  const addTrainer = document.querySelector<HTMLButtonElement>('#of-add-trainer')
  const trainerCount = document.querySelector<HTMLElement>('#of-trainers-count')
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!
  let pending = false,
    terminal = false,
    nextPerson = 0,
    nextTrainer = 0
  const controls = () =>
    Array.from(
      form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
      >('input,select,textarea,button'),
    )
  const fields = [
    { key: 'firstName', label: 'Prénom', type: 'text', required: true, max: 150 },
    { key: 'lastName', label: 'Nom', type: 'text', required: true, max: 150 },
    { key: 'email', label: 'E-mail', type: 'email', required: false, max: 254 },
    {
      key: 'role',
      label: 'Fonction dans l’établissement',
      type: 'text',
      required: false,
      max: 250,
    },
  ]
  function updatePeople() {
    if (!people || !count || !addPerson) return
    const rows = [...people.querySelectorAll<HTMLElement>('[data-person]')]
    rows.forEach((row, i) => {
      row.querySelector('h3')!.textContent = `Adulte ${i + 1}`
      const remove = row.querySelector<HTMLButtonElement>('[data-remove]')!
      remove.setAttribute('aria-label', `Retirer l’adulte ${i + 1}`)
      remove.disabled = pending || (form!.dataset.kind === 'participants' && rows.length === 1)
    })
    count.textContent = `${rows.length} adulte(s) à transmettre.`
    addPerson.disabled = pending || rows.length >= 200
  }
  function newPerson(focus = false) {
    if (!people || pending || terminal || people.children.length >= 200) return
    const id = ++nextPerson
    const row = document.createElement('section')
    row.className = 'of-person'
    row.dataset.person = String(id)
    const heading = document.createElement('h3')
    heading.id = `of-person-${id}`
    row.setAttribute('aria-labelledby', heading.id)
    const grid = document.createElement('div')
    grid.className = 'of-grid'
    for (const field of fields) {
      const label = document.createElement('label')
      label.className = 'of-field'
      const text = document.createElement('span')
      text.textContent = `${field.label}${field.required ? ' *' : ' (facultatif)'}`
      const input = document.createElement('input')
      input.name = `person-${id}-${field.key}`
      input.dataset.personField = field.key
      input.type = field.type
      input.required = field.required
      input.maxLength = field.max
      input.autocomplete = 'off'
      label.append(text, input)
      grid.append(label)
    }
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'of-person-remove'
    remove.dataset.remove = ''
    remove.textContent = 'Retirer cet adulte'
    remove.addEventListener('click', () => {
      if (
        pending ||
        terminal ||
        (form!.dataset.kind === 'participants' && people.children.length <= 1)
      )
        return
      row.remove()
      updatePeople()
      addPerson?.focus({ preventScroll: true })
    })
    row.append(heading, grid, remove)
    people.append(row)
    updatePeople()
    if (focus) row.querySelector<HTMLInputElement>('input')?.focus()
  }
  if (people && form.dataset.kind === 'participants') newPerson()
  else updatePeople()
  addPerson?.addEventListener('click', () => newPerson(true))
  function updateTrainers() {
    if (!trainers || !addTrainer || !trainerCount) return
    const rows = [...trainers.querySelectorAll<HTMLElement>('[data-trainer]')]
    rows.forEach((row, i) => {
      row.querySelector('h3')!.textContent = `Formateur déclaré ${i + 1}`
      const remove = row.querySelector<HTMLButtonElement>('[data-remove]')!
      remove.setAttribute('aria-label', `Retirer le formateur déclaré ${i + 1}`)
      remove.disabled = pending || (form!.dataset.kind === 'deploiement' && rows.length === 1)
    })
    trainerCount.textContent = rows.length
      ? `${rows.length} formateur(s) déclaré(s).`
      : 'Aucun formateur déclaré pour le moment (facultatif).'
    addTrainer.disabled = pending || rows.length >= 20
  }
  function newTrainer(focus = false) {
    if (!trainers || pending || terminal || trainers.children.length >= 20) return
    const id = ++nextTrainer
    const row = document.createElement('section')
    row.className = 'of-person'
    row.dataset.trainer = String(id)
    const heading = document.createElement('h3')
    heading.id = `of-trainer-${id}`
    row.setAttribute('aria-labelledby', heading.id)
    const grid = document.createElement('div')
    grid.className = 'of-grid'
    for (const field of [
      { key: 'name', label: 'Nom et prénom *', type: 'text', max: 300 },
      {
        key: 'email',
        label: form!.dataset.kind === 'deploiement' ? 'E-mail *' : 'E-mail (facultatif)',
        type: 'email',
        max: 254,
      },
    ]) {
      const label = document.createElement('label')
      label.className = 'of-field'
      const text = document.createElement('span')
      text.textContent = field.label
      const input = document.createElement('input')
      input.name = `trainer-${id}-${field.key}`
      input.dataset.trainerField = field.key
      input.type = field.type
      input.required = field.key === 'name' || form!.dataset.kind === 'deploiement'
      input.maxLength = field.max
      input.autocomplete = 'off'
      label.append(text, input)
      grid.append(label)
    }
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'of-person-remove'
    remove.dataset.remove = ''
    remove.textContent = 'Retirer ce formateur'
    remove.addEventListener('click', () => {
      if (
        pending ||
        terminal ||
        (form!.dataset.kind === 'deploiement' && trainers.children.length === 1)
      )
        return
      row.remove()
      updateTrainers()
      addTrainer?.focus({ preventScroll: true })
    })
    row.append(heading, grid, remove)
    trainers.append(row)
    updateTrainers()
    if (focus) row.querySelector('input')?.focus()
  }
  addTrainer?.addEventListener('click', () => newTrainer(true))
  if (form.dataset.kind === 'deploiement') newTrainer()
  else updateTrainers()
  submit.disabled = false

  function show(message: string, error = false) {
    feedback.hidden = false
    feedback.textContent = message
    feedback.classList.toggle('is-error', error)
    feedback.classList.toggle('is-ok', !error)
    feedback.setAttribute('role', error ? 'alert' : 'status')
    feedback.focus({ preventScroll: true })
    feedback.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (pending || terminal || !form.reportValidity()) return
    const data = new FormData(form)
    const str = (key: string) => String(data.get(key) ?? '').trim()
    const num = (key: string) => (str(key) === '' ? null : Number(str(key)))
    const payload: Record<string, unknown> = {
      token: str('token'),
      referrer: {
        name: str('referentName'),
        email: str('referentEmail'),
      },
      ...(form.dataset.kind === 'contact'
        ? {
            directionEmail: str('directionEmail'),
            schoolDetails: {
              academy: str('academy'),
              address: str('address'),
              postalCode: str('postalCode'),
              type: str('schoolType'),
            },
            operations: {
              groupedSchools: str('groupedSchools') === 'true',
              associatedSchools: str('associatedSchools'),
            },
          }
        : {}),
      formation:
        form.dataset.kind === 'participants'
          ? null
          : {
              start: str('start'),
              end: str('end'),
              format: str('format'),
              planning: str('planning'),
              sessions: num('sessions'),
            },
      declaredTrainers: trainers
        ? [...trainers.querySelectorAll('[data-trainer]')].map((row) =>
            Object.fromEntries(
              [...row.querySelectorAll<HTMLInputElement>('[data-trainer-field]')].map((input) => [
                input.dataset.trainerField!,
                input.value.trim(),
              ]),
            ),
          )
        : [],
      participants: people
        ? [...people.querySelectorAll('[data-person]')].map((row) =>
            Object.fromEntries(
              [...row.querySelectorAll<HTMLInputElement>('[data-person-field]')].map((input) => [
                input.dataset.personField!,
                input.value.trim(),
              ]),
            ),
          )
        : [],
      confirmed:
        data.get(form.dataset.kind === 'deploiement' ? 'organizationConfirmed' : 'confirmed') ===
        'on',
      organizationConfirmed: data.get('organizationConfirmed') === 'on',
      changesAcknowledged: data.get('changesAcknowledged') === 'on',
    }
    if (form.dataset.kind === 'deploiement' && Boolean(str('start')) !== Boolean(str('end'))) {
      show('Indiquez les deux dates, ou laissez-les vides si elles restent à préciser.', true)
      return
    }
    if (str('start') && str('end') && str('end') < str('start')) {
      show('Vérifiez les dates : une fin ne peut pas précéder son début.', true)
      return
    }
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 64000) {
      show(
        'La réponse contient trop de texte ou de participants. Réduisez-la avant de la transmettre.',
        true,
      )
      return
    }
    pending = true
    form.setAttribute('aria-busy', 'true')
    controls().forEach((control) => {
      control.disabled = true
    })
    submit.textContent = 'Transmission en cours…'
    show('Transmission en cours. Merci de patienter sans renvoyer le formulaire.')
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })
      const result = await response.json()
      if (result?.code === 'payload_changed') {
        show(
          'Ce lien a déjà servi pour une autre réponse. Votre nouvelle saisie n’a pas été enregistrée ; elle reste visible ici. Demandez un nouveau lien à l’équipe EUNEOS pour transmettre cette correction.',
          true,
        )
        return
      }
      if (result?.state === 'retryable') {
        show(
          'Votre réponse n’a pas été enregistrée. Votre saisie est conservée ; vous pouvez réessayer dans quelques instants. Aucun nouvel essai automatique n’a été effectué.',
          true,
        )
        return
      }
      if (!response.ok) {
        const messages: Record<string, string> = {
          invalid_fields: 'Vérifiez les champs du formulaire. Votre saisie est conservée.',
          invalid_email: 'Vérifiez les adresses e-mail. Votre saisie est conservée.',
          invalid_text: 'Vérifiez les champs de texte obligatoires et leur longueur.',
          invalid_number: 'Vérifiez les effectifs et les nombres saisis.',
          invalid_date: 'Vérifiez les dates saisies. Votre saisie est conservée.',
          date_order: 'Vérifiez les dates : une fin ne peut pas précéder son début.',
          date_pair_required:
            'Indiquez les deux dates, ou laissez-les vides si elles restent à préciser.',
          trainer_required: 'Indiquez au moins un formateur avec son nom et son e-mail.',
          sessions_required: 'Indiquez au moins une session prévue.',
          grouping_required: 'Précisez si d’autres établissements seront regroupés avec le vôtre.',
          invalid_format: 'Choisissez la modalité Présentiel ou Hybride.',
          invalid_school_type: 'Choisissez un type d’établissement dans la liste.',
          read_failed:
            'Le dossier n’a pas pu être vérifié. Votre saisie est conservée et n’a pas été enregistrée. Vous pouvez réessayer dans quelques instants.',
          target_busy:
            'Une autre réponse est en cours de traitement pour ce dossier. Votre saisie n’a pas été enregistrée et reste visible ici. Réessayez dans quelques instants.',
          link_renewed:
            'Ce lien a été remplacé. Votre saisie reste visible ici ; demandez le nouveau lien à l’équipe EUNEOS.',
          concurrent_change:
            'Ce dossier a été modifié pendant votre saisie. Vos informations restent visibles ici ; vérifiez avec l’équipe avant de les renvoyer.',
          target_mismatch:
            'Ce lien ne correspond plus au dossier. Votre saisie reste visible ici ; demandez un nouveau lien à l’équipe EUNEOS.',
          target_inactive:
            'Ce dossier n’est plus ouvert à la collecte. Votre saisie reste visible ici ; contactez l’équipe EUNEOS.',
          target_archived:
            'Ce dossier n’est plus ouvert à la collecte. Votre saisie reste visible ici ; contactez l’équipe EUNEOS.',
          participants_required: 'Ajoutez au moins un adulte avec son nom et son prénom.',
          participants_ambiguous:
            'Des participants semblent apparaître plusieurs fois. Vérifiez les noms et les adresses e-mail.',
          confirmation_required: 'Cochez les confirmations avant de transmettre les informations.',
          input_too_large:
            'La réponse contient trop de texte ou de participants. Réduisez-la avant de réessayer.',
          champs:
            'Vérifiez les champs obligatoires et les adresses e-mail. Votre saisie est conservée.',
          dates:
            'Vérifiez les dates : la fin ne peut pas précéder le début. Votre saisie est conservée.',
          taille:
            'La réponse contient trop de texte ou de participants. Réduisez-la avant de réessayer.',
          lien_invalide:
            'Ce lien est invalide, expiré ou a été remplacé. Demandez un nouveau lien à l’équipe EUNEOS.',
          dossier: 'Le dossier a changé. Demandez un nouveau lien à l’équipe EUNEOS.',
          origine: 'Rechargez le formulaire depuis votre lien personnel avant un nouvel essai.',
        }
        show(
          messages[result?.code] ??
            'L’envoi n’a pas pu être confirmé. Votre saisie reste sur cette page. Vérifiez avec l’équipe avant de renvoyer le formulaire.',
          true,
        )
        return
      }
      if (!['complete', 'review', 'processing'].includes(result?.state))
        throw new Error('invalid response')
      terminal = true
      if (result.preview === true || form.dataset.preview === 'true')
        show(
          'Test terminé. Aucune donnée n’a été ajoutée au suivi réel et aucun e-mail n’a été envoyé.',
        )
      else if (result.state === 'complete')
        show(
          result.duplicate
            ? 'Cette réponse avait déjà été reçue. Aucun nouvel enregistrement n’a été ajouté. Pour une correction, demandez un nouveau lien à l’équipe.'
            : 'Votre réponse a bien été enregistrée. Merci. Pour une correction, demandez un nouveau lien à l’équipe EUNEOS.',
        )
      else if (result.state === 'review')
        show(
          'Votre réponse a été reçue et nécessite une vérification par l’équipe EUNEOS. Ne la renvoyez pas. L’équipe pourra vous demander une précision.',
        )
      else
        show(
          'La réception de votre réponse est en cours de confirmation. Ne renvoyez pas le formulaire ; contactez l’équipe EUNEOS si vous avez besoin de vérifier son état.',
        )
      form.hidden = true
    } catch {
      show(
        'L’envoi n’a pas pu être confirmé. Votre saisie reste sur cette page. Aucun nouvel essai automatique n’a été effectué ; vérifiez avec l’équipe avant de renvoyer la réponse.',
        true,
      )
    } finally {
      pending = false
      form.removeAttribute('aria-busy')
      submit.textContent = 'Transmettre les informations'
      if (!terminal) {
        controls().forEach((control) => {
          control.disabled = false
        })
        updatePeople()
        updateTrainers()
      }
    }
  })
}
