# Futula Coffee Scale Web

A BLE coffee scale companion app with timer and pour-over tracking. Installable as a PWA on Android.

Based on [FutulaCoffeeScale](https://github.com/wdrs/FutulaCoffeeScale) by wdrs, but fully rewritten in JavaScript (React) and works as a web app — no native build required.

## Features

- Connect to LFSmart / LEFU-CK811 BLE scales
- Real-time weight display with smooth interpolation
- Software tare
- Timer with start/stop/reset
- Target weight selection with pour-over guide lines (bloom, split-in-fives)
- Live weight/time chart during brewing
- Installable as a PWA (Android Chrome)

## Run locally

```bash
yarn install
yarn dev
```

## Deploy

Pushes to `main` auto-deploy to GitHub Pages via Actions.

Live at: https://oranginaround.github.io/FutulaCoffeeScaleWeb/
