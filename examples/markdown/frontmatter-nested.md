---
status: active
empty-value:
quoted-punctuation: "owner: design, status: ready? yes!"
long-value: "This intentionally long metadata value checks wrapping and overflow without turning the properties drawer into the primary reading surface."
description: |
  A literal multiline value keeps its line breaks.
  The article remains available beside it.
folded: >
  A folded value becomes a readable sentence
  without exposing YAML syntax in the article.
owners:
  product:
    name: Chekos
    role: maintainer
  review:
    team: Design systems
    timezone: America/Los_Angeles
milestones:
  - name: Parser
    complete: true
  - name: Browser evidence
    complete: false
mixed:
  - alpha
  - 2
  - enabled: true
    note: nested object
"<script>property key</script>": "<img src=x onerror=alert(1)>"
---

# Nested metadata stress note

Complex maps, arrays of objects, mixed arrays, nulls, multiline strings, punctuation, and hostile-looking text should stay ordered, bounded, escaped, and readable.

No value in the drawer should degrade to `[object Object]` or introduce horizontal document overflow.
