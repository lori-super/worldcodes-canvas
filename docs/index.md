# WorldCodes Canvas Documentation Index

## Core guides

- [Quick Start](/docs/overview/quick-start)
- [Features](/docs/overview/features)
- [Docker Deployment](/docs/overview/docker)
- [Static Hosting Boundary](/docs/overview/render)
- [Local Agent](/docs/overview/codex-app-plugin)

## Canvas and development

- [Canvas Node Guide](/docs/canvas/canvas-node-manual)
- [Canvas Shortcuts](/docs/canvas/canvas-shortcuts)
- [Local Development](/docs/development/local-development)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [Local Codex Connection](/docs/development/local-codex-canvas)

## Security and license

- [Open-source License](/docs/business/license)
- [Report a Vulnerability](/docs/support/security)

## Runtime boundaries

- Production model traffic uses only the same-origin WorldCodes Relay.
- The user's WorldCodes API key stays in the browser; provider credentials and routing remain inside Relay.
- Canvas data and assets primarily remain in browser IndexedDB.
- Local reference media uploads directly to private temporary R2 objects only when generation requires it.
- The prompt library includes seven audited read-only JSON sources without external repository navigation; production still blocks external WebDAV and arbitrary model endpoints.
