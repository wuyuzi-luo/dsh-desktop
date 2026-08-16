# dsh-desktop-launcher

dsh plugin: launch the [dsh-desktop](https://github.com/wuyuzi-luo/dsh-desktop) Windows shell from the DSH conversation via a `desktop_launch` tool.

dsh-desktop is a standalone Electron desktop shell for DeepSeek Harness: system tray, Skills/MCP manager panel, custom skins, auto-update (app + dsh itself), and a beginner-friendly first-run guide.

## Install

```sh
dsh plugin --profile web add dsh-desktop-launcher
```

Then ask your agent to "open the desktop app", or call the `desktop_launch` tool directly. If the shell is not installed yet, the tool returns the download link to the latest GitHub Release.

## How it works

- Detects the installed `dsh-desktop.exe` across NSIS default / per-user / per-machine layouts.
- Launches it detached via `cmd /c start` — the shell keeps running when dsh exits.
- Zero runtime dependencies; node builtins only.
