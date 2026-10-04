import 'package:flutter/widgets.dart';

import 'tokens.dart';

/// Metadata-driven field mapping for Flutter. JSON Forms remains schema/runtime;
/// visual values come only from [SfTokens] (UX4G 3.0).
enum Ux4gRendererId {
  /// Single-line text input (`ux4g-input-container`).
  textInput,

  /// Multi-line text input.
  textarea,

  /// Numeric input.
  numberInput,

  /// Date input.
  dateInput,

  /// Boolean checkbox (`ux4g-checkbox`).
  checkbox,

  /// Exclusive choice radios (`ux4g-radio`).
  radioGroup,

  /// Enumerated select (`ux4g-input-container`).
  select,

  /// Schema node with no UX4G renderer.
  unsupported,
}

/// Resolves a JSON Schema node to a UX4G-backed Flutter renderer id.
Ux4gRendererId resolveUx4gRenderer({
  required String? type,
  String? format,
  List<Object?>? enumerated,
  String? controlHint,
}) {
  if (controlHint == 'textarea') {
    return Ux4gRendererId.textarea;
  }
  if (controlHint == 'radio' && enumerated != null && enumerated.isNotEmpty) {
    return Ux4gRendererId.radioGroup;
  }
  if (enumerated != null && enumerated.isNotEmpty) {
    return Ux4gRendererId.select;
  }
  if (format == 'date' || format == 'date-time') {
    return Ux4gRendererId.dateInput;
  }
  switch (type) {
    case 'boolean':
      return Ux4gRendererId.checkbox;
    case 'number':
    case 'integer':
      return Ux4gRendererId.numberInput;
    case 'string':
      return Ux4gRendererId.textInput;
    default:
      return Ux4gRendererId.unsupported;
  }
}

/// Accessible labelled control using UX4G tokens only.
class Ux4gTextField extends StatelessWidget {
  /// Creates a labelled text field.
  const Ux4gTextField({super.key, required this.label, required this.value});

  /// Field caption.
  final String label;

  /// Current value (no PII logging).
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: SfTokens.space6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              color: SfTokens.text,
              fontFamily: SfTokens.fontFamily,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: SfTokens.space2),
          Text(
            value,
            style: const TextStyle(
              color: SfTokens.textSecondary,
              fontFamily: SfTokens.fontFamily,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }
}
