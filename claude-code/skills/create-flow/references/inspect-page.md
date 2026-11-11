---
name: inspect-page
description: Inspect an area of a page in the user's open, signed-in Chrome tab and report what is implemented there.
argument-hint: "<url> <area>"
disable-model-invocation: true
---

# inspect-page

Using the chrome-devtools MCP, inspect the **area** the user named (a panel, a table, a form) on a page they already have open and signed in, and report what is implemented there. If they named no area, ask for one.

## Steps

1. **Attach.** `list_pages`, `select_page` the tab matching the URL, then `take_snapshot`. Done when the snapshot shows the signed-in app at that URL.
   - No tab matches: show the user the open URLs and ask which one.
   - A sign-in page: wait for the user to sign in, then snapshot again.
   - No browser reachable: ask the user to turn on remote debugging at `chrome://inspect/#remote-debugging`.

2. **Capture.** Find the area in the snapshot and take a screenshot of it. Record its structure (sections, fields, columns, labels, visible text) and the data it shows. Done when every part of the area is accounted for.

3. **Exercise.** Use each control in the area that changes what the page shows (tabs, menus, modals, sort, filter, pagination, expand, field validation), and record what each one does. Put the page back to how it was after each one. Leave controls that write data (submit, save, delete, send) unused, and report what each seems to do. Done when every control is either exercised or listed as unexercised.

4. **Report** to the user, then ask whether they want it saved to a file, and where:
   - **Area**: URL and what the area is for, in one line.
   - **Structure**: what it contains.
   - **Behavior**: each control → what it does; then the unexercised controls.
   - **Open questions**: what the page alone cannot show (permissions, empty and error states, data rules).
