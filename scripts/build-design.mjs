import { cp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

/**
 * Builds the Claude Design bundle from the app's own stylesheet.
 *
 * Every card links the real src/client/styles.css — copied in here, never
 * re-authored — so a preview cannot drift from what the board actually renders.
 * Change the copy and you have changed nothing; change styles.css and rerun.
 *
 * Sample text is deliberately invented. Real clue content lives only in
 * Postgres and must never reach this repo.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = `${root}design`

// ── sample data, none of it from the real pack ───────────────────────────────
const CATEGORIES = [
  'Emoji-oversettelse',
  'Zoomet inn',
  'Musikk',
  'Trondheim & NTNU',
  'Norge rundt',
  'Studentliv',
]

const TEAMS = [
  { name: 'Fadderbarna', score: 1200 },
  { name: 'Kollektivet', score: 800 },
  { name: 'Team Bortistu', score: -300 },
  { name: 'Kalinka', score: 400 },
  { name: 'Siste Skanse', score: 0 },
]

const scoreStrip = (turnIndex = 0) => `
<div class="score-strip">
  ${TEAMS.map(
    (t, i) => `
  <div class="score-strip__team${i === turnIndex ? ' score-strip__team--turn' : ''}">
    <div class="score-strip__name">${t.name}</div>
    <div class="score-strip__score${t.score < 0 ? ' score-strip__score--negative' : ''}">${t.score}</div>
  </div>`,
  ).join('')}
</div>`

const grid = () => {
  const spent = new Set(['0-1', '2-0', '3-3', '5-4'])
  const cells = []
  for (let tier = 1; tier <= 5; tier += 1) {
    for (let col = 0; col < 6; col += 1) {
      const isSpent = spent.has(`${col}-${tier - 1}`)
      const sips = [2, 4, 6, 8, 10][tier - 1]
      cells.push(
        `<div class="board__tile${isSpent ? ' board__tile--spent' : ''}">${
          isSpent
            ? ''
            : `<span class="board__tile-value">${tier * 100}</span>` +
              `<span class="board__tile-sips">${sips} slurker</span>`
        }</div>`,
      )
    }
  }
  return `
<div class="board__grid" style="grid-template-columns: repeat(6, 1fr); grid-template-rows: 132px repeat(5, 1fr);">
  ${CATEGORIES.map((c) => `<div class="board__category"><span>${c}</span></div>`).join('')}
  ${cells.join('')}
</div>`
}

const countdown = (seconds, fraction, urgent = false) => `
<div class="countdown${urgent ? ' countdown--urgent' : ''}">
  <div class="countdown__bar">
    <div class="countdown__fill" style="transform: scaleX(${fraction})"></div>
  </div>
  <span class="countdown__seconds">${seconds}</span>
</div>`

const clueFrame = (inner, turnIndex = 1) =>
  `<div class="board">${inner}${scoreStrip(turnIndex)}</div>`

const clue = ({
  category,
  value,
  prompt,
  emoji = false,
  sips = 8,
  footerRight = 'Kollektivet',
  extras = '',
  timer = countdown(21, 0.7),
}) => `
<div class="clue">
  <div class="clue__header">
    <span>${category}</span>
    <span class="clue__value"><span class="clue__value-label">${
      String(value).includes('DOBLE') ? 'Innsats' : 'Verdi'
    }</span>${String(value).replace('DAGENS DOBLE · ', '')}</span>
  </div>
  ${extras}
  <p class="clue__prompt${emoji ? ' clue__prompt--emoji' : ''}">${prompt}</p>
  ${timer}
  <div class="clue__footer">
    <span class="clue__sips">${sips} slurker å prøve</span>
    <span>${footerRight}</span>
  </div>
</div>`

// ── the cards ────────────────────────────────────────────────────────────────
const CARDS = [
  {
    file: 'tokens-colors',
    name: 'Farger',
    group: 'Foundations',
    subtitle: 'Jeopardy-blå, gull, negativ rød',
    kind: 'tokens',
    viewport: { width: 960, height: 340 },
    body: `
<div class="ds-tokens">
  <h2 style="font-size:28px">Farger</h2>
  <div class="ds-swatches">
    ${[
      ['--jeopardy-blue', '#060ce9', 'Merkevaren'],
      ['--board-bg', '#0b1064', 'Bak rutenettet'],
      ['--tile-bg', '#060ce9', 'Ubrukt rute'],
      ['--tile-bg-spent', '#030747', 'Brukt rute'],
      ['--gold', '#d69f4c', 'Kategorier, dempet'],
      ['--gold-bright', '#ffcc00', 'Poeng og nedtelling'],
      ['--ink-dim', '#b9bfe8', 'Sekundær tekst'],
      ['--negative', '#ff5a5a', 'Minuspoeng'],
    ]
      .map(
        ([name, value, use]) => `
    <div class="ds-swatch">
      <div class="ds-swatch__chip" style="background:${value}"></div>
      <div class="ds-swatch__meta">
        <span class="ds-swatch__name">${use}</span>
        <span class="ds-swatch__value">${name}<br>${value}</span>
      </div>
    </div>`,
      )
      .join('')}
  </div>
</div>`,
  },
  {
    file: 'tokens-type',
    name: 'Typografi',
    group: 'Foundations',
    subtitle: 'Display mot UI, brett mot telefon',
    kind: 'tokens',
    viewport: { width: 960, height: 460 },
    body: `
<div class="ds-tokens">
  <h2 style="font-size:28px">Typografi</h2>
  ${[
    ['clue__prompt · 84px', 'font-family:var(--font-display);font-size:56px', 'Hvilken by?'],
    ['board__tile · 86px', 'font-family:var(--font-display);font-size:56px;color:var(--gold-bright)', '400'],
    ['board__category · 34px', 'font-family:var(--font-display);font-size:28px;text-transform:uppercase', 'Trondheim & NTNU'],
    ['score-strip__score · 58px', 'font-family:var(--font-display);font-size:40px', '1200'],
    ['host · 18px', 'font-size:18px', 'Vertspult, én hånd'],
    ['muted · 14px', 'font-size:14px;color:var(--ink-dim)', 'Sekundær tekst på telefon'],
  ]
    .map(
      ([label, style, sample]) => `
  <div class="ds-type-row">
    <span class="ds-type-row__label">${label}</span>
    <span style="${style}">${sample}</span>
  </div>`,
    )
    .join('')}
</div>`,
  },

  // ── Board ──
  {
    file: 'board-grid',
    name: 'Rutenett',
    group: 'Brett',
    subtitle: '6×5, brukte ruter nedtonet',
    kind: 'board',
    body: clueFrame(grid(), 0),
  },
  {
    file: 'board-clue-text',
    name: 'Spørsmål',
    group: 'Brett',
    subtitle: 'Tekst, med nedtelling',
    kind: 'board',
    body: clueFrame(
      clue({
        category: 'Trondheim & NTNU',
        value: 400,
        prompt: 'Hvilken elv renner gjennom byen?',
      }),
    ),
  },
  {
    file: 'board-clue-emoji',
    name: 'Emoji-spørsmål',
    group: 'Brett',
    subtitle: 'Egen skala — poenget er at de er enorme',
    kind: 'board',
    body: clueFrame(
      clue({
        category: 'Emoji-oversettelse',
        value: 200,
        prompt: '🦁👑🌅',
        emoji: true,
        sips: 4,
      }),
    ),
  },
  {
    file: 'board-steal-open',
    name: 'Stjeling åpen',
    group: 'Brett',
    subtitle: '10 sekunder, rød nedtelling',
    kind: 'board',
    body: clueFrame(
      clue({
        category: 'Norge rundt',
        value: 600,
        prompt: 'Hva heter Norges eldste by?',
        sips: 6,
        footerRight: '<span class="clue__steal">Stjeling åpen!</span>',
        timer: countdown(4, 0.4, true),
      }),
    ),
  },
  {
    file: 'board-buzz-winner',
    name: 'Vinner av buzzen',
    group: 'Brett',
    subtitle: 'Marginen i ms, så ingen krangler',
    kind: 'board',
    body: clueFrame(
      clue({
        category: 'Norge rundt',
        value: 600,
        prompt: 'Hva heter Norges eldste by?',
        sips: 6,
        extras: '<p class="clue__buzz-winner">Kalinka stjeler — 34 ms foran</p>',
        timer: '',
        footerRight: 'Kalinka',
      }),
    ),
  },
  {
    file: 'board-daily-double',
    name: 'Dagens doble',
    group: 'Brett',
    subtitle: 'Slam før spørsmålet finnes',
    kind: 'board',
    body: `<div class="board">
  <div class="clue clue--daily-double">
    <h1>Dagens doble</h1>
    <p class="clue__dd-team">Kollektivet satser…</p>
  </div>
  ${scoreStrip(1)}
</div>`,
  },
  {
    file: 'board-daily-double-allin',
    name: 'Ekte dagens doble',
    group: 'Brett',
    subtitle: 'Hele potten satset — hele rommet drikker',
    kind: 'board',
    body: clueFrame(
      clue({
        category: 'Teknologi & AI',
        value: 'DAGENS DOBLE · 800',
        prompt: 'Hva står GPT for?',
        sips: 10,
        extras: '<p class="clue__all-in">Ekte dagens doble — hele potten!</p>',
        timer: '',
      }),
    ),
  },
  {
    file: 'board-final-wager',
    name: 'Final — innsats',
    group: 'Brett',
    subtitle: 'Blindt, og hvem som er ute',
    kind: 'board',
    body: `<div class="board">
  <div class="final">
    <h1 class="final__title">Final Jeopardy</h1>
    <p class="final__blind">Ingen kategori. Ingen hint. Satse blindt.</p>
    <div class="final__locks">
      <div class="final__lock final__lock--done"><span>Fadderbarna</span><strong>Låst</strong></div>
      <div class="final__lock"><span>Kollektivet</span><strong>Satser…</strong></div>
      <div class="final__lock final__lock--done"><span>Kalinka</span><strong>Låst</strong></div>
    </div>
    <p class="final__out">Ute av finalen: Team Bortistu · Siste Skanse — null eller under.</p>
  </div>
  ${scoreStrip(0)}
</div>`,
  },
  {
    file: 'board-final-standings',
    name: 'Final — stillingen',
    group: 'Brett',
    subtitle: 'Grønt for riktig, rødt for feil',
    kind: 'board',
    body: `<div class="board">
  <div class="final">
    <h1 class="final__title">Stillingen</h1>
    <p class="final__prompt-small">Hvilket tegn valgte han?</p>
    <div class="final__reveals">
      <div class="final__reveal final__reveal--correct">
        <span class="final__reveal-team">Fadderbarna</span>
        <span class="final__reveal-answer">Alfakrøll</span>
        <span class="final__reveal-wager">+1200</span>
        <span class="final__reveal-score">2400</span>
      </div>
      <div class="final__reveal final__reveal--wrong">
        <span class="final__reveal-team">Kalinka</span>
        <span class="final__reveal-answer">Ampersand</span>
        <span class="final__reveal-wager">−400</span>
        <span class="final__reveal-score">0</span>
      </div>
    </div>
  </div>
  ${scoreStrip(0)}
</div>`,
  },

  // ── Host console ──
  {
    file: 'host-brett',
    name: 'Vertspult — Brett',
    group: 'Vertspult',
    subtitle: 'Kompakt rutevelger, brukte ruter låst',
    kind: 'phone',
    body: hostShell(
      'brett',
      `<div class="brett">
  <p class="brett__turn">Tur: <strong>Kollektivet</strong></p>
  <div class="brett__grid" style="grid-template-columns: repeat(6, 1fr);">
    ${CATEGORIES.map((c) => `<div class="brett__cat">${c}</div>`).join('')}
    ${[1, 2, 3, 4, 5]
      .flatMap((tier) =>
        CATEGORIES.map((_, col) => {
          const spent = (col + tier) % 7 === 0
          return `<button class="brett__tile${spent ? ' brett__tile--spent' : ''}">${tier * 100}</button>`
        }),
      )
      .join('')}
  </div>
</div>`,
    ),
  },
  {
    file: 'host-spor',
    name: 'Vertspult — Spør',
    group: 'Vertspult',
    subtitle: 'Fasit bak et bevisst trykk',
    kind: 'phone',
    body: hostShell(
      'spor',
      `<div class="spor">
  <div class="spor__meta"><span>Trondheim &amp; NTNU</span><span class="spor__value">400</span></div>
  <p class="spor__prompt">Hvilken elv renner gjennom byen?</p>
  <p class="spor__answer">Nidelva</p>
  <p class="spor__owner muted">Svarer: Kollektivet</p>
  <div class="spor__timer">
    <span class="spor__timer-value">18 s</span>
    <button class="chip">Pause</button>
    <button class="chip">+15s</button>
  </div>
  <div class="spor__actions">
    <button class="btn btn--minus">✗ Feil</button>
    <button class="btn btn--plus">✓ Riktig</button>
  </div>
</div>`,
    ),
  },
  {
    file: 'host-spor-steal',
    name: 'Vertspult — stjeling',
    group: 'Vertspult',
    subtitle: 'Velg lag, eller ingen stjal',
    kind: 'phone',
    body: hostShell(
      'spor',
      `<div class="spor">
  <div class="spor__meta"><span>Norge rundt</span><span class="spor__value">600</span></div>
  <p class="spor__prompt">Hva heter Norges eldste by?</p>
  <button class="btn">Vis fasit</button>
  <p class="spor__owner muted">Svarer: Kollektivet</p>
  <div class="spor__steal">
    <p class="spor__steal-title">Stjeling åpen — hvem svarte?</p>
    <div class="spor__steal-teams">
      <button class="chip chip--active">Kalinka</button>
      <button class="chip">Fadderbarna</button>
      <button class="chip">Siste Skanse</button>
    </div>
    <div class="spor__actions">
      <button class="btn btn--minus">✗ Feil</button>
      <button class="btn btn--plus">✓ Riktig</button>
    </div>
    <button class="btn btn--undo">Ingen stjal — hele rommet drikker</button>
  </div>
</div>`,
    ),
  },
  {
    file: 'host-poeng',
    name: 'Vertspult — Poeng',
    group: 'Vertspult',
    subtitle: 'Steppere, valgbart steg, angre',
    kind: 'phone',
    body: hostShell(
      'poeng',
      `<div class="poeng">
  <div class="poeng__steps">
    <button class="chip">50</button>
    <button class="chip chip--active">100</button>
    <button class="chip">200</button>
    <button class="chip">400</button>
  </div>
  <ul class="poeng__teams">
    ${TEAMS.slice(0, 3)
      .map(
        (t) => `
    <li class="poeng__team">
      <div class="poeng__team-head">
        <span class="poeng__team-name">${t.name}</span>
        <span class="poeng__team-score${t.score < 0 ? ' poeng__team-score--negative' : ''}">${t.score}</span>
      </div>
      <div class="poeng__team-controls">
        <button class="btn btn--minus">−100</button>
        <button class="btn btn--plus">+100</button>
      </div>
    </li>`,
      )
      .join('')}
  </ul>
  <button class="btn btn--undo">↶ Angre (+400)</button>
</div>`,
    ),
  },
  {
    file: 'host-wager',
    name: 'Vertspult — innsats',
    group: 'Vertspult',
    subtitle: 'Hurtigvalg, men serveren klamrer',
    kind: 'phone',
    body: hostShell(
      'spor',
      `<div class="wager">
  <h2 class="wager__title">Dagens doble</h2>
  <p class="muted">Kollektivet satser. Maks <strong>800</strong> — hele poengsummen.</p>
  <div class="wager__quick">
    <button class="chip">200</button>
    <button class="chip">400</button>
    <button class="chip chip--active">800</button>
  </div>
  <input type="text" value="800">
  <button class="btn btn--primary">Lås innsatsen og vis spørsmålet</button>
</div>`,
    ),
  },

  // ── Team phone ──
  {
    file: 'team-join',
    name: 'Lag — bli med',
    group: 'Lagtelefon',
    subtitle: 'Romkode, navn, og forsvar navnet',
    kind: 'phone',
    body: `<div class="phone">
  <form class="phone__body host-gate">
    <h1>Bli med</h1>
    <label class="field"><span>Romkode</span><input type="text" value="NTNU"></label>
    <label class="field"><span>Lagnavn</span><input type="text" value="Kollektivet"></label>
    <label class="field"><span>Forsvar navnet i én setning</span><input type="text" value="Vi bor sammen og krangler om oppvasken"></label>
    <button class="btn btn--primary">Bli med</button>
  </form>
</div>`,
  },
  {
    file: 'team-idle',
    name: 'Lag — hvilemodus',
    group: 'Lagtelefon',
    subtitle: '95 % av kvelden ser den slik ut',
    kind: 'phone',
    body: teamShell(`
  <div class="team__idle">
    <p class="muted">Se på skjermen.</p>
  </div>`),
  },
  {
    file: 'team-buzz',
    name: 'Lag — buzz',
    group: 'Lagtelefon',
    subtitle: 'Én enorm knapp, og hva feil koster',
    kind: 'phone',
    body: teamShell(`
  <div class="buzz">
    <button class="buzz__button">BUZZ</button>
    <p class="buzz__cost">Feil svar koster full pott.</p>
  </div>`),
  },
  {
    file: 'team-final-wager',
    name: 'Lag — final, innsats',
    group: 'Lagtelefon',
    subtitle: 'Blindt, ingen kategori',
    kind: 'phone',
    body: teamShell(`
  <div class="team-final">
    <h1>Satse blindt</h1>
    <p class="muted">Ingen kategori, ingen hint. 0 til 800.</p>
    <input type="text" value="800">
    <button class="btn btn--primary">Lås innsatsen</button>
  </div>`),
  },
]

function hostShell(active, inner) {
  const tabs = [
    ['brett', 'Brett'],
    ['spor', 'Spør'],
    ['poeng', 'Poeng'],
    ['final', 'Final'],
  ]
  return `<div class="phone host">
  <header class="host__header"><span class="host__code">NTNU</span></header>
  <main class="host__body">${inner}</main>
  <nav class="host__tabs">
    ${tabs
      .map(
        ([key, label]) =>
          `<button class="host__tab${key === active ? ' host__tab--active' : ''}">${label}</button>`,
      )
      .join('')}
  </nav>
</div>`
}

function teamShell(inner) {
  return `<div class="phone team">
  <header class="team__header">
    <span class="team__name">Kollektivet</span>
    <span class="team__score">800</span>
  </header>
  <main class="team__body">${inner}</main>
  <footer class="team__footer">
    <span class="team__status team__status--open">Tilkoblet</span>
    <span class="team__leave">Bytt lag</span>
  </footer>
</div>`
}

// ── emit ─────────────────────────────────────────────────────────────────────
const page = (card) => {
  const frameClass =
    card.kind === 'board'
      ? 'ds-frame ds-frame--board'
      : card.kind === 'phone'
        ? 'ds-frame ds-frame--phone'
        : ''

  const inner =
    card.kind === 'board'
      ? `<div class="${frameClass}"><div class="stage">${card.body}</div></div>`
      : card.kind === 'phone'
        ? `<div class="${frameClass}">${card.body}</div>`
        : card.body

  // The marker is what the Design System pane indexes cards from.
  return `<!-- @dsCard group="${card.group}" -->
<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<title>${card.name}</title>
<link rel="stylesheet" href="./styles.css">
<link rel="stylesheet" href="./frame.css">
</head>
<body>
${inner}
</body>
</html>
`
}

await mkdir(outDir, { recursive: true })

// Drop generated pages so a renamed card cannot linger.
for (const entry of await readdir(outDir)) {
  if (entry.endsWith('.html') || entry === 'styles.css') {
    await rm(`${outDir}/${entry}`)
  }
}

// The app's real stylesheet, copied verbatim. Never edit design/styles.css.
await cp(`${root}src/client/styles.css`, `${outDir}/styles.css`)

// …along with the fonts it references, so a card renders in Anton rather than
// in whatever the viewer's machine happens to substitute.
await mkdir(`${outDir}/fonts`, { recursive: true })
await cp(`${root}src/client/fonts`, `${outDir}/fonts`, { recursive: true })

for (const card of CARDS) {
  await writeFile(`${outDir}/${card.file}.html`, page(card))
}

await writeFile(
  `${outDir}/cards.json`,
  JSON.stringify(
    CARDS.map((c) => ({
      name: c.name,
      path: `${c.file}.html`,
      group: c.group,
      subtitle: c.subtitle,
      viewport:
        c.viewport ??
        (c.kind === 'board'
          ? { width: 960, height: 540 }
          : { width: 375, height: 760 }),
    })),
    null,
    2,
  ),
)

console.log(`built ${CARDS.length} cards into design/`)
