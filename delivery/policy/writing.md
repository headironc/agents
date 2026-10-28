# Writing conventions

## Content and sources

- Write each document in one primary language. Keep technical terms, identifiers, proper names, and necessary quotations in their original language; do not rewrite evidence solely to make the document monolingual.
- State current rules, behavior, reasons, and limitations directly. Keep discussion transcripts and approval chronology out of the main explanation.
- Distinguish proposals, accepted decisions, observations, and historical records where the distinction changes the meaning. Do not present a plan or old result as current implementation evidence.
- Verify sources for material factual claims. Use only the dates, identities, precision, and scope the available evidence supports.
- Define a fact or rule once and reference it elsewhere. Prefer updating an existing document over creating a competing copy.
- When a new current document takes over a topic, first ensure the new document carries any still-needed unique decisions, evidence, exceptions, and domain-required history from the older active documents. Then remove all of that topic's substance from those documents, including passages that remain accurate, and keep only navigation that helps a reader reach the new owner. Update the dependent tables, plans, evidence notes, and cross-references in the same change. Explicitly retained historical originals are not active documents.
- Keep only guidance that helps a reader act correctly. Delete generic advice, duplication, obsolete discussion, and resolved issue narratives from active guidance.
- Before deleting or merging content, preserve still-needed decisions, evidence, exceptions, and domain-required history. Retiring a process does not require preserving all its old instructions elsewhere.
- Preserve explicitly retained historical originals and their scope; distinguish later annotations from the original. Git history can preserve retired source without keeping it in active navigation.
- Update related examples, tables, diagrams, and surrounding explanations when meaning changes, including passages without the changed identifier. Reach the places that restate a fact without repeating its name: index and navigation lines that summarize a target, scope sentences that say what a document or capability covers, and cross-document references that describe another file's contents. A retirement is finished only when the dependent candidate tables, evidence lines, and pointers no longer assume the retired rule.
- Use stable references and project-supported links. A valid link proves reachability, not that it supports the claim. Use exact revisions when a historical claim depends on them.
- Keep important unresolved questions visible. Do not turn missing evidence into certainty or make unadopted optional advice appear to be unfinished work.
- Describe PRs by the complete change's problem, resulting behavior, and relevant validation. Write release notes around user-visible changes.
- Organize ordinary Markdown prose into paragraphs, each developing one coherent point. Keep related sentences together on one source line per paragraph; the sentence-length advice measures sentences, not source lines, and does not require one sentence per line. Preserve headings, lists, tables, code, and intentional hard breaks. Follow an explicit destination requirement when it calls for different wrapping.

## Sentence-level conventions

Apply the sentence guidance to the language of the prose being read. A technical term or short quotation in another language does not change the surrounding prose's language. A substantial Chinese passage quoted in English still receives Chinese length advice. Spacing applies wherever Chinese characters touch Latin letters or digits. The checker approximates these boundaries; its [tool contract](tool-contracts.md#prose-check) describes how it does so and where it can miss. Do not rewrite necessary evidence merely to satisfy its inference.

These conventions cover running prose, not headings, table cells, quoted blocks, code, or markup comments. Apply them throughout each file you change, including existing prose, while preserving retained historical originals. Move an enumeration into a table only when the table serves readers; do not use an excluded construct to hide a spacing error. Review sentence-length cautions throughout the file, but keep a clear sentence intact when splitting it would obscure the meaning. If a gate hides individual cautions, run the prose checker directly on each changed file to locate them. A scoped gate checks only its reported scope; disclose findings outside it rather than treating a scoped pass as whole-file compliance.

- Give each pronoun one possible referent, and prefer repeating the noun over relying on one. `其`, `该`, `此`, `这`, `it`, `this` and `these` all make the reader resolve a reference, and a demonstrative reads better with its noun: `Set this value to true` rather than `Set this to true`.
- Chain at most two nouns as modifiers of another noun. Move any further modifier into a clause or a prepositional phrase.
- State the condition that holds instead of the one that does not, and never use a double negative. Write `用户必须拥有删除权限，才能删除此文件` rather than `没有删除权限的用户，不能删除此文件`.
- Name the actor and use the active voice. A passive instruction hides who has to act, and an instruction exists to say exactly that.
- Separate a requirement from narration in the wording itself. An imperative states a requirement plainly and needs no grading word, so prefer it for an instruction. When a requirement needs a grade, each language below fixes a small set for that purpose; take the grade from that set and nowhere else, and keep it rare. Narration never borrows the set: a grading verb on a passage that merely describes behavior makes every real requirement weaker.

### Chinese passages

- Prefer sentences under 20 characters where the meaning allows. Review sentences of 30 characters or more for clarity. A sentence over 40 characters usually needs a semantic break, but keep it intact when splitting would obscure the meaning. Length is an editorial signal, not a pass/fail rule.
- Count reader-visible prose rather than Markdown syntax. Ignore whitespace and inline code. Do not count bare URLs or autolinks toward sentence length; count a labeled link's displayed text, not its URL destination. A sentence ends at `。`, `！` or `？`; the terminator does not count. Measure a substantial Chinese passage quoted in another language on its own length, even without a terminator. A single Latin term within that passage does not split it; two or more Latin words do, and the longer Chinese part is measured. Do not count the surrounding prose against it.
- Grade a requirement with `必须`, `不得`, `应` or `可`, and no other word. An imperative prohibition such as `不要` or `禁止` states the requirement without grading it and stays available. Every other word carries no grade, whether it runs longer than a set member or shorter: `可以` and `不能` report what something can and cannot do, `需要` reports what it takes, and `需`, `要` and `都要` are contractions the set does not admit. A directive sentence takes `可` where narration would say `可以`, and `必须` where it would say `需要`, `需`, `要` or `都要`.
- Put one space between a Chinese character and an adjacent Latin letter or Arabic numeral. Inline code spans and bare URLs render as Latin, so their edges also need that space. Punctuation of either width already separates the scripts, as does an inline image. A run that opens a line has nothing on its left to separate.

### English passages

- No source consulted here states a numeric sentence limit for English, so this file sets none. Keep one idea per sentence, and turn an embedded list or a chain of alternatives into a list.
- Grade a requirement with `must`, `must not`, `should`, `should not` or `may`, and no other word. A bare imperative states the requirement without grading it and stays available, which is how most of this file is written.

## References

These references provide background for the sentence-level conventions. The statements above define the choices adopted here, including the thresholds.

- [中文技术文档的写作规范](https://www.ruanyifeng.com/blog/2016/10/document_style_guide.html)
- [中文技术文档写作风格指南](https://zh-style-guide.readthedocs.io/)
- [Google developer documentation style guide: write for a global audience](https://developers.google.com/style/translation)
- [Google developer documentation style guide: active voice](https://developers.google.com/style/voice)
- [Google developer documentation style guide: pronouns](https://developers.google.com/style/pronouns)
- [Google technical writing: short sentences](https://developers.google.com/tech-writing/one/short-sentences)
- [RFC 2119: key words for requirement levels](https://www.rfc-editor.org/rfc/rfc2119)
