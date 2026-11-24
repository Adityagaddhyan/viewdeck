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

## Signing

Builds are **ad-hoc signed** (`mac.identity: '-'` in `electron-builder.yml`), and both
architectures pass `codesign --verify --deep --strict`. A valid ad-hoc signature matters: a
downloaded app with no signature, or a broken one, gets macOS's misleading "ViewDeck is
damaged" error. With ad-hoc signing users get the normal "can't verify the developer" prompt
and approve it once in **System Settings → Privacy & Security → Open Anyway**. Hardened
runtime is off, because with an ad-hoc identity it can break library validation at launch.

To remove the prompt entirely (needs an Apple Developer account):

1. Install a **Developer ID Application** certificate in the keychain (or set `CSC_LINK` and
   `CSC_KEY_PASSWORD`; in CI, as repository secrets).
2. In `electron-builder.yml`, remove `identity: '-'` and set `hardenedRuntime: true` and
   `notarize: true`. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
3. Check with `spctl -a -vv release/mac-arm64/ViewDeck.app`.

## Releasing

`.github/workflows/release.yml` runs on a `v*.*.*` tag:

```sh
npm version 0.2.0 --no-git-tag-version && git commit -am "chore: release 0.2.0"
git tag v0.2.0 && git push origin main v0.2.0
```

It checks that the tag matches `package.json` and runs `npm run verify`. It then builds the
`.dmg` and `.zip` for arm64 and x64, verifies the signatures and publishes a GitHub Release
with the files and `SHA256SUMS.txt`. Then update the Homebrew cask:
`node scripts/bump-cask.mjs 0.2.0 ../homebrew-tap`, commit and push in the tap repo.

## In-app updates

ViewDeck updates itself from GitHub Releases (`src/main/update/`, see ARCHITECTURE.md
"Updates"). It downloads the arch's `.zip`, verifies it against `SHA256SUMS.txt` and its code
signature, and swaps the bundle after quit. That needs no Developer ID, unlike
Squirrel/electron-updater. Release assets must keep the names electron-builder produces
(`ViewDeck-<v>-<arch>-mac.zip`) and the checksum file, or one-click updates fall back to the
download link. Saved connections live in `~/Library/Application Support/ViewDeck` and
survive updates.
