# TODO

- [x] Unify processor/recorder device management, add model-specific demos, simplify recorder media, and package session diagnostics in one ZIP.
- [x] Implement original FS1 native Proc amp support and preserve processor identity without writing on routing changes.

- [x] Build SignalShade Connect preview with shared FS/recorder transport, per-device approval, GitHub ZIP packaging, and installation help in the dashboard. See [installation instructions](extension/README.md).
- [ ] Qualify the unpacked extension on actual HELO Plus and other AJA hardware, including authenticated requests, Chrome permission prompts, worker lifecycle, and current enterprise browser policy. Complete store assets/review and publish to Chrome Web Store after qualification. Preview downloads are available through GitHub releases.

- [x] Allow drag-to-multiselect to start anywhere on the channel pane's non-interactive background, including whitespace outside the card grid. Preserve normal slider, input, button, tab, and scrolling interactions, plus Ctrl/⌘-drag additive selection.
- [x] Implement the recorder strip, connection settings, simulation, duration/media display, persistence, independent polling and readback-confirmed Record/Stop lifecycle. See [implementation review](docs/implementation-review.md).
- [ ] Qualify real HELO / HELO Plus and installed Ki Pro models/firmware: capture response fixtures, verify browser CORS/cookie behavior, media/destination mappings and units, record duration/segmentation, streaming independence and stop/finalization semantics. No model is hardware-qualified yet; unrecognized command descriptors remain monitor-only.
