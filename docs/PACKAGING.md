# Packaging ViewDeck

`electron-builder.yml` configures the build. The output goes to `release/`, which is git-ignored.

| Command | Output |
| --- | --- |
| `npm run dist` | `release/ViewDeck-<version>-<arch>.dmg` and `-mac.zip` |
| `npm run dist:dir` | `release/mac-<arch>/ViewDeck.app` only. It is faster and good for smoke-testing a packaged build. |

## What goes into the bundle

- `out/**` holds the electron-vite build. `npm run dist` runs `npm run build` first, which includes the typecheck.
- **Runtime `dependencies` are only `pg` and the AWS SDK.** These are the only packages the main
  process `require`s. Every renderer library (React, Monaco, Radix and so on) is in `devDependencies`
  because Vite bundles it into `out/renderer`. Keep it that way: a renderer library moved into
  `dependencies` gets packed into `app.asar` a second time, which took it from 19 MB to 138 MB.
  To check, run `grep -ohE 'require\("[^".][^"]*"\)' out/main/*.js`.
- `extraResources` copies `resources/rds-global-bundle.pem` and `icon.png` to
  `Contents/Resources/`. `src/main/resources.ts` reads them from `process.resourcesPath` when
  `app.isPackaged`. TLS over SSM tunnels needs the CA bundle (invariant 8).

## Signing and notarisation (needs your Apple Developer account)

Without a certificate the app is **ad-hoc signed**. It runs on the machine that built it. On
other Macs, Gatekeeper blocks the first launch: right-click the app, choose Open, and confirm.

To ship it to other people:

1. Install a **Developer ID Application** certificate in your login keychain, or set `CSC_LINK` and
   `CSC_KEY_PASSWORD`. electron-builder picks it up automatically, and `hardenedRuntime: true` is
   already set.
2. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, then change `mac.notarize` to
   `true` in `electron-builder.yml`.
3. Run `npm run dist`, then check the result with `spctl -a -vv release/mac-arm64/ViewDeck.app`.

## Auto-update (not enabled)

`publish: null` is deliberate: nothing is uploaded until releases are set up (e.g. GitHub Releases). Two
things are needed before auto-update can work:

- **A signed build**, because Squirrel.Mac refuses unsigned updates.
- **A feed URL** that you host, for example an S3 bucket or an internal server
  (`publish: { provider: generic, url: … }`). Then add `electron-updater` and call
  `autoUpdater.checkForUpdatesAndNotify()` from `src/main/index.ts` after `app.whenReady()`.

Until then, update by installing a newer `.dmg`. Saved connections live in
`~/Library/Application Support/ViewDeck` and survive the reinstall.
