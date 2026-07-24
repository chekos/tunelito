# Project status

<details class="project-group" onclick="alert('unsafe')">
<summary style="color: red">Collapsed project group</summary>

Targeted review note inside a collapsed section.

<!-- This private note must stay hidden. -->

<img src=x onerror="alert('unsafe')">
<script>alert("unsafe")</script>

</details>

<details open data-state="expanded" onmouseover="alert('unsafe')">
<summary id="open-group">Initially open project group</summary>

The safe `open` attribute survives, while every other attribute is stripped.

</details>

Inline disclosure: <details open onclick="alert('unsafe')"><summary class="label">Inline details</summary>Inline body with <iframe src="https://example.com"></iframe>.</details>

`<details open onclick="literal()"><summary>Inline code stays literal</summary></details>`

```html
<details open onclick="literal()">
<summary>Fenced code stays literal</summary>
</details>
```
