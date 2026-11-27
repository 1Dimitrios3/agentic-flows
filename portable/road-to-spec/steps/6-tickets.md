# 6. TICKETS

Spawn the `ticket-writer` role with the standard brief. It breaks the approved spec into one file per ticket in `tickets/`.

Put every question the writer returns to the human before the gate, numbered with your recommendation, and record each answer in `DECISIONS.md`. Send the answers that change a ticket to the writer and wait for its revision.

## A defect in the approved spec

When the writer reports that the SPEC disagrees with a decision, or with itself, put it to the human before the gate. On their go-ahead:

1. Log `spec amended — "<their words>"`.
2. Send the fix to the writer that wrote the spec, or to a fresh `spec-writer` with the fix in its brief, and wait for what changed.
3. Send that change to the ticket writer, so the tickets follow the amended SPEC.

A REJECT at the tickets gate whose note changes the SPEC takes the same three moves.

**Done when** `tickets/` holds the ticket files, written or revised in this pass, every question the writer returned is answered or deferred by the human, and no reported spec defect is left open.

## Gate: the tickets

Give the human one overview of all the tickets:

- a table with number, title, one-line scope and "blocked by" as ticket numbers. Take it from the writer's return, and check the "blocked by" column against a search for each ticket file's Blocked by section: it is copied, never inferred;
- then the dependency order (e.g. 01 → 02 → {03, 04}).

Point them to the ticket files in `tickets/` to read in full, and ask for one verdict on the whole set.

**After a REJECT:** send the human's note to the writer that wrote the tickets, or to a fresh `ticket-writer` with the note in its brief.

**Next:** step 7, DONE.
