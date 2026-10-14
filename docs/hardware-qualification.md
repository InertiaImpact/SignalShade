# Hardware qualification

No physical device was available during initial implementation. All hardware integrations are **experimental / unqualified** until the following tests are recorded against the deployed Pages origin.

| Model        | Browser CORS/auth | Descriptor mapping | Source context | Write/readback | Production status |
| ------------ | ----------------- | ------------------ | -------------- | -------------- | ----------------- |
| FS4          | Not tested        | Not tested         | Not tested     | Not tested     | Unqualified       |
| FS2          | Not tested        | Not tested         | Not tested     | Not tested     | Unqualified       |
| FS1-X        | Not tested        | Not tested         | Not tested     | Not tested     | Unqualified       |
| FS1          | Not tested        | Not tested         | Not tested     | Not tested     | Unqualified       |
| FS-HDR (SDR) | Not tested        | Not tested         | Not tested     | Not tested     | Unqualified       |

## Test on an off-air channel

1. Record device model, firmware, mode, browser/version, origin, authentication state, and network topology. Do not attach passwords or live show configuration to a public issue.
2. From `https://inertiaimpact.github.io/SignalShade/`, grant LAN access and run the connection tester. Confirm identity, descriptor reads, parameter get calls, and any required preflights work without browser flags or security bypasses. Test denied permission as well.
3. Compare every exposed control’s name, processor, native range, step, units, default, and enable dependency with the AJA interface. Keep scaling native until its formula is proven with multiple points.
4. Record a baseline. Enable writes, adjust one native step, verify the AJA UI and signal response, check dashboard readback, then restore the baseline. Repeat for enables and every writable parameter.
5. Confirm processor/source-memory binding. Test input, format, and operating-mode changes while idle and during an adjustment. Stale-context commands must not silently land on a newly selected source memory.
6. Repeat in supported single/four-channel modes; omitted or duplicate descriptors must leave controls locked. On FS-HDR, verify the intended SDR pipeline without changing Colorfront/LUT/HDR settings.
7. Test front-panel edits, vendor-UI edits, loss of signal, unplugged Ethernet, interrupted set responses, reboot, reconnect, stale reads, and partial group failure. Pending operations must not replay after reconnect.
8. Test groups across devices, differing native resolutions, limit saturation, masked resets, preset incompatibility, and undo conflicts. Confirm original values and enable states are restored as intended.
9. Load 32 channels and measure actual input-to-confirmed-readback latency, polling freshness, device request load, and any timeout behavior. Tune only with measured evidence and update tests.
10. Test offline app reopening after first load, update availability without forced reload, export/import, and a second tab opening read-only.

Export the diagnostic report for local review. It includes device addresses and browser details. A failed fetch is not enough to distinguish CORS, permission, routing, and authentication; inspect the browser network panel and device logs locally. If firmware does not permit cross-origin reads, the no-install browser architecture cannot control it without a change to the device or deployment approach.
