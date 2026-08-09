# Anton (self-hosted)

`anton-v27-latin.woff2` (12 KB) and `anton-v27-latin-ext.woff2` (21 KB), pulled from Google Fonts'
CDN and committed deliberately.

**Why they are in the repo rather than fetched at runtime:** a `@import` from `fonts.googleapis.com`
is a render-blocking request to a third party. The board is opened on a borrowed laptop and has to
survive being reloaded at 21:30 on a venue network — the same rule that keeps TTS pre-generated and
name judging off the critical path (see [`CLAUDE.md`](../../../CLAUDE.md)). Serving the font from our
own origin removes the dependency entirely, and 33 KB is cheaper than a font that might not arrive.

**Subsets:** `latin` carries æ ø å; `latin-ext` covers the accented letters a team will inevitably put
in its name. Neither covers `◀ ▶` (U+25C0 / U+25B6) used in the turn indicator, which fall back to a
system font by design — they are geometric shapes and look the same either way.

**Licence:** SIL Open Font License 1.1, full text in [`LICENSE`](./LICENSE). Redistribution inside this
MIT-licensed repository is permitted; the font is not sold on its own and the licence travels with it.

**Updating:** ask Google Fonts for the current definition, then take the URLs it returns.

```bash
curl -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0" \
  "https://fonts.googleapis.com/css2?family=Anton&display=swap"
```

If the version changes, rename the files to match and update the `@font-face` blocks and
`scripts/build-design.mjs`, which copies them into the design bundle.
