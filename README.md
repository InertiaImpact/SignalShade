# SignalShade

**Individual precision. Collective control.**

A browser-based color control desk for AJA FS processors. Open the dashboard, allow LAN access, connect devices by IP, and bring your sources into balance. No cloud control server or installed bridge.

**Status: initial release / hardware integration experimental.** The simulated desk is implemented and tested. FS-family browser CORS, authentication, parameter mappings, and write/readback need qualification on actual hardware before production use. A supported model name is not a claim that every firmware can connect from a public HTTPS origin.

Open the dashboard: **https://inertiaimpact.github.io/SignalShade/**

## What works

- 32-channel workspace with processor-bound labels, search, custom ordering, compact cards, and favorite controls.
- Condensed channel cards with four Quick controls by default, inline label/value entry, themed sliders and end arrows. Proc Amp, RGB, and Legalizer tabs retain access to the full supported controls.
- Ctrl/⌘-click and drag selection, plus multiple overlapping saved gang groups, with a full-width shared console, parameter masks, relative trims, and absolute sets. Members clamp independently; individual edits stay local.
- Live command scheduling, verified hardware readback, per-channel locks, whole-desk UI lock, and per-member failure reports.
- Neutral resets at parameter, section, channel, group, or all-channel scope; enables are preserved unless requested.
- Color preset capture and recall with explicit target/section selection and preflight compatibility checks.
- Gesture-level undo, external-change conflict detection, JSON workspace backup/import, and automatic IndexedDB storage.
- Direct-IP connection diagnostics, opt-in bounded IPv4 scan, native descriptor review, and report export.
- Simulated FS4/FS2 fleet. Demo devices never issue network requests.
- Offline application shell after a successful first production load; operator-controlled updates.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. `npm test` runs the tests; `npm run build` checks TypeScript and generates `dist/`. `npm run preview` serves that build locally. Development servers are not production hosting.

## Connect hardware

1. Start an empty workspace from the **⋯** menu, or remove demo devices as needed.
2. Open **Add device**, enter a private IPv4 address and optional device label, then **Test connection**.
3. Allow local network access in the browser if prompted. Device CORS must separately permit readable API responses. Opening an AJA interface in another tab does not establish this permission.
4. Review identity, source context, color descriptors, native ranges, and current values. Add the device read-only only when all required checks pass.
5. On an off-air processor, enable writes from the device’s lock button, test a small change against the AJA interface, verify readback, and restore the starting value.

FS4, FS2, FS1-X, FS1, and FS-HDR are target models. Only recognized conventional SDR controls are mapped. FS-HDR Colorfront, LUTs, HDR transforms, routing, timing, audio, networking, factory reset, and whole-device presets are outside this release.

The initial hardware adapter deliberately displays descriptor-native numeric values. Nontrivial device scaling is labeled **native** rather than guessed. Some firmware descriptor names or response formats will need additional fixtures and an adapter update. Failure to identify model, context, or unambiguous controls leaves hardware read-only.

Authentication supports an optional session-only Basic Authorization header, subject to device preflight/CORS support. It does not promise support for digest, proprietary login sessions, or third-party cookies. HTTP does not encrypt credentials on the LAN. Exported reports/workspaces may contain your device addresses; keep them local.

## Operator notes

- **Customize cards:** choose up to eight Quick controls in Customize desk (four by default). Other controls are available through the card tabs. Restore default layout resets only the presentation preferences; labels, gangs, presets, and signal values stay intact. Layouts that previously hid all sections recover their tabs on load, and unsupported pins fall back to controls available on that channel.
- **Select channels:** click a channel header for one channel; Ctrl/⌘-click toggles membership. Drag from a header or empty grid space to select intersecting cards; Ctrl/⌘-drag adds to the selection. Escape clears a temporary selection. Selection never sends commands. Card controls always adjust that channel; the shared console explicitly adjusts the selected members. Save a temporary selection as a named gang when needed.
- **Sliders and arrows:** tracks and function tags share colors; numeric entry remains available. Arrows use the selected Fine/Normal/Coarse step. With mixed absolute group values, first enter or slide to a common value, or switch to Relative trim.
- **Relative trim:** add a delta to each group member’s current value. Offsets remain until a member reaches its limit; limiting is reported in Activity.
- **Absolute set:** set every member to the entered value, quantized and clamped for that device.
- **Enabled/bypassed:** corrections do not automatically turn a bypassed stage on.
- **Resets:** numerical Proc Amp/RGB parameters return to neutral; legalizer parameters use model defaults. This affects the active source-memory context only, not all stored input-format memories.
- **Undo:** restores this session’s previous values after checking targets, source context, and current values. External changes can block undo. Hardware group operations cannot be atomic; failures are reported, and successful members are not automatically rolled back.
- **Source identity:** labels follow processors, not physical inputs. Hardware source context is shown in native form until that firmware’s human-readable routing/status map is qualified.
- **Workspace:** export before clearing browser storage or moving computers. Import never reconnects, arms, or writes hardware automatically. Device credentials are never saved or exported.
- **One operator:** other tabs in the same browser profile are read-only. This cannot enforce ownership across computers, profiles, vendor UIs, or hardware panels.
- **Shortcuts:** `/` searches; `Ctrl/Cmd+Z` undoes an adjustment. Input edits commit on Enter or blur; slider adjustments are live. Fine/Normal/Coarse correspond to 1/5/10 native steps.

## GitHub Pages

The workflow tests and builds every push to `main`, then deploys the static artifact. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**. Pull requests run checks without deployment. The build uses the exact `/SignalShade/` base path; update `vite.config.ts` if the repository name changes.

No device configuration belongs in source control. The Pages host serves application assets only. Device requests go directly from the operator’s browser to the private device address and are never cached by the service worker. Application updates wait for operator selection or for existing tabs to close.

## Development and qualification

- [Architecture](docs/architecture.md)
- [Hardware qualification matrix and checklist](docs/hardware-qualification.md)
- [Adding an adapter](docs/adapters.md)

Reference material: [AJA FS4](https://www.aja.com/products/fs4), [AJA FS2](https://www.aja.com/products/fs2), [AJA FS-HDR](https://www.aja.com/products/fs-hdr), [AJA REST materials](https://www.aja.com/support/rest-api), and [Bitfocus AJA FS module](https://github.com/bitfocus/companion-module-aja-fs). The current Companion actions inspected were audio-oriented; this app does not claim their existence validates its color controls.

SignalShade is an independent project, not an AJA product or an AJA-certified control application.
