# Ctrl + Wheel Zoom

Hold **Ctrl** (or **⌘** on macOS) and roll the mouse wheel to zoom the whole Harness Web UI.
A page-zoom plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI, distributed as an ordinary
DSH **profile bundle**: no build step, no runtime dependency, plain ESM.

## What it does

| Gesture | Result |
|---|---|
| `Ctrl` / `⌘` + wheel | Zooms the page around the pointer, 50%–200%, in 10% steps |
| `Ctrl` / `⌘` + `+` / `-` | Same from the keyboard |
| `Ctrl` / `⌘` + `0` | Back to 100% |
| Zoom chip (bottom-right) | Appears whenever the level is not 100%: click the percentage to reset, click **Fit to width** to fit the window |
| Settings → General | A **Page zoom** row with the host's stepper pattern and a reset button |

The chosen level is remembered in the browser (`localStorage`), and every listener, stylesheet and
the applied `zoom` property are removed when the plugin is disabled or unloaded.

A gesture that another component already handled (`preventDefault()`, e.g. an embedded code editor
or map with its own `Ctrl`+wheel zoom) is never stolen.

## Install

Ask the Harness agent to install it, or call the plugin manager yourself with the package located
by absolute path, a tarball, or a published name:

```
plugin_manager  action: install_bundle
                target: <absolute path to this package / a .tgz / a published name>
```

`install_bundle` links the package into the active profile (`$DSH_PROFILE_DIR`), adds it to the
profile's bundle list, and the Harness applies it live. A page refresh picks up the browser half in
a page that was already open.

To install it by hand instead, add the package to the profile's dependencies and to
`dsh.profile.bundles` in `$DSH_PROFILE_DIR/package.json`, then restart the Harness.

## Uninstall

```
plugin_manager  action: remove_bundle
                target: dsh-ctrl-wheel-zoom
```

## Requirements

- A Harness Web GUI (the client half declares `platform: "web"`; it is inert without a browser).
- Nothing else: the package has no dependencies, no build output, and no install scripts. Built-in
  client modules (`react`, `@deepseek-ai/dsh-client-store`) come from the shell's own module table.

## Sharing and publishing

The package is self-contained, so there are three ways to hand it to someone else.

### 1. A tarball

```bash
pnpm pack                        # writes dsh-ctrl-wheel-zoom-1.0.0.tgz
```

Send that `.tgz`; the receiver installs it by path:

```
plugin_manager  action: install_bundle
                target: <path to dsh-ctrl-wheel-zoom-1.0.0.tgz>
```

(`pnpm pack` writes the tarball beside `package.json`. DSH's own runtime ships a pnpm, so nothing
has to be installed first.)

### 2. The directory (zip / repository)

Zip this folder (or push it to a Git repository) and have the receiver install the **unpacked
directory** by path — `install_bundle` accepts a directory, and a folder is enough because there is
no build step.

### 3. npm (install by name for everyone)

This manifest is already publishable: `name` is the unscoped `dsh-ctrl-wheel-zoom`, the row in
`cordis.patch.yml` names the same specifier, and there is no `"private": true`.

npm no longer issues long-lived "classic" tokens — they were permanently revoked on 2025-12-09 —
and publishing requires two-factor authentication. Pick one of the two ways through:

```bash
# A. A granular access token created with "Bypass two-factor authentication" enabled,
#    stored once as a credential:
#      //registry.npmjs.org/:_authToken=npm_...        in ~/.npmrc
pnpm publish --no-git-checks

# B. Any write token, with a one-time password supplied per publish:
pnpm publish --no-git-checks --otp=<6-digit code>
```

A token without bypass-2FA is refused with `403 ... Two-factor authentication or granular access
token with bypass 2fa enabled is required to publish packages`. Verify what a token can actually do
before blaming the command:

```bash
curl -H "Authorization: Bearer $TOKEN" https://registry.npmjs.org/-/npm/v1/tokens
#   "bypass_2fa": false   → use --otp, or recreate the token with the switch on
#   "permissions": [{"name":"package","action":"write"}]   → publishing is permitted at all
```

Note npm's stated direction: bypass-2FA tokens are on a path to removal (targeted for January 2027)
in favour of staged publishing or trusted publishing, so a long-lived automated release will need
one of those later.

Keep `name` in `package.json` and the `name:` line of `cordis.patch.yml` identical in every
release — the loader resolves the row through that specifier. Bump `version` for each release.

Afterwards anyone installs it by name:

```
plugin_manager  action: install_bundle
                target: dsh-ctrl-wheel-zoom
```

## Files

| File | Role |
|---|---|
| `index.js` | Host half: an empty `apply()`; the row exists so the bundle can be installed and toggled |
| `client.js` | Browser half: wheel/keyboard gestures, zoom state, chip and settings-row registrations, stylesheets |
| `cordis.patch.yml` | The loader patch that inserts the `ctrl-wheel-zoom` row |
| `locale/{zh,en}.json` | Plugin-card title/description text; the row's own copy lives in `client.js` |
| `icon.svg` | Plugin-manager card artwork |

## How the zoom works

Zoom is CSS `zoom` on the document element. It scales layout, text and fixed overlay layers
together exactly like the browser's own page zoom, while the app's own scroll containers keep
working — a `transform: scale()` wrapper cannot scroll its oversized content, and a font-size
change would only touch text.

The wheel listener is registered in the capture phase on `window`, so it sees the gesture before
the app's scroll containers and blocks them from scrolling while `Ctrl` is held. When the viewport
itself scrolls, the plugin re-anchors it so the content under the pointer stays under the pointer.

Both UI surfaces read one store instance shared with the gesture writer, so the chip, the settings
stepper and the wheel listener can never disagree about the current level.

## License

MIT — see [LICENSE](LICENSE).
