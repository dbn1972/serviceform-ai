import 'package:flutter/widgets.dart';

import 'tokens.dart';

/// Accessible page frame for the citizen mobile app.
///
/// Governed UX4G wrapper (DESIGN-SYSTEM.md). M00 placeholder: it defines structure and
/// semantics only and carries no design values until the official UX4G 3.0 Flutter
/// components and tokens are vendored (bootstrap gap G-03).
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Semantics(header: true, child: Text('ServiceForm AI $title')),
            Expanded(
              child: Semantics(
                container: true,
                explicitChildNodes: true,
                child: child,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
