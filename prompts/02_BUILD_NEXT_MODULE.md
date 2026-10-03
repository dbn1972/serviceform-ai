# Cursor Task - Build the Next Approved Module

Read `specs/build-plan.yaml` and determine the first module whose dependencies and exit gates are satisfied but whose implementation is incomplete.

Before coding:
- list CMP and INT IDs in scope;
- read their detailed specification sections;
- produce an impact plan;
- identify required API/event/schema/migration/test changes;
- stop if an ADR is required.

Then implement only that module to its exit gate. Use simulated external providers where permitted. Capture executed test evidence. Do not start the next module automatically. End with a human-readable gate report and outstanding risks.
