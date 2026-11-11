# screenplay-markdown-v1

`screenplay-markdown-v1` is a small authoring convention for writing a screenplay as ordinary Markdown so that people and agents can edit one `.md` file and review it in Tunelito with screenplay typography:

```sh
tunelito ./primera-chamba.screenplay.md --theme screenplay --section-index --no-tunnel
```

The Markdown file stays the only editable source. The `screenplay` theme only changes how Tunelito presents it; it never rewrites the file, extracts text elsewhere, or starts an agent. Any other Markdown viewer still shows a legible document.

## Selecting the theme

Use the existing theme setting. CLI beats project config, which beats global config, which beats the built-in default:

- one session: `--theme screenplay`
- one project: `tunelito.config.json` with `{ "theme": "screenplay" }`
- check the result: `tunelito config show ./script.md --json`

There is no auto-detection, file extension, or front-matter switch. In folder mode the selected theme applies to every Markdown page, so serve one screenplay or a dedicated screenplay folder.

## Elements

| Element | Source | Presentation under `screenplay` |
| --- | --- | --- |
| Title | One `# Episode title` | Centered, prominent title. |
| Series, episode, draft, author, language | Optional leading YAML front matter | The existing Properties panel. Metadata is never dialogue. |
| Convention marker | `conventions: "screenplay-markdown-v1"` in front matter | Descriptive metadata only. It does not activate the theme. |
| Scene heading (slugline) | `## INT. RESTAURANTE — DÍA` | Bold, left aligned, body size, extra space above. Written in any language; nothing is guessed or uppercased. |
| Beat, time change, act label | `### MINUTOS DESPUÉS`, `### ACTO UNO` | Bold, left aligned, with a break before the next action. |
| Action, description, camera direction | An ordinary paragraph outside a blockquote | Full action-column width, left aligned. Uppercase words stay ordinary text. |
| Dialogue turn | One blockquote whose first paragraph is exactly one bold cue, followed by dialogue paragraphs | A narrower centered column with left-aligned dialogue. No quote rail, tint, or italics. |
| Character cue | `> **INÉS**` | Bold, centered over its dialogue. Accents, spelling and punctuation are kept. |
| Character extension | `> **INÉS (V.O.)**`, `> **MARIBEL (O.S.)**`, `> **LALO (CONT'D)**` | Shown literally. No automatic continuation logic. |
| Parenthetical | Its own paragraph inside a turn that is only an emphasis wrapped in parentheses: `> *(en voz baja)*` | Left aligned in the dialogue column, close to the next line, parentheses kept. Before dialogue or between dialogue paragraphs. |
| Dialogue continuation | More plain paragraphs inside the same blockquote | Same speaker until the blockquote ends. Separate turns by the same character stay separate. |
| Transition or end marker | `#### CORTE A TÍTULOS.`, `#### FUNDIDO A NEGRO.`, `#### FIN.` | Its own left-aligned line with space around it. Nothing is added. |
| Private author note | `<!-- note -->` | Hidden from the rendered page, kept in the source. Review comments still go to Tunelito's comments inbox. |

## Whitespace and block boundaries

- Keep each action or dialogue paragraph on one source line and let your editor wrap.
- Inside a turn, put a `>`-only line between paragraphs.
- Between turns, leave a blank line with no `>`.
- The cue and the dialogue must be separate paragraphs. `> **INÉS**` followed directly by `> Hola.` on the next line is one paragraph and stays an ordinary quote.
- Markdown hard breaks (two trailing spaces or a trailing backslash) are allowed when a line break is intentional, but are never needed to identify a speaker.
- No indentation is required.

## Recognition rules

A blockquote is a dialogue turn only when all of these hold:

1. It is a top-level block (not inside a list or another quote).
2. It contains only paragraphs.
3. Its first paragraph is exactly one bold (`**…**`) node of nonempty plain text.
4. At least one later paragraph is spoken dialogue (not a parenthetical).

A paragraph inside a turn is a parenthetical when it is exactly one emphasis (`*…*`) node whose text starts with `(` and ends with `)`. Ordinary emphasis inside spoken lines is still allowed.

Any quote that does not match (no dialogue, an unbolded cue, extra text in the cue paragraph, nested quotes, lists, or code) renders as an ordinary blockquote. Content is never dropped, and speakers are never inferred from ALL CAPS. Fenced code stays literal. Other headings and Markdown elements keep readable fallback styling. The classification only happens under the `screenplay` theme; every other theme renders the same file as ordinary Markdown.

## Example

````markdown
---
series: "Quedamos bien"
episode: "Primera chamba"
draft: "Versión siete"
language: "es-MX"
conventions: "screenplay-markdown-v1"
---

# Primera chamba

## INT. RESTAURANTE LOS LAURELES — DÍA

Inés camina de espaldas entre las mesas. Lleva una cámara y una mochila que se le resbala del hombro.

> **LALO**
>
> ¿Y cuánto rato vamos a tener que cerrar?

> **MARIBEL**
>
> Nada. Ustedes sigan normal.

### MINUTOS DESPUÉS

El cliente mira el plato, el diablito y a Inés y Maribel. Se ríe bajito.

> **CLIENTE**
>
> *(con marcado acento mexicano)*
>
> Show business.

#### CORTE A TÍTULOS.
````

`examples/markdown/screenplay.md` is a larger public fixture with edge cases: accented names, V.O./O.S./CONT'D, parentheticals between paragraphs, repeated lines under different cues, hard breaks, long names and speeches, and quotes that intentionally fall back.

## Layout, print, and limits

The theme uses the bundled Paper Mono with Courier fallbacks at 16px, an action column of about 68 characters, and a centered dialogue column of about 50 characters. At phone widths the gutters and dialogue indent shrink instead of the type. Light and dark modes share the same geometry. The existing section index lists scenes (`##`) and beats (`###`), never character cues.

Browser print gives black-on-white script text without the review panel, document map, section index, or Properties. Cues try to stay with the start of their dialogue, and long speeches flow across pages.

This is a review layout, not production pagination. Out of scope: exact screenplay page breaks and page counts, automatic MORE/CONT'D, headers, PDF export, Fountain/FDX import or export, dual dialogue, scene numbering, revision colors, and cast extraction.
