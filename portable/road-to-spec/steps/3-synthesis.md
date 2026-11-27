# 3. SYNTHESIS

Read both discovery reports in full.

**Write `understanding/UNDERSTANDING.md`**: what will be built, in the target codebase's terms, citing sources.

**Write `understanding/OPEN-QUESTIONS.md`**, with one `- [ ] ` line per unresolved question.

- Number the questions `Q1`, `Q2`… and never reuse a number. Later steps name a question by it.
- Start a line with the checkbox marker only when it is a question: don't write the marker in prose, so a search for open questions finds only questions.
- Keep only questions whose answer changes what gets built or how it is tested. Process details (ticket ids, branch or commit naming) stay out.
- A choice between options (e.g. which codebase pattern to follow) is a question with your recommendation. It is never decided here, and never dropped.
- A question only an external source can answer is carried over with `(awaits: <source>)`, so the human can defer it when the questions are put to them.

Every `- [ ]` in both discovery reports is accounted for: carried over, merged into another line (note which), or listed under `## Dropped` as a plain `- ` line with a one-line reason.

After a refresh pass of step 2, read only the reports it rewrote, and update both files rather than starting them again: questions already answered (`- [x]`) or deferred (`- [-]`) keep their marks.

**Done when** `understanding/UNDERSTANDING.md` was written or updated in this pass, `understanding/OPEN-QUESTIONS.md` exists, and every `- [ ]` of both reports is accounted for.

**Next:** step 4, CLARIFY.
