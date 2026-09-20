# Lantern Player

Public static player shell for the private **Lantern Protocol** audiobook.

## What is public here

Only the browser shell:

- `index.html`
- `app.js`
- `site.webmanifest`

The story text, continuity state, audio releases, OpenAI API key, and generation workflows remain in the private `krumiaa/lantern-protocol` repository.

## Runtime model

The phone stores a narrowly scoped GitHub fine-grained personal access token in that browser's local storage.

The token is restricted to the private `lantern-protocol` repository and is used only to:

- read the live private manifest and release metadata/audio;
- dispatch the consumption-gated `generate-next.yml` workflow after an episode actually finishes.

The public repository never contains the token.

## Beta security boundary

This browser-held PAT is intentionally a beta implementation. It should eventually be replaced by a small authenticated gateway or GitHub App if the experiment becomes durable.

The private repository remains authoritative for all story state and generation logic.

## GitHub Pages

This repository is intended to publish from:

- branch: `main`
- folder: `/ (root)`

Expected project URL:

`https://krumiaa.github.io/lantern-player/`
