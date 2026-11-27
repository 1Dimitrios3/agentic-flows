# 4. CLARIFY

Settle every open question with the human, then put the understanding to them at the gate.

## Grill

Read `<skill>/references/grilling.md` and `<skill>/references/domain-modeling/domain-modeling.md` in full, and follow them together over `understanding/OPEN-QUESTIONS.md`. They are reference files, not invocable skills.

- The glossary goes to `understanding/GLOSSARY.md` and ADRs to `understanding/adr/`: in the run folder, not the target repo.
- Each recommendation you give cites its evidence (a code anchor, path › symbol, or a source), or is marked "(guess)". An anchor counts as evidence once you have read its definition; a grep hit alone is "(unverified)".
- A round holds at most 10 questions. When the frontier is larger, ask the 10 that unblock the most, and keep the rest for the next round.
- Put each question in the screen's terms: what the admin sees, clicks and gets. The code anchors, endpoints and component names go in `OPEN-QUESTIONS.md` beside the question, not in the chat.
- Ground a recommendation in what the user needs. Reusing existing code is a cost to state, not a reason to recommend.

After **each** answer: append it to `understanding/DECISIONS.md` as the next `D<n>`, naming its question; update `understanding/UNDERSTANDING.md`; and mark the question `- [x]` (answered) or `- [-]` (deferred by the human), with the D number beside it. A reply that answers several questions is one edit per file.

When you come back to this step after a discovery round, first tell the human what the round found for each item it was called for.

## An answer that needs new evidence

When an answer needs new evidence, including one that sends you to look ("inspect X"), keep the question `- [ ]` until you have it.

- For a page, follow `<skill>/references/inspect-page.md` with the human. Save its report and the raw JSON of each data request into `sources/`, and list each new file in `sources/INDEX.md`.
- Otherwise add the gap as a `- [ ]` item.

## Prototype

A prototype is the human's call, for a question only trying the flow or screen can settle. On their go-ahead, read `<skill>/references/prototype/prototype.md` and follow it:

- Build it on a throwaway branch of the target repo, created from the current branch once `git status` shows the target clean. With uncommitted changes there, ask the human first. Tell the human the branch switch changes what their running dev server shows.
- You create the branch; a subagent writes the code. Brief it with the reference files to read (`prototype.md`, and `LOGIC.md` or `UI.md` beside it), the decisions to show, and the branch. It drives every prototyped flow in the browser (the chrome-devtools tools) before it hands back, and reports each flow as driven or not driven. Give the human the URL only for flows that were driven.
- On the human's verdict, commit the prototype on its branch, then switch the target back to the branch it was on, telling the human the prototype leaves their browser with it. Write `sources/prototype.md`: the branch and commit, how to run it, its files, the verdict and the decisions it settled. List it in `sources/INDEX.md`.

## Discovery round

A discovery round is the human's call. Before one, show them one line per item that needs it: what is missing, what the reports say about it now (quoted with its code anchor or source, or "nothing"), and whether the sources or the code would answer it.

- When the reports already answer an item, show the answer and ask whether they still want the round for it, even if they gave the go-ahead in the same breath as asking. A round only for items already answered doesn't run.
- Questions that don't wait on the round are put to the human before you enter step 2.
- On their go-ahead, log `discovery round — "<their words>"` and enter step 2, which runs its refresh pass. Steps 3 and 4 follow it again.
- If they decline, answer or defer the item with them instead.
- A run takes at most 10 discovery rounds: count the `discovery round` lines in the log. At 10, answer or defer (`- [-]`) the open questions with the human.

## Walk-through

Once no `- [ ]` is left, walk the decisions **slice** by slice before the gate. A slice is one way the human sees the feature: a user type, a role, a screen. Propose the slices and let the human confirm them.

For each slice, offer two ways through, and recommend the first:

- **You present** (recommended): a short summary of what was agreed for the slice, each point with its D number. The human corrects it or confirms it.
- **The human briefs**: the human describes the slice in their own words. Answer in three short lists, each item with its D number: **Matches** (where the brief and the decisions agree), **Mismatches** (where they differ, each put to the human as a question) and **Extras** (what the decisions add that the brief doesn't mention).

Record every correction as a decision or a revision, as above. A slice is confirmed when the human has confirmed the summary or settled every mismatch, and has accepted what the decisions add.

Then bring `understanding/UNDERSTANDING.md` up to date with the final state of every decision, revisions included, and write at its top that it is the consolidated state as of the last D number.

**Done when** a search finds no line starting with `- [ ]` left in `understanding/OPEN-QUESTIONS.md`, every slice is confirmed, `understanding/GLOSSARY.md` is non-empty, `understanding/DECISIONS.md` and `understanding/UNDERSTANDING.md` were both updated in this pass, and `UNDERSTANDING.md` names the last D number it consolidates.

## Gate: the understanding

Present `understanding/UNDERSTANDING.md` slice by slice, the decisions taken, and any deferred `- [-]` questions. Ask the human whether this is enough to write the spec.

**After a REJECT:** treat the note as new answers and new questions. Revise the decisions it changes, update `understanding/UNDERSTANDING.md`, and add anything it leaves unsettled as a `- [ ]` item to work as above.

**Next:** step 5, SPEC.
