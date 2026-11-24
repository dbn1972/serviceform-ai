import type { Surface } from '../src/AppShell';

export type GallerySceneMeta = {
  id: string;
  title: string;
  surface: Surface;
  /** What the scene proves, for the evidence pack. */
  covers: string;
};

/** Scene index for the UX4G forms gallery; React-free so test runners can list scenes cheaply. */
export const GALLERY_SCENE_META: readonly GallerySceneMeta[] = [
  {
    id: 'form-empty',
    title: 'Form steps: empty',
    surface: 'citizen_web',
    covers:
      'Required/optional labels, hints, every renderer (text, date, radio, number, email, select, textarea) in the citizen Card frame; stepper answer progress at 0%',
  },
  {
    id: 'form-filled',
    title: 'Form steps: filled with a verified field',
    surface: 'citizen_web',
    covers: 'Filled values, success note on a host-verified field',
  },
  {
    id: 'form-errors',
    title: 'Form steps: every field in error',
    surface: 'citizen_web',
    covers:
      'Error state, aria-invalid and aria-describedby on every renderer; a later step flagged "Needs attention" in the stepper',
  },
  {
    id: 'form-readonly',
    title: 'Form steps: read-only',
    surface: 'officer_workbench',
    covers: 'Disabled/read-only rendering used for officer and assisted views',
  },
  {
    id: 'form-review',
    title: 'Preview and declaration',
    surface: 'citizen_web',
    covers: 'Ux4gFormReview summary, change links, declaration checkbox in error, actions',
  },
  {
    id: 'studio-preview',
    title: 'Studio designer preview (desktop)',
    surface: 'service_studio',
    covers:
      'Same renderer inside the Studio preview frame: device frame around the citizen wizard (preview = runtime)',
  },
  {
    id: 'controls',
    title: 'UX4G form controls',
    surface: 'citizen_web',
    covers:
      'TextInput states/sizes/prefix, Select, RadioGroup, Checkbox, Switch, OTP states, Alerts, TextLink, Button variants x sizes',
  },
  {
    id: 'multilingual',
    title: 'Multilingual and long content',
    surface: 'citizen_web',
    covers:
      'Devanagari labels/errors via CMP-009 labels, long labels, unbroken values and long options',
  },
];
