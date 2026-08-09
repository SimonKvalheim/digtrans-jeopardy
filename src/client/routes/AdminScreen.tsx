import { useCallback, useEffect, useState } from 'react'
import {
  adminFetch,
  adminSession,
  AdminError,
  missingImage,
  type AdminClue,
  type AdminGame,
  type AdminPack,
  type AdminRound,
} from '../admin/api.ts'
import { ClueEditor } from '../admin/ClueEditor.tsx'

/**
 * The admin surface (PRD §6.2): the clue editor, publishing, and the list of
 * games.
 *
 * Bulk import stays a curl command — pasting a 60-clue JSON file into a phone
 * is not a thing anyone will do. What has to exist in a browser is everything
 * that happens *after* the pack is in: fixing one clue, attaching an image,
 * publishing, and clearing a test game out of the way.
 */
export function AdminScreen() {
  const [pin, setPin] = useState(adminSession.pin())
  const [typed, setTyped] = useState('')
  const [packs, setPacks] = useState<AdminPack[]>([])
  const [slug, setSlug] = useState<string | null>(null)
  const [rounds, setRounds] = useState<AdminRound[]>([])
  const [pack, setPack] = useState<AdminPack | null>(null)
  const [games, setGames] = useState<AdminGame[]>([])
  const [open, setOpen] = useState<{ clue: AdminClue; paired: boolean } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const loadPacks = useCallback(async () => {
    try {
      const data = await adminFetch<{ packs: AdminPack[] }>('/packs')
      setPacks(data.packs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    }
  }, [])

  const loadPack = useCallback(async (which: string) => {
    try {
      const data = await adminFetch<{ pack: AdminPack; rounds: AdminRound[] }>(
        `/packs/${which}`,
      )
      setPack(data.pack)
      setRounds(data.rounds)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    }
  }, [])

  const loadGames = useCallback(async () => {
    try {
      setGames((await adminFetch<{ games: AdminGame[] }>('/games')).games)
    } catch {
      // The editor is the point of this screen; the game list is a convenience.
    }
  }, [])

  useEffect(() => {
    if (!pin) return
    void loadPacks()
    void loadGames()
  }, [pin, loadPacks, loadGames])

  useEffect(() => {
    if (slug) void loadPack(slug)
  }, [slug, loadPack])

  if (!pin) {
    return (
      <div className="phone">
        <form
          className="phone__body host-gate"
          onSubmit={(e) => {
            e.preventDefault()
            adminSession.setPin(typed)
            setPin(typed)
          }}
        >
          <h1>Admin</h1>
          <label className="field">
            <span>Admin-PIN</span>
            <input
              type="password"
              inputMode="numeric"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn--primary">
            Fortsett
          </button>
        </form>
      </div>
    )
  }

  const allClues = rounds.flatMap((r) => r.categories.flatMap((c) => c.clues))
  const missing = allClues.filter(missingImage)

  const publish = async () => {
    setNote(null)
    setProblems([])
    try {
      await adminFetch(`/packs/${slug}/publish`, { method: 'POST' })
      setNote('Publisert.')
      await Promise.all([loadPacks(), loadPack(slug!)])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
      if (err instanceof AdminError) {
        setProblems(err.problems.map((p) => `${p.path}: ${p.message}`))
      }
    }
  }

  const deleteGame = async (code: string) => {
    // Typed confirmation, because this drops every score the game recorded and
    // there is no undo at this level.
    const answer = window.prompt(`Slett spillet ${code}? Skriv ${code}:`)
    if (!answer) return
    try {
      await adminFetch(`/games/${code}`, {
        method: 'DELETE',
        body: { confirm: answer },
      })
      await Promise.all([loadGames(), loadPacks()])
      setNote(`Spillet ${code} er slettet.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    }
  }

  return (
    <div className="phone admin">
      <div className="phone__body">
        <h1>Admin</h1>

        <div className="admin__packs">
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip${slug === p.slug ? ' chip--active' : ''}`}
              onClick={() => setSlug(p.slug)}
            >
              {p.slug}
              {p.publishedAt ? ' ✓' : ' (kladd)'}
            </button>
          ))}
        </div>

        {error ? <p className="host__error">{error}</p> : null}
        {note ? <p className="admin__ok">{note}</p> : null}
        {problems.length > 0 ? (
          <ul className="admin__problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        {pack ? (
          <>
            <p className="muted">
              {allClues.length} klør ·{' '}
              {pack.publishedAt ? 'publisert' : 'kladd'}
              {missing.length > 0
                ? ` · ${missing.length} mangler bilde`
                : ''}
            </p>
            <button type="button" className="btn btn--primary" onClick={publish}>
              Publiser pakken
            </button>
          </>
        ) : null}

        {open ? (
          <ClueEditor
            clue={open.clue}
            paired={open.paired}
            onClose={() => setOpen(null)}
            onSaved={() => loadPack(slug!)}
          />
        ) : null}

        {rounds.map((round) => (
          <section key={round.id} className="admin__round">
            <h2>
              {round.kind === 'final'
                ? 'Finale'
                : round.kind === 'double'
                  ? 'Dobbel Jeopardy'
                  : `Runde ${round.position + 1}`}
            </h2>
            {round.categories.map((category) => (
              <div key={category.id} className="admin__cat">
                <div className="admin__cat-name">
                  {category.name}
                  {category.pairedWith ? ` / ${category.pairedWith}` : ''}
                </div>
                {category.clues.map((clue) => (
                  <button
                    key={clue.id}
                    type="button"
                    className={`admin__clue${
                      missingImage(clue) ? ' admin__clue--warn' : ''
                    }`}
                    onClick={() =>
                      setOpen({ clue, paired: Boolean(category.pairedWith) })
                    }
                  >
                    <span className="admin__clue-tier">{clue.tier}</span>
                    <span className="admin__clue-text">
                      {clue.payload.prompt}
                    </span>
                    <span className="admin__clue-kind">
                      {missingImage(clue) ? '⚠ bilde' : clue.kind}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </section>
        ))}

        <section className="admin__round">
          <h2>Spill</h2>
          {/* A pack that any game references cannot be re-imported. One
              throwaway test game therefore blocks replacing the real pack, so
              clearing games out has to be possible from here. */}
          <p className="muted">
            Import nekter å erstatte en pakke som et spill bruker. Slett
            testspill her.
          </p>
          {games.map((game) => (
            <div key={game.id} className="admin__game">
              <span>
                <strong>{game.code}</strong> · {game.packSlug} · {game.phase}
              </span>
              <button
                type="button"
                className="chip"
                onClick={() => void deleteGame(game.code)}
              >
                Slett
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
