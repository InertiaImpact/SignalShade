# Recorder implementation and code review

## Stage state controls — 0.4.3

Proc amp and RGB enable dropdowns are now segmented On/Off controls, including native boolean enums. Multi-member targets add a read-only Mixed position and show a tick for each member under its current Off or On setting. Unknown values remain uncounted and show an unavailable indicator when a real On/Off mix is not established. Button actions always send explicit absolute On/Off values; Mixed sends no command, selecting the existing uniform state is a no-op, and counts do not move until readbacks update. Non-boolean enums retain their native dropdowns. Compact cards give stage controls a full row, and tick rows reserve stable space as members change state.

Coverage includes boolean/enum/numeric stage descriptors, live distribution changes, unavailable values, locks, no-op selection and unchanged multi-setting controls. An isolated browser demo confirms a 1-off/9-on split, group Off/On applied to all 10 members, and the same tick display in compact gang cards and narrow/wide layouts. No physical device commands are sent by those checks.

## Relative group member positions — 0.4.2

Shared numeric sliders in relative mode show one non-interactive tick per readable member, in both gang cards and expanded controls. Ticks use the union of compatible native ranges, share the slider’s thumb travel, and update from channel readbacks. Coincident values overlap rather than being displaced to invented positions. The shared handle starts at the quantized group mean; its origin stays fixed throughout each gesture while successive changes dispatch incremental relative trims. This avoids mixing absolute member positions with the previous centered delta scale or allowing asynchronous readbacks to change the trim amount during a drag. Individual relative controls and absolute controls retain their existing behavior. Arrow step multipliers, store locks, device clamping and undo grouping are unchanged.

DOM regressions cover tick positions, compact cards, differing compatible limits, readback updates during a gesture, incremental commands with one undo gesture, limits, arrows, absolute mode and unsupported controls. Headless browser checks use an isolated demo workspace and local built assets; no physical device requests are issued.

## Scan device names — 0.4.1

After web identification confirms an AJA interface, discovery reads its configured system name using the known `SysName`/`SystemName` fields. Original FS1 uses its legacy `/json` endpoint. Optional reads have a shared 1.8-second budget and follow scan cancellation; blank, mismatched, malformed or inaccessible values leave the device discoverable. Results retain model/IP and use the reported name as the initial label only when adding. Scans never rename existing devices or change processor labels/settings.

Connect adds one legacy name read without widening writable parameters or permissions. Its optional name read is excluded from the seven shading/status reads used to authorize legacy FS1 control. Tests cover device families, fallback, timeouts, unrelated web pages, display/default labels, retained custom labels, and legacy read/write boundaries.

## Unified devices and field-report fixes — 0.4.0

Devices now manages FS processors and HELO/Ki Pro recorders together, with a larger device list, model-specific demos, connection controls, and compact recorder storage rows. HELO results from a scan enter the recorder adapter instead of the FS probe. Add and scanning remain independently cancellable. A single debug ZIP gathers workspace, recorder snapshots, probe/scan results and bounded recent request traces; credential fields are redacted before storage/export. Diagnostics survive closing the dialog within the session.

