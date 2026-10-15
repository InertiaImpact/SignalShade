# TODO

- [x] Allow drag-to-multiselect to start anywhere on the channel pane's non-interactive background, including whitespace outside the card grid. Preserve normal slider, input, button, tab, and scrolling interactions, plus Ctrl/⌘-drag additive selection.
- [x] Implement the recorder strip, connection settings, simulation, duration/media display, persistence, independent polling and readback-confirmed Record/Stop lifecycle. See [implementation review](docs/implementation-review.md).
- [ ] Qualify real HELO / HELO Plus and installed Ki Pro models/firmware: capture response fixtures, verify browser CORS/cookie behavior, media/destination mappings and units, record duration/segmentation, streaming independence and stop/finalization semantics. No model is hardware-qualified yet; unrecognized command descriptors remain monitor-only.
