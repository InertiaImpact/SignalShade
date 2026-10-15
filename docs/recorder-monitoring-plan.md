# Recorder monitoring and transport

Status: initial implementation delivered. The compact strip, settings, simulation, workspace persistence, browser adapter, polling and confirmed transport lifecycle are implemented. Hardware qualification remains open. The sections below retain the design intent; see [implementation and review](implementation-review.md) for delivered behavior and remaining qualification limits.

## First release

Add an optional recorder strip to SignalShade's fixed top bar for AJA HELO, HELO Plus, and qualified Ki Pro models. Operators should be able to check recording health, elapsed time, and available media and start or stop an individual recorder without leaving the shading desk.

Keep recording separate from FS channel selection and shading gangs. The first release excludes streaming controls, recorder gangs, Record All / Stop All, playback, media formatting/ejection, destination changes, clip downloads, and encoder configuration.

Target all Ki Pro models: Rack, Ultra-family, GO/GO2, Mini, and original Ki Pro. Reuse shared transport behavior, with identity/descriptor checks and per-firmware qualification. Multi-channel models need explicit transport scope: a device-wide Record command must say which enabled channels it will affect.

## Display and interaction

Use a compact second row within the existing top-bar area rather than squeezing more controls into its current header row. It stays visible above the channel pane. Hide the row when no recorders are configured. Use the existing dark neutral palette; reserve red for recording indicators and errors distinguished by text, amber for warnings, and existing green for ready/connected status.

Example of one recorder capsule, using illustrative values:

```text
Program HELO   ● REC   00:42:18        [■ Stop] [⌄]
SD  ~02:10 left · 128 GB     USB Ready · 256 GB
```

- Each capsule has an editable label, explicit transport state, elapsed duration, one state-dependent Record/Stop action, and a details dropdown. Use tabular numbers so the layout does not shift as timers change.
- The second line shows the active recording destination, available recording time, and free space where supported. Other media get short labeled status badges. Include backup/parallel destination roles; do not imply every second disk is a rollover disk.
- For devices with many destinations, keep the active destination and any failed/low destination visible and expose the complete list through `+N media`. The capsule must retain an aggregate warning even when the affected medium is in the dropdown.
- The dropdown lists every exposed slot/destination, its label, role, state, free/total capacity, time remaining, warnings, and data freshness. Also show model/firmware, input/recording channel status where available, last completed duration when identifiable, and a link to the device's own web UI.
- Keep capsules consistent in width, approximately 340–380 px as an initial layout target. Multiple capsules run horizontally in a fixed-height row; use horizontal scrolling and an always-visible aggregate warning/count when the row overflows. Narrow screens can collapse to a recording/warning summary that opens the recorder list. No control becomes a tiny icon-only transport target.
- Add and configure recorders through a Recorders area in Manage connections: IP, label, model detection, monitor-only/control-enabled, order, and optional remaining-time warning thresholds. Adding a device starts read-only and never begins recording.

## Transport behavior

Show device-reported states: Ready/Idle, Starting, Recording, Paused, Stopping/Finalizing, Error, Offline, and Unknown as applicable. Recording duration is not the same as input timecode. Prefer a device-reported elapsed/session duration. If only current clip duration is available, label it as clip duration; segmented files must not silently reset a displayed session timer. An observed local estimate is labeled `~` and cannot establish an unknown session start after reconnect.

Record and Stop are explicit desired actions, not a blind toggle based on an old UI value. Before sending a command, refresh relevant transport/readiness state, check the recorder's control enable and the desk lock, and verify the target/affected channels. Serialize transport commands per recorder and suppress repeated clicks while pending. Confirm success through fresh device status, not HTTP success alone. Starting an already-recording target is a no-op; stopping an already-idle target is a no-op.

For accidental-stop protection, the first Stop click changes that capsule to `Confirm stop` for a short, visible interval; a second click confirms. It does not open a large modal. Keyboard users can complete the same flow. If the target, recording identity, or state changes before confirmation, cancel it. Do not introduce a mandatory confirmation on ordinary Record actions once recorder control is enabled.

Ki Pro stop semantics must be qualified per model and initial transport state. Published GO/Ultra command examples describe pause/stop sequencing; an adapter must reach the documented intended final state through fresh readback rather than blindly issuing Stop twice. Keep Paused and Finalizing distinct from a confirmed completed recording.

HELO/HELO Plus control must use independently verified record-only commands. Check any record/stream linkage and require qualification that Start/Stop leaves streaming unchanged. Do not silently change link settings or use combined record/stream commands.

An uncertain response triggers read-only reconciliation. Never replay a queued Start/Stop after reconnect or timeout. If status cannot establish the result, show `Unknown — verify recorder` and disable further commands until fresh state is available. Transport actions do not enter the shading Undo stack: undoing a stopped recording cannot restore its continuity.

## Capacity, media, and warnings

Normalize storage as media/destinations, not necessarily physical disks: HELO-family devices can expose SD, USB, and network recording locations. Ki Pro slots and channel-to-media relationships vary by model and operating mode.

Each destination includes a stable identity, slot/name, active/primary/backup/rollover role when verified, mount/write state, capacity fields, and its own timestamp and warnings. States include Recording, Ready, Empty/Not present, Full, Read-only, Busy, Error, and Unknown. Missing metrics show `—` or `Not reported`, never zero or an invented healthy state.

Prefer reported recordable time over a raw free-space calculation. If an adapter can reliably estimate from the actual recording bitrate and usable capacity/reserve, show `~` and explain the estimate in details. Honor recorder-reported media-full and reserve limits even when raw free bytes remain. Do not sum durations of parallel/backup destinations or assume rollover is configured. For parallel required destinations, surface the limiting member and any backup failure separately.

