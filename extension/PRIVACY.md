# SignalShade Connect privacy

SignalShade Connect transfers AJA device requests between the SignalShade dashboard at `https://inertiaimpact.github.io/SignalShade/` and device addresses you explicitly approve. It does not send device traffic to GitHub or another relay server. GitHub hosts the dashboard and extension downloads, which have their own hosting access logs.

The extension processes device addresses, descriptors, recording/media status, shading values, and your requested control changes. If you supply authentication, it sends it only to the approved device. Passwords are not stored by the extension. Browser-managed device session cookies may persist according to Chrome and the device's cookie policy. Devices configured with HTTP use unencrypted local-network traffic.

Approved origins are stored locally in Chrome extension storage, not synchronized. Temporary approval and command bookkeeping are held in extension session storage. No analytics, telemetry, advertising, or browsing-history collection is included. The extension's content relay runs only on the production SignalShade path.

When you approve a scan, Chrome is asked for the individual HTTP hosts in the exact requested private /24 range (up to 254). The extension limits those scan reads to 30 minutes in the requesting tab and blocks writes unless you separately add/approve that device. Chrome's underlying host permissions can remain until you revoke them in extension settings. Scan reads process web-page identity; the page HTML is not sent to the dashboard, only a bounded title/model summary. Reports and scan results stay in the dashboard unless you choose to export them.

Revoke access in Chrome's extension permissions or uninstall the extension to remove its stored data. Dashboard workspaces are stored separately by SignalShade. Questions and issues: https://github.com/InertiaImpact/SignalShade/issues (do not post passwords or unsanitized network captures).
