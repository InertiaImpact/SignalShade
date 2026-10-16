SignalShade Connect preview connects SignalShade to approved local AJA devices without a separate bridge server.

Version 0.4.0 adds original FS1 firmware 2.2.2.1 Proc amp controls using the native `/json` API. The extension checks AJA FS1 identity, seven known status reads, and native parameter bounds before allowing shading writes. No new permissions are required. Source selection, routing and device resets remain excluded.

The dashboard now has one Devices manager for FS processors and HELO/Ki Pro recorders: a larger added-device list, selectable demo models, compact recording/storage status, and one **Download debug ZIP** containing scan, connection and recorder diagnostics. Scanned HELO devices use the recorder adapter. HELO media reads now exclude unrelated streaming/clip/internal parameters. Processor labels, groups and locks persist across input changes; refreshing routing never resets or reapplies color values.

Install this extension update and reload the dashboard together. FS1 readbacks were replayed from supplied reports, and native ranges were checked against AJA firmware metadata. Physical write/readback testing is still needed; automated tests do not operate your equipment.

Download **signalshade-connect.zip**, extract it to a permanent folder, open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the folder containing `manifest.json`. Reload SignalShade and connect the device, then approve access through its embedded SignalShade Connect panel. See the bundled README for details.

This is a manually installed preview, not a Chrome Web Store release. No browser security flags are required. Managed computers may require IT approval. Real-hardware qualification remains pending; verify on non-critical equipment before production use. The extension does not automatically start recording or replay uncertain commands.

For updates, replace the files in the same folder, reload the extension, then reload SignalShade and reconnect. The SHA-256 checksum is attached alongside the ZIP.
