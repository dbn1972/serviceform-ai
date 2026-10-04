import 'package:flutter/widgets.dart';

import 'tokens.dart';

/// Accessible page frame for the citizen mobile app.
///
/// Governed UX4G wrapper (DESIGN-SYSTEM.md). Colours, type and spacing come from
/// UX4G 3.0 tokens in [SfTokens]. Tenant branding is overlay-only via those tokens.
class AppShell extends StatelessWidget {
  /// Creates the shell with a surface [title] and page [child].
  const AppShell({super.key, required this.title, required this.child});

  /// Product surface title announced as the page header.
  final String title;

  /// Page content.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: SfTokens.background,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(SfTokens.space6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Semantics(
                header: true,
                child: Text(
                  'ServiceForm AI $title',
                  style: const TextStyle(
                    color: SfTokens.text,
                    fontFamily: SfTokens.fontFamily,
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: SfTokens.space6),
              Expanded(
                child: Semantics(
                  container: true,
                  explicitChildNodes: true,
                  child: DefaultTextStyle(
                    style: const TextStyle(
                      color: SfTokens.text,
                      fontFamily: SfTokens.fontFamily,
                      fontSize: 16,
                    ),
                    child: child,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
