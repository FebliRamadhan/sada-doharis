# design-sync notes — SADA SSO Design System

Project: `SADA SSO Design System` (claude.ai/design)
projectId: `9780a299-a15c-45e7-bf42-d8f9c9da1f8c`

## What this is

A **token-only, off-script** sync. `@sada/auth-ui` is a vanilla-TypeScript SPA
(Vite + TailwindCSS v4 + DaisyUI v5) — its "pages" are TS functions returning
HTML strings. There are **no exported React components and no Storybook**, so the
standard `/design-sync` converter (which extracts a compiled component bundle to
`window.<global>.*`) does not apply. We ship tokens + the compiled CSS instead.

## Layout uploaded (from `.design-sync/build/`)

- `styles.css` — render entry; @import closure = `_ds_bundle.css` + `tokens/*.css`.
- `_ds_bundle.css` — the package's own COMPILED CSS (copy of `dist/assets/index-*.css`):
  Tailwind v4 theme + DaisyUI (`d-` prefix, theme "light") + custom brand classes
  + Google Fonts @import. This is the faithful look.
- `tokens/{colors,typography,spacing,radius,shadows}.css` — brand tokens, broken
  out for the design agent to reference by name.
- `tokens/colors.html`, `tokens/typography.html` — preview cards (`@dsCard`).

## Re-sync recipe

1. `pnpm --filter @sada/auth-ui build`
2. Copy fresh `packages/auth-ui/dist/assets/index-*.css` → `.design-sync/build/_ds_bundle.css`
3. If `src/style.css` `:root` tokens changed, update `tokens/*.css` to match.
4. finalize_plan + write_files to the projectId above.

## Gotchas

- Fonts are **remote Google Fonts** (loaded via @import inside `_ds_bundle.css`) —
  no self-hosted `fonts/` dir.
- No `_ds_sync.json` anchor — there's no component render-hash to verify, so each
  re-sync re-uploads the full (small) set. This is intentional for token-only.
- GateGuard fact-forcing hook is active this session; it gates Bash/Write. Present
  facts before each first-touch write, or run with `ECC_GATEGUARD=off`.
