# Design: SADA SSO (packages/auth-ui)

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

## System

- Genre: modern-minimal (government SSO, app screens)
- Shape of the first page: app screen (split auth shell: PANRB brand panel + flat form column)
- Theme: brand (PANRB navy and blue, gold only on the brand panel and the avatar)
- Axes: light/geometric-sans/cool · posture: split for auth, sidebar shell for admin, top bar for portal

## Tokens

`packages/auth-ui/src/tokens.css` is the source of truth. The roles:

```css
:root {
  --color-paper: #fbfdff;
  --color-paper-2: #f5f8fc;
  --color-paper-3: #e9eff6;
  --color-ink: #0d1b2a;
  --color-ink-2: #354e6b;
  --color-muted: #7089a5 /* field edge, 3:1 */;
  --color-rule: #c8d8ea;
  --color-accent: #005598;
  --color-accent-ink: #ffffff;
  --color-focus: #005598 (white on navy);
  --font-display: 'Plus Jakarta Sans';
  --font-body: 'Inter';
  --font-mono: ui-monospace (ids and secrets only);
  --radius: 8px controls in tables, 12px fields and buttons, 16px dialogs;
  --shadow-card: none (overlays only);
}
```

Text muted is #536C8A (4.5:1 on every surface). Status: success #15803D, warning #B45309, error #C0392B, each as ink on a tint, never as a dot.

## Controls

- Primary: solid --panrb-blue, white ink, 12px radius, 48px on auth screens and 40px in admin; hover --panrb-blue-hover, active navy. One per screen; dialogs count as their own screen.
- Secondary: white fill, 1.5px --color-field-edge outline, same radius and height. Danger actions are secondary in red ink unless deleting is the dialog's one action.
- Disabled: sunk fill, muted ink, `not-allowed`, the native attribute.

## Layout

- Headings, labels, table heads: sentence case, untracked. Head groups are left-aligned.
- Tables: full width, horizontal rules only, no card around them; on phones each row restacks.
- Figures: a stat row (figure + label, tabular numerals), never stat cards or gradients.

## Motion

- Character: still. State changes only (`--dur-micro`); nothing on load; reduced motion ends everything at once.

## Exports

`tokens.css` and `base.css` in this project.
