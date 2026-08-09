import { useEffect, useState } from 'react'
import { KINDS_READY } from '@shared/clue-kinds.ts'
import {
  adminFetch,
  AdminError,
  fetchClueImage,
  type AdminClue,
} from './api.ts'

/**
 * One clue, editable (PRD §6.2).
 *
 * The two things it has to do well are the two things that go wrong late: a
 * typo in a prompt found at 20:00, and an image that has to be attached without
 * re-sending the whole pack.
 */
export function ClueEditor({
  clue,
  paired,
  onSaved,
  onClose,
}: {
  clue: AdminClue
  paired: boolean
  onSaved: () => void | Promise<void>
  onClose: () => void
}) {
  const [kind, setKind] = useState(clue.kind)
  const [prompt, setPrompt] = useState(clue.payload.prompt ?? '')
  const [answer, setAnswer] = useState(clue.answer)
  const [link, setLink] = useState(clue.payload.link ?? '')
  const [hint, setHint] = useState(clue.payload.hint ?? '')
  const [fromLabel, setFromLabel] = useState(clue.fromLabel ?? '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [imageVersion, setImageVersion] = useState(0)
  const [hasImage, setHasImage] = useState(clue.hasImage)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  // Re-fetched whenever the version bumps, so what is on screen is always what
  // is in the database rather than whatever the browser cached.
  useEffect(() => {
    if (!hasImage) {
      setImageUrl(null)
      return
    }
    let url: string | null = null
    let dropped = false
    void fetchClueImage(clue.id).then((next) => {
      url = next
      if (dropped && next) URL.revokeObjectURL(next)
      else setImageUrl(next)
    })
    return () => {
      dropped = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [clue.id, hasImage, imageVersion])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await fn()
      setNote(ok)
      await onSaved()
    } catch (err) {
      setError(
        err instanceof AdminError && err.problems.length > 0
          ? `${err.message}: ${err.problems.map((p) => p.message).join(', ')}`
          : err instanceof Error
            ? err.message
            : 'Ukjent feil',
      )
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const payload =
      kind === 'audio_host'
        ? { kind, prompt, link, hint }
        : { kind, prompt }

    return run(
      () =>
        adminFetch(`/clues/${clue.id}`, {
          method: 'PATCH',
          body: {
            answer,
            payload,
            fromLabel: paired ? fromLabel || null : null,
          },
        }),
      'Lagret.',
    )
  }

  const upload = (file: File) =>
    run(async () => {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Kunne ikke lese filen'))
        // The data URL prefix is the browser's, not the format's — the import
        // schema wants raw base64, so it comes off here.
        reader.onload = () =>
          resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''))
        reader.readAsDataURL(file)
      })

      await adminFetch(`/clues/${clue.id}/image`, {
        method: 'PUT',
        body: { mime: file.type, base64 },
      })
      setHasImage(true)
      setImageVersion((n) => n + 1)
    }, 'Bildet er lastet opp.')

  return (
    <div className="admin__editor">
      <div className="admin__editor-head">
        <strong>Tier {clue.tier}</strong>
        <button type="button" className="chip" onClick={onClose}>
          Lukk
        </button>
      </div>

      <label className="field">
        <span>Type</span>
        <div className="admin__kinds">
          {KINDS_READY.map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${kind === k ? ' chip--active' : ''}`}
              onClick={() => setKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </label>

      <label className="field">
        <span>Spørsmål</span>
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Fasit</span>
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </label>

      {paired ? (
        <label className="field">
          <span>Fra hvilken halvdel (kreves i parede kategorier)</span>
          <input
            type="text"
            value={fromLabel}
            onChange={(e) => setFromLabel(e.target.value)}
          />
        </label>
      ) : null}

      {kind === 'audio_host' ? (
        <>
          <label className="field">
            <span>Spotify-lenke</span>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Hint på vertens skjerm</span>
            <input
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
            />
          </label>
        </>
      ) : null}

      {kind === 'image' ? (
        <div className="field">
          <span>Bilde</span>
          {hasImage && imageUrl ? (
            <img className="admin__thumb" src={imageUrl} alt="" />
          ) : hasImage ? (
            <p className="muted">Henter bildet…</p>
          ) : (
            <p className="admin__warn">Mangler bilde — blokkerer publisering.</p>
          )}
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void upload(file)
            }}
          />
          {hasImage ? (
            <button
              type="button"
              className="btn btn--undo"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await adminFetch(`/clues/${clue.id}/image`, { method: 'DELETE' })
                  setHasImage(false)
                }, 'Bildet er fjernet.')
              }
            >
              Fjern bildet
            </button>
          ) : null}
        </div>
      ) : null}

      {note ? <p className="admin__ok">{note}</p> : null}
      {error ? <p className="host__error">{error}</p> : null}

      <button
        type="button"
        className="btn btn--primary"
        disabled={busy}
        onClick={save}
      >
        Lagre
      </button>
    </div>
  )
}
