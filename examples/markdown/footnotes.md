# Procurement review with footnotes

This review keeps dense source notes readable while preserving the original Markdown.[^overview]

| Responsibility | Review state |
| --- | --- |
| Oversee agency budgeting, forecast revenue, and manage procurement[^42-1] | Pending |
| Confirm final approval before publication[^approval] | Ready for review |

The procurement decision remains pending after the table.[^42-1]

## Source and safety boundaries

An undefined reference stays literal[^not-defined], and inline code stays literal: `do not render [^overview] here`.

```markdown
Fenced references also stay literal[^approval].

[^approval]: This fenced definition is not active.
```

[^overview]: Footnotes render at the end of the served document. Their definition text remains selectable and commentable without changing this source file.

[^42-1]: Under **executive approval** with a [safe policy link](https://example.com/policy).

    A second paragraph can carry more context for the reviewer.

[^approval]: Final approval must remain explicit. <script>alert("unsafe")</script>
