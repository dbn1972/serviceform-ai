# @serviceform/ui-ux4g

The governed UX4G Design System 3.0 wrapper for every first-party React surface (Citizen, Officer
Workbench, Studio, Tenant Admin, Platform Ops). Applications import UI only from this package;
`scripts/gates/design_system_gate.py` fails CI if an app adds another visual design system.

## SF-M03-006 (CMP-054)

- Vendored subset of `ux4g-web-components@3.0.0` (MIT) tokens and primitive classes in
  `src/styles.css` (the design-system token file). Official webfonts are not embedded;
  `--ux4g-font-family-base` still names Noto Sans.
- Tenant branding is a validated token overlay (`applyTenantOverlay`). Arbitrary tenant CSS/JS is
  rejected. Overlay CSS is scoped to `[data-tenant-id]`.
- JSON Forms remains schema/runtime only. `resolveUx4gRenderer` / `Ux4gControl` map controls to UX4G
  classes. Do not use default JSON Forms skins.
- No product Studio pages (SF-M03-007). No second design system. Not CERTIFIED.

## Usage

```ts
import { AppShell, Button, applyTenantOverlay } from '@serviceform/ui-ux4g';
import '@serviceform/ui-ux4g/styles.css';
```
