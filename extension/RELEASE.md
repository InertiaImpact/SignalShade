SignalShade Connect preview connects SignalShade to approved local AJA devices without a separate bridge server.

Version 0.2.0 moves approval into the dashboard and continues connection testing after approval. It also recovers descriptor metadata after a background-worker restart and permits the legacy AJA descriptor endpoint for older FS hardware. The dashboard resumes recorder monitoring on load and restores same-tab control intent only after fresh state verification. Ordinary HTTP/device errors no longer trigger connection-approval help.

Download **signalshade-connect.zip**, extract it to a permanent folder, open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the folder containing `manifest.json`. Reload SignalShade and connect the device, then approve access through its embedded SignalShade Connect panel. See the bundled README for details.

This is a manually installed preview, not a Chrome Web Store release. No browser security flags are required. Managed computers may require IT approval. Real-hardware qualification remains pending; verify on non-critical equipment before production use. The extension does not automatically start recording or replay uncertain commands.

For updates, replace the files in the same folder, reload the extension, then reload SignalShade and reconnect. The SHA-256 checksum is attached alongside the ZIP.
