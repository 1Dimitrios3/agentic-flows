# 1. INTAKE

Collect every input source from the human: SRS documents, raw text, Figma exports, screenshots, pages to inspect.

- Copy files into `sources/`, or record their path or URL.
- For a page, read `<skill>/references/inspect-page.md` and follow it with the human. Save its report into `sources/`, along with the raw JSON response of each data request the area makes (`list_network_requests`, `get_network_request`), one file per request, and any form markup that holds its field rules.
- List every source in `sources/INDEX.md`: path or URL, type, one-line purpose.

Once the sources are saved, ask the human, in a message of its own, whether the list is complete and whether any source has a newer version. Then wait for the reply. The message that gave you the sources is not that reply. Write their answer, quoted and dated, at the foot of `sources/INDEX.md`.

**Done when** `sources/INDEX.md` lists every source, and the human has said the list is complete.

**Next:** step 2, DISCOVERY.
