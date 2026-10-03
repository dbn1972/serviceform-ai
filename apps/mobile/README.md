# ServiceForm AI mobile (Flutter)

Citizen mobile surface (`citizen_mobile` in `specs/design-system.yaml`). M00 contains the
project foundation and an accessible shell only.

```bash
flutter pub get
flutter analyze
flutter test
```

UI comes from the governed UX4G wrapper in `lib/ux4g/`. The official UX4G 3.0 Flutter
components are not yet vendored (bootstrap gap G-03), so the wrapper defines structure and
semantics only.
