# @serviceform/ui-ux4g

The governed UX4G Design System 3.0 wrapper for every first-party React surface (Citizen, Officer
Workbench, Studio, Tenant Admin, Platform Ops). Applications import UI only from this package;
`scripts/gates/design_system_gate.py` fails CI if an app adds another visual design system.

## M00 status: structural shell only

UX4G 3.0 is not published on the public npm registry (`ux4g`, `@ux4g/*` return 404 as of
3 Oct 2026). Until the official UX4G 3.0 assets are vendored here from ux4g.gov.in under its
licence terms (tracked as M00 gap G-03 in `evidence/M00/BOOTSTRAP-EVIDENCE-001.md`):

- `AppShell` provides the accessible page frame (skip link, banner, main, contentinfo landmarks,
  `lang`), with no colour, spacing or typography values of its own.
- `styles.css` declares the token **names** the wrapper consumes and maps them to neutral system
  defaults. It must be replaced by the UX4G token stylesheet; it is not a design.

Do not add visual components here until the UX4G assets are vendored (DESIGN-SYSTEM.md rule 1).
