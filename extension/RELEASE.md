SignalShade Connect preview connects SignalShade to approved local AJA devices without a separate bridge server.

Version 0.3.0 fixes range discovery: approve the requested private /24 HTTP range once, scan it with read-only access, and add identified devices from persistent results. Older units can appear through web-page identification even if their descriptor API is absent. Scan permission cannot authorize writes; selecting Add verifies the API and grants the individual connection. Added devices, Add by IP, and Scan network are separate permanent sections, with DEMO badges and retained errors/reports. Approval automatically resumes Add/Scan. Descriptor downloads now allow slower responses.

The reported legacy FS1 returned 404 for both descriptor endpoints. This release improves discovery and diagnostics; control for that exact firmware still needs qualification and may require a separate legacy adapter. Do not equate discovery with verified shading support.

Download **signalshade-connect.zip**, extract it to a permanent folder, open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the folder containing `manifest.json`. Reload SignalShade and connect the device, then approve access through its embedded SignalShade Connect panel. See the bundled README for details.

This is a manually installed preview, not a Chrome Web Store release. No browser security flags are required. Managed computers may require IT approval. Real-hardware qualification remains pending; verify on non-critical equipment before production use. The extension does not automatically start recording or replay uncertain commands.

For updates, replace the files in the same folder, reload the extension, then reload SignalShade and reconnect. The SHA-256 checksum is attached alongside the ZIP.
