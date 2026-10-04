import 'package:flutter/widgets.dart';

/// UX4G Design System 3.0 tokens (vendored from ux4g-web-components 3.0.0).
/// Tenant branding overlays these values; do not hard-code colours elsewhere.
abstract final class SfTokens {
  /// Page background (`--ux4g-bg-neutral-elevated`).
  static const Color background = Color(0xFFFFFFFF);

  /// Primary body text (`--ux4g-text-neutral-primary`).
  static const Color text = Color(0xFF171717);

  /// Secondary body text (`--ux4g-text-neutral-secondary`).
  static const Color textSecondary = Color(0xFF404040);

  /// Brand primary (`--ux4g-color-primary-600`).
  static const Color primary = Color(0xFF4A2BC2);

  /// Focus ring (`--ux4g-border-color-neutral-focus`).
  static const Color focus = Color(0xFF525252);

  /// Spacing scale step 1 (`--ux4g-space-1`, 2 px).
  static const double space1 = 2.0;

  /// Spacing scale step 10 (`--ux4g-space-10`, 40 px).
  static const double space10 = 40.0;

  /// Spacing scale step 12 (`--ux4g-space-12`, 56 px).
  static const double space12 = 56.0;

  /// Spacing scale step 13 (`--ux4g-space-13`, 64 px).
  static const double space13 = 64.0;

  /// Spacing scale step 2 (`--ux4g-space-2`, 4 px).
  static const double space2 = 4.0;

  /// Spacing scale step 3 (`--ux4g-space-3`, 6 px).
  static const double space3 = 6.0;

  /// Spacing scale step 4 (`--ux4g-space-4`, 8 px).
  static const double space4 = 8.0;

  /// Spacing scale step 5 (`--ux4g-space-5`, 12 px).
  static const double space5 = 12.0;

  /// Spacing scale step 6 (`--ux4g-space-6`, 16 px).
  static const double space6 = 16.0;

  /// Spacing scale step 7 (`--ux4g-space-7`, 20 px).
  static const double space7 = 20.0;

  /// Spacing scale step 8 (`--ux4g-space-8`, 24 px).
  static const double space8 = 24.0;

  /// Small corner radius (`--ux4g-radius-sm`).
  static const double radiusSm = 4.0;

  /// Medium corner radius (`--ux4g-radius-md`).
  static const double radiusMd = 8.0;

  /// Large corner radius (`--ux4g-radius-lg`).
  static const double radiusLg = 12.0;

  /// UX4G base font family token (`--ux4g-font-family-base`).
  static const String fontFamily = 'Noto Sans';
}
