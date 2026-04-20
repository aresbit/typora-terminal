# Typora Terminal

Embed a lightweight terminal panel into Typora and run commands (directly.

## Dependency

This integration currently targets the **Typora-Plugin** ecosystem (`/usr/share/typora/resources/plugin`).

- If you already use Typora-Plugin: use the scripts below (recommended).
- If you do not use Typora-Plugin: this repo's current installer does not auto-wire the plain `window.html` path.

## Install (Typora-Plugin mode)

1. Ensure `terminal/index.js` is up to date.
2. Run installer:

```bash
sudo ./terminal/scripts/install-typora-terminal-as-typora-plugin.sh
```

3. Restart Typora.

The installer also auto-fixes ownership/permissions of Typora-Plugin user settings files.

If Typora resources are not at `/usr/share/typora/resources`, pass `TYPORA_RES`:

```bash
sudo TYPORA_RES=/your/typora/resources ./terminal/scripts/install-typora-terminal-as-typora-plugin.sh
```

## Fix common issue (TOML conflict)

If Typora-Plugin reports invalid TOML, run:

```bash
sudo ./terminal/scripts/fix-typora-terminal-toml.sh
```

If Typora-Plugin reports `EACCES` when writing settings:

```bash
sudo ./terminal/scripts/fix-typora-plugin-settings-permissions.sh
```

## Usage

- Open Typora.
- Click `>_` icon in footer.
- Type commands and press Enter.
- The shell starts in interactive mode and prefers PTY wrapper (`script`) to improve CLI compatibility.

## Cross-machine reuse

Yes, you can reuse on other machines directly if:

- Typora is installed.
- Typora-Plugin is installed at the standard path.
- The install script is executed with sudo.

Recommended rollout on another machine:

```bash
git clone <this-repo>
cd typora-terminal
sudo ./terminal/scripts/install-typora-terminal-as-typora-plugin.sh
```

## Notes

- Working directory can be set in the top input field and is persisted.
- Output ANSI control sequences are filtered for readability.
