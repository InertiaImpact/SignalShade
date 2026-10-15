# Recorder implementation and code review

## Delivered

- One optional 90 px recorder row beneath the existing header. A fixed overview retains recording and attention counts even while capsules scroll horizontally. Channel and gang controls retain their open layout and established palette.
- Recorders settings: label, address, model, order, warning threshold, session-only control enable, reconnect, remove and status export. Configurations are optional in version-1 workspaces; existing files still load. Runtime state, passwords, pending commands and enabled controls are excluded from persistence.
- Separate recorder adapter/store/UI modules. Recorder monitoring and command failure do not occupy the FS color queue or Undo history. The existing browser ownership lock and desk lock guard both subsystems.
- HELO-family record-only command values 1/2 and Ki Pro transport values 3/4, permitted only after matching model identity, state and command descriptors. No streaming, formatting, eject, routing or encoder writes are implemented.
- Preflight refresh, per-recorder serialization, duplicate-click suppression, status confirmation, uncertain-result reconciliation without replay, and inline Stop confirmation. Ki Pro gets a second Stop only following fresh Paused readback. Unconfirmed transitions disable control.
- Poll targets: one second recording, two seconds idle, five seconds media; failed appliances back off to 30 seconds. Four optional metric reads per appliance batch; at most two appliances poll concurrently, with the most overdue first. Browser timers and device response speed affect actual cadence.
- Per-metric failures preserve the last value with a warning and timestamp. Missing values remain unknown. Explicit SD/USB/slot/PAK/network labels group related metrics, with unresolved metrics retained under their original labels. Unknown roles are not called backup or rollover. Missing capacity/time is not synthesized from percentage.
- Device `RecordingDuration` is displayed as clip duration; an observed start can provide a clearly marked estimate when that field is absent. Reconnecting mid-record does not invent a start time. Offline/stale timers freeze.
- Simulation supports recording and stopping with three media destinations. Fault cases use injected adapter tests rather than extra controls in the production UI.

## Review of existing implementation

Reviewed the FS adapter, command queue, polling, persistence/import validation, undo/presets/resets, gang/card controls, selection handling, layout recovery, service worker/update path, dialogs and theme integration. Retained the existing architecture; avoided a broad visual or CSS rewrite during the recorder addition.

Corrected:

1. **AJA response identity:** numeric `paramid` plus matching symbolic `name` is valid AJA output. FS numeric reads now accept it while continuing to reject unrelated parameters.
2. **Desk lock enforcement:** the lock previously disabled UI controls only. The store now checks it when accepting edits and immediately before a queued FS write, as well as recorder preflight/continuation.
3. **Obsolete refresh completion:** an old FS read could finish after workspace replacement or reconnection. Generation and adapter checks discard those results/errors.
4. **Gang order:** editing a saved gang used to move it to the end. Saves now replace it in place.
5. **Legalizer exclusion:** UI filtering already hid Legalizer. Reset and preset command paths now enforce that boundary too.
6. **Dialog focus:** links and disclosure summaries participate in the keyboard focus loop.
7. **Update activation:** Load update is disabled during pending recorder transport, as it already was for FS writes.

Automated coverage includes the existing color/gang/selection/layout/persistence/offline tests plus recorder serialization, lock changes during preflight, concurrent poll/click, timeout ambiguity, Ki Pro pause-to-stop, stale stop confirmation, missing media fields, cookie request behavior, command mapping and legacy imports. API fixtures are synthetic, based on published examples; they are not hardware captures.

## Qualification limits

This is an implemented browser feature, not certification of every AJA recorder or firmware. No physical hardware was available. The model selector includes the requested families and legacy Ki Pro variants so configuration is extensible; its presence is not a tested-support claim. A model/firmware with unmatched identity/enums cannot be armed.

The adapter discovers exposed media descriptors. It cannot promise every physical disk, backup role, remaining-time field or multichannel mapping until captured responses establish those meanings. Missing metrics stay unavailable. Device-wide Ki Pro control is labeled as affecting all enabled recording channels. The requested scope is all Ki Pro models; qualification must cover their firmware differences rather than narrowing the model selector to one appliance.

Direct HTTPS-page-to-LAN requests depend on browser local-network permission, device CORS, and (when authenticated) cookies. A successful Companion integration does not establish browser compatibility. A local bridge may be needed for firmware that cannot expose readable responses to this origin; none is bundled in this release.

Remaining off-air checks: linked HELO stream behavior, media reserves and rollover/parallel failure, clip segmentation, actual Ki Pro pause/finalization timing, externally restarted recordings between polls, authentication expiry, and sustained simultaneous FS/recorder load. Software cannot identify an unseen stop/restart between polls when the firmware exposes no stable recording identity.

## Mapping references

- [AJA HELO transport and authentication](https://gitlab.aja.com/pub/rest_api/-/blob/master/HELO/03_HELO_Commands.md)
- [AJA Ki Pro GO transport](https://gitlab.aja.com/pub/rest_api/-/blob/master/KiPro-GO/04_Ki-Pro-GO_Commands.md)
- [AJA Ki Pro Ultra transport](https://gitlab.aja.com/pub/rest_api/-/blob/master/KiProUltra/05_Ki-Pro-Ultra_Commands.md)
- [AJA Ki Pro Ultra Plus / Ultra 12G transport](https://gitlab.aja.com/pub/rest_api/-/blob/master/KiProUltraPlus_KiProUltra12G/06_KPUP_KPU12G_Commands.md)
- [Companion HELO source](https://github.com/bitfocus/companion-module-aja-helo): duration/current-media fields and HELO Plus command parity reference.
- [Companion Ki Pro source](https://github.com/bitfocus/companion-module-aja-kipro): numeric transport states and current-media percentage reference.

No Companion source code was copied into the implementation.

## Verification results

- Production build and 71 automated tests pass, including command-mapping fixtures for all ten model selections. These fixtures verify software behavior, not real-device compatibility.
- Browser checks passed for simulated Record, inline Stop confirmation, three simultaneous recorder configurations, all-media details, low-time warnings and their aggregate count, and desk-lock enforcement for both recorder and color controls.
- A channel adjustment and Undo worked independently while a simulated recorder ran. Reload retained all three recorder configurations and returned their controls to disabled.
- A 390 px viewport kept page content within the viewport; the recorder row scrolls horizontally. The normal viewport was restored after testing.
