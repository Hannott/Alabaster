# Development setup

## Requirements

Node.js 24.15 or newer. Node.js 22.22.2 or newer within the 22.x line also
works.

Nothing else is required. Docker is optional and is never a production
dependency.

## With a local Node.js

```bash
npm install
```

```bash
npm run dev
```

## With Docker Desktop

A persistent development service with hot reload, at
<http://127.0.0.1:4173>:

```bash
npm run docker:up
```

```bash
npm run docker:logs
```

```bash
npm run docker:down
```

The service restarts with Docker Desktop until you stop it explicitly. Set
`ALABASTER_PORT` before starting Compose to use another host port. Linux
dependencies live in a named volume and refresh when `package-lock.json`
changes.

::: warning It talks to a real printer
The development service is usually pointed at a real machine. Heaters heat and
motors move. Verify with reads and the interface's own state where you can, and
be deliberate about mutating G-code.
:::

## The documentation site

This site is built with VitePress from `website/`:

```bash
npm run docs:dev
```

```bash
npm run docs:build
```

It is published to GitHub Pages from `main`. Pull requests build it without
deploying.

## Before opening a pull request

```bash
npm run check
```

That runs formatting, linting, type-checking, every test, and the production
build. While iterating, run a single spec instead:

```bash
npx vitest run src/stores/__tests__/telemetry.spec.ts
```

## The stack

| Layer     | Choice                                             |
| --------- | -------------------------------------------------- |
| Framework | Vue 3, Composition API, `<script setup lang="ts">` |
| Build     | Vite                                               |
| State     | Pinia, split by domain                             |
| Routing   | Vue Router, hash history                           |
| i18n      | Vue I18n, English as the typed source locale       |
| Styling   | Tailwind CSS over semantic design tokens           |
| Testing   | Vitest and Vue Test Utils                          |

Transport code is kept free of Vue and Pinia so it can be unit tested without
mounting anything.

## Where the rules live

The repository carries its own contributor documentation under `docs/` —
architecture decision records and design contracts. It is not published here, and
it is binding: code and documents are not allowed to disagree.

[Contributing](/contributing) covers what those documents govern and what the
tests enforce.
