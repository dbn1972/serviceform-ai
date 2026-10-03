import 'package:flutter/widgets.dart';

import 'ux4g/app_shell.dart';
import 'ux4g/tokens.dart';

void main() {
  runApp(const ServiceFormMobileApp());
}

/// Root widget of the ServiceForm AI citizen mobile app (M00 bootstrap shell).
class ServiceFormMobileApp extends StatelessWidget {
  /// Creates the root widget.
  const ServiceFormMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return WidgetsApp(
      title: 'ServiceForm AI',
      // OS task-switcher colour only; UI colours come from UX4G tokens once vendored.
      color: SfTokens.text,
      debugShowCheckedModeBanner: false,
      textStyle: const TextStyle(color: SfTokens.text, fontSize: 16),
      builder: (BuildContext context, Widget? _) => const AppShell(
        title: 'Citizen',
        child: Text(
          'This is the M00 bootstrap shell. Features are added by later build-plan modules.',
        ),
      ),
    );
  }
}
