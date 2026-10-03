// REQ: DESIGN-SYSTEM.md rule 6 (accessible structure), TESTING.md UX4G verification.
import 'package:flutter_test/flutter_test.dart';
import 'package:serviceform_mobile/main.dart';

void main() {
  testWidgets('renders the citizen shell with a semantic header', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(const ServiceFormMobileApp());

    expect(find.text('ServiceForm AI Citizen'), findsOneWidget);
    expect(
      tester.getSemantics(find.text('ServiceForm AI Citizen')),
      matchesSemantics(label: 'ServiceForm AI Citizen', isHeader: true),
    );
    expect(find.textContaining('M00 bootstrap shell'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('meets text contrast and tap target guidelines', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await tester.pumpWidget(const ServiceFormMobileApp());
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    semantics.dispose();
  });
}