The original FS1 adapter recognizes its AJA admin identity, requires seven successful native reads, and maps five bounded Proc amp parameters through `/json`. Native ranges and steps were checked against firmware 2.2.2.1 metadata and the [AJA operation guide](https://www.aja.com/support/item-download/6617/AJA_FS1_Manual_2.2.2.1r2.pdf). The dashboard and extension share this map; the worker rechecks it after restarting. Source/routing writes remain excluded. Reduced readback fixtures omit device addresses; supplied reports and vendor binaries remain ignored local files.

Processor identity is independent of the physical input. Labels, groups, locks and layout remain attached when routing changes. Refresh adopts native values without writing, including while locked. An adjustment queued against an old source is cancelled without disconnecting the device; the next refresh reads the new context. No automatic resets or color reapplication occur.

HELO optional polling is limited to recording destinations, media mount/capacity/space and physical storage status. Duplicate descriptors and unrelated stream URLs, clip deletion fields and internal state no longer create media cards or repeated read failures. Empty optional metrics stay unavailable; missing units/time are not guessed. Known main/backup byte fields are normalized, inactive destinations are not low-space warnings, and optional failures do not retain stale capacity.

Validation: 110 dashboard tests, 9 extension tests, TypeScript/Vite build and extension packaging passed. Coverage includes captured FS1 readbacks, native write bounds and worker restart, processor routing without writes, scan/Add concurrency, recorder dispatch, demo selection, ZIP round trips/redaction, and HELO storage filtering. No physical equipment commands were sent during development.

## FS2 field reports and scan concurrency — 0.3.3

The supplied FS2 tables repeat the same native IDs and enumerate saved memories for SDI, HDMI, fiber and analog inputs. The old processor expression also missed the `Vid2YUV…` form, combining both processors into one group. Shared dashboard/extension normalization now deduplicates equivalent definitions and exposes the known unsuffixed active aliases for matching bank families. Conflicting bank semantics remain an explicit mapping error. The adapter reads each active alias before adding a channel, recognizes `FS2_R`, and handles bank-resolved readback names without accepting another processor’s response. Source selection/format metadata are scoped to their processor, including `Video1 Input` and `Video2 Input`. Tests replay a reduced, non-sensitive descriptor fixture from the field report, verify both processors and source-change rejection, and confirm refreshed controls still use active aliases. The complete supplied tables also normalize without conflicts. No writes were sent to physical equipment during development.

Scanning and connection now have independent state and cancellation. Once scan access is approved, Add and Reconnect remain available during scanning. Add-by-IP also reuses a matching range grant; a successful probe promotes only the added device’s grant. Three React DOM regression tests cover Add completion during an unfinished scan, stopping a scan without cancelling Add, and cancelling Add without stopping the scan. The DOM environment is a development dependency only. Worker read deadlines leave a response margin before dashboard timeouts; only write timeouts describe uncertain command outcomes.

Validation: 99 dashboard tests, 7 extension tests, TypeScript/Vite build and extension packaging. The original FS1 still requires a legacy shading adapter; these new connection reports are FS2 units and do not contain new original-FS1 readbacks. Its diagnostic parser now also recognizes selected-option arrays. AJA’s [FS1 support downloads](https://www.aja.com/products/fs1) and [REST reference](https://www.aja.com/support/item/9619) were consulted; downloaded binaries/reference files remain local ignored artifacts and are not included in builds or commits.

## Operator controls and extension updates — 0.3.2

Device dialogs now keep extension download and install/update links visible outside collapsed help, including when Connect is installed. Connect 0.3.2 opens its own `chrome://extensions/?id=…` entry through a fixed worker action restricted to the trusted dashboard; older builds offer a copyable address. No additional extension permission is requested. Worker coverage checks trusted and rejected senders and ensures a supplied arbitrary URL cannot replace the fixed destination.

Hardware-test history no longer appears as an operator warning or capability gate. Connected FS controls are enabled when mappings and reads succeed; optional source metadata is not a prerequisite. Existing source-context checks still apply when that metadata is exposed. Recorder capabilities use known family command values and exposed numeric limits rather than exact identity/English labels. Optional firmware reads cannot block transport. Cross-model presets use parameter semantics/ranges instead of a blanket model restriction. Locks, failed reads, missing mappings, write/readback checks and uncertain-command handling remain. Original FS1 legacy control still needs an implementation, rather than a qualification override. Validation: 94 dashboard tests, 6 extension tests, production build and extension packaging.

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

# Connection follow-up — 2026-10-15

v0.3.1 addresses a field report from an FS unit whose descriptor response exceeded 4 MiB. Descriptor endpoints allow 32 MiB; ordinary status and web-page responses stay at 4 MiB, below Chrome's 64 MiB extension-message ceiling. Regression coverage accepts a 5 MiB descriptor response and rejects the same size for a status read. Scan candidates now require identified AJA branding and the UI excludes unrelated HTTP responses.

The original FS1 is identified by its `AJA Video - FS1 Admin: Main` title, with user-reported firmware 2.2.2.1. Inspection of the official [AJA firmware package](https://www.aja.com/support/item/1284) shows the legacy `/json` handler and native Proc Amp IDs. No firmware or vendor web code is redistributed. Failed descriptor probes on an identified original FS1 now collect seven diagnostic reads (source, input format, Proc Amp enable/gain/black/hue/saturation) through that handler. The extension rejects legacy writes and all unrelated legacy IDs. This does not enable shading; field response fixtures and verified ranges are still required. Tests at this revision: 92 dashboard + 6 extension; both builds pass.

v0.3.0 corrects the scan's two false-negative causes: it previously required pre-existing per-device grants and only tried `desc.json`. An exact-host-list range approval now grants temporary read-only scan authority; web identity discovery lists older units independently of descriptor availability. Adding is an explicit API verification and individual-grant promotion, followed by a read-only desk connection. Background reads cannot promote scan grants to write authority. The Devices UI now has three stable sections and performs Add/reconnect to completion after approval, keeping results/errors visible. Descriptor reads allow 20 seconds while discovery uses short page reads. The FS1's missing descriptor API remains a hardware/protocol qualification issue, not a permission failure. Tests: 87 dashboard + 6 extension, including full 254-address scheduling and scan/write isolation.

SignalShade Connect v0.2.0 embeds device approval in the dashboard and resumes the explicit connection action afterward. Background polls never open approval windows. Device HTTP errors no longer dispatch approval help. The FS1 field report showed 404 on the modern descriptor endpoint; the FS adapter now tries AJA's documented `/descriptors?paramid=*` endpoint on 404/410, and requests legacy parameter reads with `alt=json`. This fallback is software-tested; FS1 field verification is pending.

Recorder monitoring resumes for stored configurations (with a Reconnect on load opt-out). Same-tab control intent survives poll failures and reload, but remains ineffective while offline or unverified. Uncertain command errors clear control intent. Passwords are not persisted. Extension worker metadata recovery uses descriptor reads, not command replays. Automated coverage: 84 dashboard tests and 5 extension tests at this revision, plus TypeScript/Vite and extension packaging builds.
