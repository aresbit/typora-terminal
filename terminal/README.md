# Typora Claude Terminal

Embed a lightweight terminal panel into Typora and run commands (including `claude`) directly.

## Install (manual)

1. Find Typora resource folder.
2. Create folder `terminal` under Typora resource folder.
3. Copy `terminal/index.js` from this repo into Typora resource folder's `terminal/` directory.
4. Edit Typora HTML entry file:
   - Windows/Linux: `window.html`
   - macOS: `index.html`
5. Add script tag after Typora app script:

```html
<script src="./terminal/index.js" defer="defer"></script>
```

(For macOS, `defer` without explicit value also works.)

## Usage

- Open Typora.
- Click `>_` icon in footer.
- Use `Run claude` quick button or type commands and press Enter.
- In Node-enabled Typora runtime it runs interactive shell mode.
- In bridge-only runtime it runs one-shot command mode via `controller.runCommand`.

## Notes

- Working directory can be set in the top input field and is persisted.
- `Ctrl+C` button only works in interactive mode.
