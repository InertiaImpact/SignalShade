# SignalShade Connect privacy

SignalShade Connect transfers AJA device requests between the SignalShade dashboard at `https://inertiaimpact.github.io/SignalShade/` and device addresses you explicitly approve. It does not send device traffic to GitHub or another relay server. GitHub hosts the dashboard and extension downloads, which have their own hosting access logs.

The extension processes device addresses, descriptors, recording/media status, shading values, and your requested control changes. If you supply authentication, it sends it only to the approved device. Passwords are not stored by the extension. Browser-managed device session cookies may persist according to Chrome and the device's cookie policy. Devices configured with HTTP use unencrypted local-network traffic.

Approved origins are stored locally in Chrome extension storage, not synchronized. Temporary approval and command bookkeeping are held in extension session storage. No analytics, telemetry, advertising, or browsing-history collection is included. The extension's content relay runs only on the production SignalShade path.

Revoke access in Chrome's extension permissions or uninstall the extension to remove its stored data. Dashboard workspaces are stored separately by SignalShade. Questions and issues: https://github.com/InertiaImpact/SignalShade/issues (do not post passwords or unsanitized network captures).
