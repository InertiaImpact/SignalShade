# SignalShade Connect (preview)

Connects the hosted SignalShade dashboard to AJA devices whose REST endpoints are blocked by browser CORS. No bridge server or browser security flags are required. This release is an unpacked Chrome extension, not yet a Chrome Web Store extension. Real-hardware qualification is still required.

## Install

1. [Download signalshade-connect.zip](https://github.com/InertiaImpact/SignalShade/releases/latest/download/signalshade-connect.zip) from the latest release.
2. Extract it to a permanent folder (for example, Documents/SignalShade Connect). Keep this folder after installation.
3. Open `chrome://extensions` in Chrome. Enable **Developer mode**.
4. Click **Load unpacked** and choose the extracted folder containing `manifest.json`.
5. Reload [SignalShade](https://inertiaimpact.github.io/SignalShade/). Open Devices or Recorders and connect your device.
6. For a new device, approve its address in the embedded SignalShade Connect panel and Chrome's permission prompt. Testing continues automatically; no separate popup or second Connect click is needed. Already approved devices skip this step.

Recorder control initially requires the Enable control checkbox. That choice survives temporary network loss and reloads in the same tab, but is effective only after fresh verified status. Uncertain command failures clear it. Configured recorders resume monitoring after reload; turn off **Reconnect on load** in their settings to opt out. Passwords are not saved; devices requiring a new login may need a password on reconnect. Approval does not start or stop recording. The extension can only reach devices on your computer's network/VPN. Some managed browsers prohibit unpacked extensions; contact your IT administrator rather than disabling browser security.

The extension has no device settings. All addresses and controls remain in SignalShade. Its content relay is limited to the production SignalShade URL. Local development builds are deliberately not supported by the distributed manifest.

## Update / remove

Download the new ZIP, replace the files in the **same folder**, click the extension's Reload button at `chrome://extensions`, then reload SignalShade and reconnect. Finish pending commands before updating. Unpacked extensions do not update automatically. Chrome may assign a different extension ID if moved; the dashboard discovers it through its packaged content relay and does not require the ID to be entered.

Remove device host permissions through the extension's Chrome Details / Site access screen. To remove all access and local grant metadata, uninstall the extension. Removal stops dashboard communication; it does not stop a physical recording.

## Current scope

- Per-host Chrome grants plus exact scheme/host/port approval; RFC1918 IPv4 devices only.
- HELO / HELO Plus / Ki Pro descriptor and status reads, AJA login, and descriptor-verified Record/Stop writes.
- FS descriptor/status reads and supported Proc amp/RGB shading writes. Legalizer and other configuration writes are excluded.
- Read-only direct connection remains available when the extension is absent. An adapter selects one route at creation; reload/reconnect after installing or removing the extension.
- Writes are not replayed after failure. Recent write ownership prevents simultaneous writes from another tab for 30 seconds. After a service-worker restart, the extension automatically rediscovers descriptors through reads before validating a new write.
- FS discovery tries `/desc.json`, then the documented legacy `/descriptors?paramid=*` only for HTTP 404/410. Legacy value reads explicitly request JSON. This is based on AJA's [REST Automation archive](https://www.aja.com/support/item/9619); exact FS1 firmware behavior still needs a new field test.
- Known limitations: hardware/browser authentication qualification pending; background-tab timers may be throttled; no persistent multi-tab control lease UI yet. Never use the extension as evidence that a model is hardware-qualified.

## Build

Run `npm run test:extension` and `npm run build:extension` from the repository. The build creates `.artifacts/signalshade-connect.zip`, `.artifacts/signalshade-connect.sha256`, and an unpacked folder. No signing key, credentials, device export, HAR, or node_modules is packaged.

Release workflow: push an `connect-v*` tag; GitHub Actions runs tests/build and attaches the ZIP/checksum to a GitHub release. Store submission will follow separate browser/hardware validation and privacy review.

See [privacy](PRIVACY.md) and [design](../docs/chrome-extension-bridge-plan.md).
