# Heading ladder: punctuation, repeats, and Unicode

The ladder makes every supported heading level and label edge case visible in one document map.

### A skipped level appears first

This h3 intentionally arrives before the first h2. Document order wins; the ruler never invents a missing level.

## Repeated heading

The first repeated label should receive the stable id `repeated-heading`.

### Repeated heading

The second occurrence must receive a deterministic collision suffix.

#### Punctuation: maps, marks & meaning?!

Punctuation is removed from generated ids while the rendered label remains unchanged.

##### Español: revisión rápida — acción

h5 is included as a navigable heading with a 14px tick: shorter than h4, longer than the ordinary 10px content tick.

###### 日本語の見出し 🧭

h6 is also included, with a 12px tick and its exact rendered label. It is not omitted or silently treated as a paragraph.

## This is an intentionally long heading label that should truncate cleanly in the expanded ruler without creating a background card or horizontal document overflow

The full label stays available to assistive technology and remains the heading's exact text.

#### <script>heading-like text stays escaped</script>

HTML-like text cannot become executable markup or inject a ruler label.
