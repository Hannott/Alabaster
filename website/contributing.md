# Contributing

Alabaster takes issues, translations, theme packs, and code.

## Getting set up

[Development setup](/guide/development) covers Node.js versions, the dev server,
the Docker service, and this documentation site.

The short version:

```bash
npm install && npm run dev
```

```bash
npm run check
```

`npm run check` is the gate: formatting, linting, type-checking, every test, and
the production build. A change is not finished until it passes.

Work happens on `develop`. `main` carries releases and this site.

## The cheapest ways to help

**Translate it.** English is the source locale. A new language is a copy of
`src/locales/en.json` with the same keys — no code changes. A test fails the
build if any locale is missing a key or has an empty message, so partial
translations cannot ship by accident.

**Write a theme pack.** One CSS file, one registry line, and a label in each
locale. [Theming](/theming#writing-your-own-pack) has the steps and the
constraints.

**File a good bug.** The console's **Show Klipper's own prefixes** option leaves
the raw `!!` and `//` markers in place so you can copy a line into an issue
verbatim.

## Rules that are enforced by tests

These fail the build. They are not review preferences.

| Rule                                                                                               |                           |
| -------------------------------------------------------------------------------------------------- | ------------------------- |
| Every control variant clears 4.5:1 contrast over every surface, at rest, hovered, and pressed      | Composited, not eyeballed |
| Chromatic colour comes only from the Okabe-Ito palette, and no component carries a colour literal  |                           |
| Every animation has a reduced-motion fallback                                                      |                           |
| Every clickable control uses a documented button variant and size, and none move on hover or press |                           |
| Every routed page uses one of two documented page shells                                           |                           |
| Every locale matches the English schema, with no empty messages                                    |                           |
| Every theme pack implements the full token contract in light and dark                              |                           |

## Rules that reviewers enforce

- **No literal user-facing text in a component.** Add an English key, mirror it
  in every locale, render it through Vue I18n. This includes `aria-label`,
  `title`, placeholders, validation, and notification text.
- **No colour literals.** Components consume semantic tokens; palette primitives
  live only in the theme sources.
- **Colour is never the only carrier of status.** Pair it with text or a distinct
  shape.
- **No `window.confirm`, `window.prompt`, or `window.alert`.** Every confirmation
  is a real dialog that names what it will touch — and is registered in the
  [Confirmations](/interface/settings#confirmations) list.
- **Never reload the application or replace the route** during a Moonraker,
  Klipper, or firmware restart. Keep last-known data mounted and mark it stale.
- **Never replay a mutating command after reconnecting.** Surface the failure and
  require an explicit retry.
- **Any field showing remote data must subscribe to the notification that
  reports its change.** A one-time snapshot left to go stale until the next page
  load breaks the rule the whole application is built on. If no notification
  exists, add explicit polling rather than freezing the value.
- **Verify at desktop width and at 390 px.** Neither the page nor a toolbar may
  scroll sideways.

## Where the standards live

Alabaster keeps internal design and architecture documents — one each for page
layout and shared UI, navigation, buttons, dialogs, module settings, the
dashboard module contract, motion, availability and reconnection, the
Moonraker transport, the frontend stack, and deployment. They are not part of
this repository's public checkout, so you can't open them directly, but they
are binding on every change: code and documents are not allowed to disagree.

If your change touches one of these areas, say so in the issue or pull request
before investing effort in a design — a reviewer can tell you what it already
settled. The common failure is not disagreeing with a document. It is
reinventing what it already settled because nobody knew to ask.

## Editing this site

The published documentation lives in `website/` and is built with VitePress:

```bash
npm run docs:dev
```

Two rules for what goes in it:

- **Lead with what a reader can accomplish.** Never narrate what the screen
  already shows.
- **Never copy developer-facing phrasing** from the repository's own contributor
  documents into user-facing text. They constrain implementation; they are not
  descriptions of the product.

Every page has an **Edit this page on GitHub** link at the bottom.

## Prior art

Alabaster's design owes a lot to [Mainsail](https://github.com/mainsail-crew/mainsail)
and [Fluidd](https://github.com/fluidd-core/fluidd): a great deal of what a
Moonraker client needs to get right was already settled by their years of
production use, and Alabaster's own design documents were written against a
survey of both. Referencing what either does — for Moonraker behaviour or for
UI patterns worth carrying over — is welcome; copying their Vue 2 / Vuex /
Vuetify implementation is not.
