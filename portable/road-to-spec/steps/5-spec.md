# 5. SPEC

Spawn the `spec-writer` role with the standard brief. It writes `spec/SPEC.md` from the dossier.

Put the test seams and every open question the writer returns to the human, in any pass, numbered with your recommendation. Treat any choice the return says the writer kept or made itself as an open question too. Number them on from the last Q in `understanding/OPEN-QUESTIONS.md` and add them there. Record each answer in `DECISIONS.md`.

Then always send the answers to the writer, by D number, even when the human accepted every proposal: you haven't read the spec, so you can't tell whether it already agrees. The writer folds them in and returns what changed. Wait for it. A return with new questions starts this again. Any other change to the spec waits for the gate.

**Done when** `spec/SPEC.md` was written or revised in this pass, the human has confirmed its test seams, every question the writer returned is answered or deferred by the human, and the writer has confirmed the SPEC agrees with those answers. The SPEC's open questions then hold only deferred items.

## Gate: the spec

Present the spec from the writer's summary, without reading `spec/SPEC.md` yourself. Point the human to the file to read in full, and ask them to approve it or say what to change.

**After a REJECT:** send the human's note to the writer that wrote the spec, or to a fresh `spec-writer` with the note in its brief. Confirm any changed seams with the human.

**Next:** step 6, TICKETS.
