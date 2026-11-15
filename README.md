# SignalShade

**Individual precision. Collective control.**

A browser-based color control desk for AJA FS processors. Open the dashboard, allow LAN access, connect devices by IP, and bring your sources into balance. No cloud control server or installed bridge.

**Status: initial release / hardware integration experimental.** The simulated desk is implemented and tested. FS-family browser CORS, authentication, parameter mappings, and write/readback need qualification on actual hardware before production use. A supported model name is not a claim that every firmware can connect from a public HTTPS origin.

Open the dashboard: **https://inertiaimpact.github.io/SignalShade/**

For devices blocked by browser CORS, use the optional **[SignalShade Connect extension](extension/README.md)**. Download its ZIP from [GitHub Releases](https://github.com/InertiaImpact/SignalShade/releases/latest), unzip, and load it through Chrome's Developer mode. Device settings stay in SignalShade. This preview requires manual installation and updates; Chrome Web Store publication and hardware qualification are pending.

## What works

- 32-channel workspace with processor-bound labels, search, custom ordering, compact cards, and favorite controls.
- Condensed channel cards with four Quick controls by default, inline label/value entry, themed sliders and end arrows. Proc Amp and RGB tabs expose the supported controls; RGB defaults to a single Red / Green / Blue gain column with Gain, Black, and Gamma subtabs. Legalizer controls are hidden for now.
- Ctrl/⌘-click and drag selection, plus multiple overlapping saved gang groups, with a full-width shared console, parameter masks, relative trims, and absolute sets. Members clamp independently; individual edits stay local.
- Live command scheduling, verified hardware readback, per-channel locks, whole-desk UI lock, and per-member failure reports.
- Neutral resets at parameter, section, channel, group, or all-channel scope; enables are preserved unless requested.
- Color preset capture and recall with explicit target/section selection and preflight compatibility checks.
- Gesture-level undo, external-change conflict detection, JSON workspace backup/import, and automatic IndexedDB storage.
- Unified device manager, direct-IP connections, bounded IPv4 scanning, model-specific demos, and combined debug ZIP export.
- Simulated FS4/FS2 fleet. Demo devices never issue network requests.
- Offline application shell after a successful first production load; operator-controlled updates.
- Compact top-bar monitoring for HELO, HELO Plus and Ki Pro, with recording duration, storage details, Record/Stop, and simulation. Hardware qualification is pending.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. `npm test` runs the tests; `npm run build` checks TypeScript and generates `dist/`. `npm run preview` serves that build locally. Development servers are not production hosting.

## Connect hardware

1. Choose **New workspace** from the workspace dropdown and start with an empty setup, or keep Studio A to try the demo.
2. Open **Manage connections**, enter a private IPv4 address and optional device label under **Add by IP**, then connect. You can also scan and add an identified AJA device. Scan results show its configured system name alongside the model and IP when readable; Add uses that name as the default label. Missing names fall back to model/IP, and existing labels are preserved.
3. Allow local network access in the browser if prompted. Device CORS must separately permit readable API responses. Opening an AJA interface in another tab does not establish this permission.
4. SignalShade reads the device identity, available color descriptors, native ranges, and current values, then adds its mapped controls. Hardware test-history labels do not gate controls.
5. Use the device’s **Lock control** button or channel/desk locks to pause adjustments. For an initial check, make a small change against the AJA interface, verify readback, and restore the starting value.

FS4, FS2, FS1-X, FS1, and FS-HDR are target models. Only recognized conventional SDR controls are mapped. FS-HDR Colorfront, LUTs, HDR transforms, routing, timing, audio, networking, factory reset, and whole-device presets are outside this release.

The initial hardware adapter displays descriptor-native numeric values. Nontrivial device scaling is labeled **native** rather than guessed. Some firmware descriptor names or response formats will need additional fixtures and an adapter update. A missing model or ambiguous control mapping prevents connection; absent optional source metadata does not disable mapped controls. Original FS1 firmware 2.2.2.1 uses its legacy `/json` interface for five Proc amp controls; RGB is not exposed on that model. These mappings replay captured responses and use native firmware ranges.

Authentication supports an optional session-only Basic Authorization header, subject to device preflight/CORS support. It does not promise support for digest, proprietary login sessions, or third-party cookies. HTTP does not encrypt credentials on the LAN. Exported reports/workspaces may contain your device addresses; keep them local.

## Operator notes

- **Frame syncs** reconnect automatically on reload. Explicitly enabled writes can resume in the same tab after fresh readback and matching model, firmware and control definitions. New connections start read-only. Locks and unconfirmed writes prevent automatic write enablement. Devices that require session credentials may need a manual reconnect.
- **Recorders** appear in the top bar with recording state, duration and an attention indicator. Select the recording count to compare recorders and their storage destinations in the overview, or select a recorder to open its device settings. Enable control per recorder after connecting. Stop requires a second click within four seconds. Reconnect and reload never resume recording commands. Removing a recorder leaves its physical transport running.
- **Recorder compatibility:** the browser adapter uses the selected recorder family’s state and Record/Stop command descriptors. Missing optional identity/firmware data or differing English enum labels do not disable control. Actual missing commands or incompatible numeric limits are reported. Media fields come from device descriptors; only known units are normalized, and missing metrics show as unavailable. Clip duration may reset when files segment; `~` duration estimates an observed start. See the [implementation review](docs/implementation-review.md).
- **Recorder authentication:** an optional password uses AJA session-cookie login, retained only for the connection. AJA CORS and the browser's cross-origin cookie policy must allow this. Authentication expiry requires reconnecting; transport commands are never automatically retried.

- **Customize cards:** choose up to eight Quick controls in Customize desk (four by default). Other controls are available through the card tabs. Restore default layout resets only the presentation preferences; labels, gangs, presets, and signal values stay intact. Layouts that previously hid all sections recover their tabs on load, and unsupported pins fall back to controls available on that channel.
- **Select channels and gangs:** click a card header for one channel or gang; Ctrl/⌘-click combines gang cards, sidebar gangs and individual channels. Overlapping members adjust once, and gang masks combine per channel. Drag from a header or any non-interactive channel-pane background, including outside the card grid, to select intersecting cards; Ctrl/⌘-drag adds to the selection. Controls, the gang console, scrollbars, and touch scrolling retain their normal behavior. Escape or Clear selection beside the main heading clears the selection. Selection never sends commands. Card controls always adjust that channel; the shared console explicitly adjusts the selected members. Save a temporary selection as a named gang when needed.
- **Color grouping:** control sections use open, labeled groups without inner boxes or tinted backgrounds. RGB sliders retain their red/green/blue identity. Saved gangs use their chosen color on the shared header, selected member borders, and membership tags.
- **Views and gangs** each keep their own card order. Drag a card’s grip or focus it and use an arrow key. A gang view starts with its shared controls card. The sidebar switches show which gang cards belong to the current view and let you add or remove them there. The shared card controls the gang’s full membership and respects its parameter mask.
- **Converge:** Small/Large steps close 5%/20% of each numeric control’s remaining gap to its group median, independently of Relative/Absolute mode. Available for two or more selected channels or gang members; applies across supported numeric color settings, including those outside the current card tab, within gang masks. Native rounding carries between clicks. Stage enables remain unchanged, all-Off stages are skipped, and each click groups confirmed changes into one Undo action.
- **Golden camera:** mark a channel with its target icon to converge toward its current settings, leaving the reference unchanged even when selected. The target is saved with the workspace. Clear target beside the page heading returns to median convergence; Clear selection leaves the target intact. Unavailable reference devices must reconnect or be cleared before Converge can proceed.
- **Sliders and arrows:** tracks and function tags share colors; numeric entry remains available. Arrows use the selected Fine/Normal/Coarse step. Interactive inputs are ignored while any target device is busy, so clicks never build up. An accepted gang step still applies once to each member. With mixed absolute group values, first enter or slide to a common value, or switch to Relative trim.
- **Relative trim:** shared sliders show one tick per member on the full parameter range, including in gang cards. Ticks extend down from the track center below the grip. The handle starts at the group center and trims members together; ticks follow current readbacks, with matching values overlapping. Arrow nudges retain Fine/Normal/Coarse steps. The entry shows “Trim” at rest and a signed live offset while dragging; typed offsets still apply with Enter. Add a delta to each group member’s current value. Offsets remain until a member reaches its limit; limiting is reported in Activity.
- **Absolute set:** set every member to the entered value, quantized and clamped for that device.
- **Enabled/bypassed:** stage controls use On/Off buttons. Groups show Off / Mixed / On, with one tick per member under its current setting. Mixed is a read-only status; On or Off sets the whole target. Tick counts update from readbacks, and missing values are not counted as Off. When every target is Off, that stage’s numeric controls gray out until enabled; clicking one briefly highlights its Off toggle to point to the enable control. Mixed adjustments pulse the whole Off / Mixed / On control: stored values still change for Off members, but their picture remains bypassed. The pulse respects reduced motion. Corrections do not automatically turn a bypassed stage on.
- **Demo reminder:** adjusting or changing a demo processor or recorder pulses the top DEMO/MIXED badge. Its tooltip names the simulated targets. Background polls and live-only changes do not pulse it; reduced motion uses a brief static outline.
- **Quick stage controls:** compact Proc amp/RGB toggles appear above Quick sliders for the stages those sliders use. They retain member ticks and mixed/bypass feedback without switching tabs. Gang masks still govern whether the enable buttons can be changed.
- **Resets:** numerical Proc Amp/RGB parameters return to neutral; Legalizer values are left unchanged while its controls are hidden. This affects the active source-memory context only, not all stored input-format memories.
- **Undo:** restores this session’s previous values after checking targets, source context, and current values. External changes can block undo. Hardware group operations cannot be atomic; failures are reported, and successful members are not automatically rolled back.
- **Source identity:** labels, groups, locks and layout follow processors, not physical connectors. Routing changes refresh native color values without resetting or reapplying them. A queued adjustment is cancelled if its source context changes.
- **Debug:** use **Download debug ZIP** in Devices for the current workspace, recorder status, scan/probe results and recent requests in one package. Credentials are redacted; addresses and labels remain included. Session diagnostics stay available when the manager is closed and reopened.
- **One-scan diagnostics:** after an add or reconnect attempt, choose **Diagnostic QR** in Devices or beside its error. The code opens a mobile page with a short, copyable summary of the selected device attempt: firmware, Connect version, descriptor counts and key failures. The code is generated locally and does not contain LAN addresses, credentials, raw responses or workspace data. It uses the URL fragment to carry the summary without sending it to a server.
- **FS-HDR 4.3.3.3:** update SignalShade Connect to 0.4.2 and reconnect. SignalShade reads the operating mode and the device's input map to expose only the active processors and conventional Proc Amp/RGB controls. It does not change operating mode, routing, Colorfront or LUT settings. A real conflict in an active descriptor is still reported rather than guessed.
- **Workspaces** keep their devices, views, gangs, and presets separately in this browser. The top dropdown switches setups and exports the current one. Import adds a separate workspace without connecting to its hardware. Device credentials are never saved or exported.
- **Workspace QR** is available below **Export workspace**. Open each scanned link in the same browser on the receiving device. For larger workspaces, scan the numbered codes in any order, then continue to import. Codes contain the setup, including device addresses, and are generated locally. Use JSON export if the setup exceeds 32 codes.
- **Read-only connection:** adding or reconnecting a live processor reads its current settings. Choose **Enable writes** in its device details before making adjustments. A device with no verified color mapping remains available for monitoring.
- **One operator:** other tabs in the same browser profile are read-only. This cannot enforce ownership across computers, profiles, vendor UIs, or hardware panels.
- **Shortcuts:** `/` searches; `Ctrl/Cmd+Z` undoes an adjustment. Input edits commit on Enter or blur; slider adjustments are live. Fine/Normal/Coarse correspond to 1/3/6 native steps.

## GitHub Pages

The workflow tests and builds every push to `main`, then deploys the static artifact. In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**. Pull requests run checks without deployment. The build uses the exact `/SignalShade/` base path; update `vite.config.ts` if the repository name changes.

No device configuration belongs in source control. The Pages host serves application assets only. Device requests go directly from the operator’s browser to the private device address and are never cached by the service worker. Application updates wait for operator selection or for existing tabs to close.

## Development and qualification

- [TODO](TODO.md)
- [Architecture](docs/architecture.md)
- [Interface references](docs/interface-references.md)
- [Hardware qualification matrix and checklist](docs/hardware-qualification.md)
- [Adding an adapter](docs/adapters.md)

Reference material: [AJA FS4](https://www.aja.com/products/fs4), [AJA FS2](https://www.aja.com/products/fs2), [AJA FS-HDR](https://www.aja.com/products/fs-hdr), [AJA REST materials](https://www.aja.com/support/rest-api), and [Bitfocus AJA FS module](https://github.com/bitfocus/companion-module-aja-fs). The current Companion actions inspected were audio-oriented; this app does not claim their existence validates its color controls.

SignalShade is an independent project, not an AJA product or an AJA-certified control application.
