# Adding or qualifying an adapter

Implement `DeviceAdapter.read`, `write`, and `dispose`. Keep transport code out of UI components. A channel is a processor with an active source-memory context, not simply a physical input connector.

Provide a `ParameterDescriptor` with a semantic ID, group, numeric limits/resolution, neutral/default value, unit, optional enum choices, and native mapping. Native integer values are acceptable; guessed scaling is not. Different units, color pipelines, enum meanings, or scaling must not become equivalent just because labels resemble one another.

Use sanitized fixtures captured from actual `desc.json` and get/set/readback responses. Include firmware and mode in the fixture notes. Add tests for discovery, model identity, processor selection, numeric decoding, enable semantics, ambiguous mappings, bad responses, context changes, and uncertain writes. Never record credentials or production IPs in fixtures.

The first AJA adapter recognizes explicit descriptor display names and requires numeric min/max/default/step metadata, a verified model identity, and readable source context. Unsupported descriptor naming or response shapes produce read-only diagnostics rather than speculative writes. Extend these cases with hardware evidence. Add new SDR color controls to the allowlist only after verifying their scope and semantics.

Hardware source context and operating mode belong in the context fingerprint. An adapter must invalidate old queued changes when that fingerprint changes. Persist no credentials in a workspace. After qualification, update the matrix with exact model, firmware, browser version, origin, evidence, and limitations.
