# Workflow Contract

The authoring model is a platform-neutral versioned graph/DSL. Temporal is the accepted reference durable orchestration runtime, but domain state and human-task semantics remain platform-owned for portability.

Required node types include start/end, human task, deterministic rule, parallel/choice, timer/SLA, external integration, payment, evidence request, inspection/field verification, hearing/appointment, notification, output/signing and appeal/escalation.

Human assignment is resolved dynamically by role + office + jurisdiction + service authority. Never persist a named officer in a published workflow definition.


## BPMN interoperability and active-case migration
- ServiceForm Workflow Model is canonical; Temporal is the durable runtime.
- Implement a documented BPMN 2.0 import/export subset with compatibility reports and round-trip tests.
- Never run arbitrary imported BPMN directly without normalization/validation/publication.
- Active cases remain on pinned workflow versions by default. Migration requires safe-point mapping, simulation, maker-checker approval, rollback/compensation and reconciliation evidence.
