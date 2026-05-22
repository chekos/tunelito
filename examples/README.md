# Tunelito Examples

## `simple-review.html`

A small styled HTML page with normal DOM text and no custom review JavaScript. Use this for smoke tests:

```bash
tunelito examples/simple-review.html --no-tunnel --open
```

## `legacy-data-architecture-review.html`

The original self-contained review prototype that inspired Tunelito. It is useful as a stress/regression fixture because it already has its own review UI and a lot of embedded JavaScript.

For normal beta demos, prefer `simple-review.html`.
