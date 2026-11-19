# Phase 6 — Leave and attendance

**Status:** Not started · **Depends on:** Phase 4 · **Detailed before the phase starts, with your approval**

## Goal

Leave policies and attendance work per entity and state, with approvals by the reporting manager.

## Scope

- [ ] Leave types and policies per entity and state: accrual, carry-forward, encashment, sandwich rules, probation rules
- [ ] Holiday calendars per location; Maharashtra first
- [ ] Working hours and weekly offs per location (Maharashtra Shops and Establishments Act rules), configurable and dated
- [ ] Leave requests and approvals by manager through the workflow engine, with delegation
- [ ] Attendance: web check-in/out, regularisation requests, timesheets
- [ ] Integration point for biometric devices (adapter in `modules/integrations`)
- [ ] Leave balances and attendance summaries feeding payroll (Phase 8)

## Reuses

Workflow engine, org structure, settings (rules as dated configuration), notifications.

## Exit criteria

1. Flourisense staff apply for leave, managers approve, and balances update correctly for a full month.
2. Attendance for a month is exportable for payroll.
