# ServiceForm AI Design System Contract

## Normative baseline
ServiceForm AI uses **UX4G Design System 3.0** as the mandatory design-system baseline for every first-party product surface: Citizen, Officer Workbench, ServiceForm Studio, Tenant Administration and platform operations.

Authoritative references:
- https://www.ux4g.gov.in/get-started
- https://www.ux4g.gov.in/foundations
- https://www.ux4g.gov.in/components
- https://doc.ux4g.gov.in/utilities/api.php/

## Framework mapping
- Next.js/React: official UX4G React components, tokens and patterns via the governed ServiceForm UI package.
- Flutter: official UX4G Flutter components/tokens plus certified ServiceForm extension components.
- Web Components: use for framework-neutral embedded widgets where appropriate.
- Figma: official UX4G design kit/tokens/patterns; coded component/state names must match the design inventory.
- JSON Forms: schema/runtime foundation only. Replace default visual widgets with UX4G-backed renderers.

## Non-negotiable rules
1. Search UX4G and the ServiceForm extension registry before creating a visual component.
2. Reuse UX4G foundations for color, typography, spacing/layout, elevation, iconography, tokens, accessibility and content.
3. Do not hard-code design values when a token exists.
4. Tenant branding is a validated token overlay; no arbitrary tenant CSS/JS and no component forks.
5. Do not introduce MUI, Bootstrap, Tailwind component styling or another visual design system without an ADR and UX4G-conformance wrapper. Headless utilities are allowed if they do not alter the UX4G contract.
6. Component accessibility does not certify the assembled application. Run journey-level keyboard, screen-reader, reflow and accessibility tests.
7. UX4G dependency upgrades are version-pinned release changes and must pass compatibility + accessibility + visual regression.

## ServiceForm UX4G extension candidates
- jurisdiction/government hierarchy selector
- DigiLocker document picker
- evidence upload + verification state
- application/case timeline
- SLA/escalation indicator
- appointment slot picker
- officer task/work-queue card
- consent/privacy-rights card
- credential/QR viewer
- AI-assistance disclosure/suggestion card

Each extension must have Figma parity, Storybook/examples, React and Flutter contracts where applicable, keyboard/ARIA behavior, localization, responsive states, accessibility tests and visual regression evidence.