Show device-reported warnings immediately. Initial optional time thresholds could be 15 minutes (warning) and 5 minutes (critical), configurable per recorder. Thresholds supplement device warnings; they cannot replace model-specific full/reserve behavior. Keep recording red separate from an explicit `MEDIA LOW`, `BACKUP FAILED`, or `RECORD ERROR` message. No flashing or audible alarms in the first version.

## Integration and persistence

Create separate recorder types and adapters rather than extending the FS color adapter's control mappings:

- `RecorderConfig`: stable ID, address, label, adapter/model hint, visibility/order, and warning preferences. Persist/export these; keep old workspaces valid when recorder configuration is absent.
- `RecorderSnapshot`: confirmed transport and scope, duration with its basis, media/destination snapshots, warnings, pending action, and freshness for individual fields. Runtime state is never restored as current truth or used to resume a command.
- `RecorderCapabilities`: independent record control, transport scope, duration kind, available media metrics, status subscription support, authentication requirements, and qualification status.
- `RecorderAdapter`: probe capabilities/identity, read status/media, request record, request stop, and dispose. Initial implementations are HELO, HELO Plus, and the user's identified Ki Pro family/model.
- `RecorderStore`: independent polling, command serialization, pending/readback handling, and activity reporting. Recorder failures must not block FS controls. Reuse the existing one-operator browser lock, connection diagnostics, and workspace backup infrastructure.
- `RecorderStrip`, `RecorderCapsule`, and `RecorderDetails`: presentation shared across adapters; unsupported fields remain explicitly unavailable.

Initial polling targets while the dashboard is visible: transport every second while recording or changing state, every two seconds while idle, and media every five seconds. Refresh immediately around commands and reported errors. Coalesce requests, bound concurrency, and back off failed devices so the recorders do not delay shading. Prefer qualified change subscriptions when available. Treat these intervals as targets to measure on hardware, not guarantees.

Stale recording state becomes `Last REC · stale` with a frozen timer; do not continue an unverified elapsed animation. A failed media read can leave transport monitoring operational while that destination is marked stale. Browsers throttle background pages, so this is an operator dashboard rather than a guaranteed unattended alarm service.

## Browser feasibility gate

The existing static GitHub Pages app communicates directly with LAN devices. Each recorder/firmware needs its own browser CORS, local-network permission, authentication, and readable-status qualification. A recorder's built-in UI or working Companion integration does not establish that Pages can access it.

HELO documentation describes login/session-cookie authentication, which the current FS adapter's optional Basic header and `credentials: omit` do not implement. Cross-origin cookie restrictions can be an additional blocker. Reuse transport infrastructure only where its authentication behavior actually fits; never assume one AJA product's successful connection proves another's.

If a required model cannot support the direct-browser path, retain the monitor UI and introduce a separately scoped optional local bridge/desktop transport. Serving the HTML locally by itself does not remove cross-origin access to recorder IPs. Do not claim production support or relax browser protections to bypass failed qualification.

## Delivery sequence and acceptance

1. Identify the installed models/firmware and transport scope. Capture official device REST documentation/descriptors and read-only status/media responses; document field units, unavailable values, storage roles, authentication, and browser headers.
2. Build the strip, dropdown, connection settings, optional workspace fields, and simulated adapters. Include recording, paused, full media, missing disk, backup failure, stale status, and network loss examples. This stage can be reviewed before hardware access.
3. Qualify HELO and HELO Plus read-only monitoring and then record-only commands on off-air units. Add the identified Ki Pro adapter with its verified stop and multi-channel behavior. Confirm commands do not change streaming, routing, media selection, or encoding settings.
4. Test simultaneous recorder monitoring and FS adjustment load. Verify externally started/stopped recordings, reload/reconnect, clip segmentation, media change/full/reserve limits, partial metrics, authentication expiry, double clicks, timeout ambiguity, desk/second-tab locks, and keyboard/narrow-screen operation.

Release acceptance: each supported model shows confirmed record state, accurate/explicitly qualified duration and capacity information, all exposed destination statuses, verified Start/Stop scope, and useful failure/stale feedback. A recording continues normally when the browser closes; reopening only observes it. Record controls remain separate from shading selections and gangs. Unsupported firmware stays clearly unqualified/read-only.

## Reference material

- [AJA REST API Developer Guide — listed product families](https://www.aja.com/support/item/4184)
- [AJA HELO REST commands — separate recording/streaming and authentication](https://gitlab.aja.com/pub/rest_api/-/blob/master/HELO/03_HELO_Commands.md)
- [HELO 4.3 manual — linked controls, recording status and media reserve limits](https://www.aja.com/assets/support/files/8677/en/AJA_HELO_Manual_v4.3.pdf)
- [HELO Plus — control API and recording destination capabilities](https://www.aja.com/products/helo-plus)
- [HELO Plus 2.1r3 manual — use the installed firmware's own documentation when mapping fields](https://www.aja.com/support/item-download/10154/AJA_HELO-Plus_Manual_v2.1r3.pdf)
- [AJA Ki Pro GO transport command examples](https://gitlab.aja.com/pub/rest_api/-/blob/52578781dbf8207689ea71df3753b9801334d695/KiPro-GO/04_Ki-Pro-GO_Commands.md)
- [AJA Ki Pro Ultra transport command examples](https://gitlab.aja.com/pub/rest_api/-/blob/9b193140936761ff55c2d5992ebe2745f856c556/KiProUltra/05_Ki-Pro-Ultra_Commands.md)

These establish documented capabilities and planning constraints, not hardware-tested compatibility with SignalShade. Exact parameter IDs, response formats, units, and behavior are to be pinned in model/firmware fixtures during qualification.
