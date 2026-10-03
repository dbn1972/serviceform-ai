# Establish and certify the UX4G design-system foundation

Read `DESIGN-SYSTEM.md`, `specs/design-system.yaml`, CMP-054 in Building Block Specification v1.3, Section 22 of AWS Architecture v1.7 and the UX4G Cursor rule.

Do not build service-specific screens first. Implement the shared design-system foundation:
1. Pin UX4G Design System 3.0 dependencies for React and Flutter.
2. Create the governed ServiceForm UX4G wrapper/extension packages.
3. Create the UX4G-backed JSON Forms renderer registry for common controls.
4. Establish token-only tenant theming and automated contrast validation.
5. Build Storybook/component documentation and Figma inventory mapping.
6. Implement accessibility/keyboard/reflow/visual-regression CI gates.
7. Implement initial extension components only where UX4G lacks a government-ServiceForm-specific composite.
8. Prove one metadata-driven form renders equivalently on web and Flutter.
9. Produce `evidence/design-system/UX4G-CONFORMANCE-BASELINE.md` with executed evidence.

Stop at the design-system foundation gate. Do not invent service-specific UI and do not start the Golden Residence Certificate automatically.
