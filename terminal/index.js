(function () {
  "use strict";

  if (window.__typoraTerminalLoaded) return;
  window.__typoraTerminalLoaded = true;

  var STYLE_ID = "typora-terminal-style";
  var FOOTER_ID = "footer-typora-terminal";
  var PANEL_ID = "footer-typora-terminal-panel";
  var OUTPUT_LIMIT = 120000;
  var KEY_LAST_CWD = "typora-terminal-last-cwd";

  var state = {
    isOpen: false,
    child: null,
    mode: "unknown", // interactive | bridge
    outputEl: null,
    inputEl: null,
    cwdEl: null,
    statusEl: null,
    panelEl: null,
    footerEl: null,
    closeOutsideHandler: null,
    destroyed: false,
  };
  var bootstrapTimer = null;

  function stripAnsi(input) {
    if (!input) return "";
    var text = String(input);
    // OSC ... BEL or ST
    text = text.replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "");
    // CSI sequences
    text = text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
    // DCS/PM/APC single escape wrappers
    text = text.replace(/\x1B[P^_][\s\S]*?\x1B\\/g, "");
    // Single-char ESC sequences
    text = text.replace(/\x1B[@-_]/g, "");
    // C1 + other non-printable controls except LF/TAB/CR
    text = text.replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, "");
    return text;
  }

  function appendOutput(text) {
    if (state.destroyed || !state.outputEl) return;
    state.outputEl.textContent += stripAnsi(text);
    if (state.outputEl.textContent.length > OUTPUT_LIMIT) {
      state.outputEl.textContent = state.outputEl.textContent.slice(-OUTPUT_LIMIT);
    }
    state.outputEl.scrollTop = state.outputEl.scrollHeight;
  }

  function setStatus(text, type) {
    if (state.destroyed || !state.statusEl) return;
    state.statusEl.textContent = text;
    state.statusEl.className = "typora-terminal-status " + (type || "normal");
  }

  function getBridgeRunner() {
    if (!window.bridge || !window.bridge.callHandler) return null;
    return function runCommand(command, cwd) {
      return new Promise(function (resolve, reject) {
        window.bridge.callHandler(
          "controller.runCommand",
          cwd ? { args: command, cwd: cwd } : { args: command },
          function (result) {
            var success = result && result[0];
            var stdout = (result && result[1]) || "";
            var stderr = (result && result[2]) || "";
            if (success) resolve(stdout || stderr || "");
            else reject(new Error(stderr || "Failed to run command via controller.runCommand"));
          }
        );
      });
    };
  }

  function getReqNode() {
    if (window.reqnode) return window.reqnode;
    if (typeof globalThis !== "undefined" && globalThis.reqnode) return globalThis.reqnode;
    return null;
  }

  function shQuote(value) {
    var s = String(value);
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  function getHomeDir() {
    var proc = typeof globalThis !== "undefined" ? globalThis.process : null;
    if (!proc || !proc.env) return "";
    return proc.env.HOME || proc.env.USERPROFILE || "";
  }

  function normalizeCwd(input) {
    var raw = String(input || "").trim();
    if (!raw) return "";
    var home = getHomeDir();
    if (raw === "~" && home) return home;
    if (raw.indexOf("~/") === 0 && home) return home + raw.slice(1);
    return raw;
  }

  function resolveCwd() {
    var cwd = state.cwdEl && state.cwdEl.value ? normalizeCwd(state.cwdEl.value) : "";
    if (state.cwdEl && cwd && state.cwdEl.value !== cwd) {
      state.cwdEl.value = cwd;
    }
    if (cwd) {
      try {
        localStorage.setItem(KEY_LAST_CWD, cwd);
      } catch (_e) {}
      return cwd;
    }
    return "";
  }

  function sendInteractive(command, withNewLine) {
    if (!state.child || !state.child.stdin) {
      appendOutput("\n[terminal] shell is not running\n");
      setStatus("Shell is not running", "warn");
      return;
    }
    try {
      state.child.stdin.write(command + (withNewLine ? "\n" : ""));
    } catch (e) {
      appendOutput("\n[terminal] failed to write stdin: " + String(e) + "\n");
      setStatus("Failed writing to shell", "error");
    }
  }

  function runBridgeCommand(command) {
    var runner = getBridgeRunner();
    if (!runner) {
      appendOutput("\n[terminal] bridge runCommand is unavailable\n");
      setStatus("No command bridge available", "error");
      return;
    }
    var cwd = resolveCwd();
    setStatus("Running command...", "normal");
    runner(command, cwd)
      .then(function (output) {
        if (output) appendOutput(output.endsWith("\n") ? output : output + "\n");
        setStatus("Command finished", "ok");
      })
      .catch(function (err) {
        appendOutput("[error] " + (err && err.message ? err.message : String(err)) + "\n");
        setStatus("Command failed", "error");
      });
  }

  function startInteractiveShell() {
    var reqnode = getReqNode();
    if (!reqnode) {
      state.mode = "bridge";
      appendOutput("\n[terminal] running in bridge mode (non-interactive).\n");
      setStatus("Bridge mode", "warn");
      return;
    }
    if (state.child) {
      setStatus("Shell already running", "ok");
      return;
    }

    var childProcess = reqnode("child_process");
    var fs = reqnode("fs");
    var os = reqnode("os");
    var pathMod = reqnode("path");
    var platform = os.platform();
    var proc = typeof globalThis !== "undefined" ? globalThis.process : null;
    var shell = platform === "win32" ? "powershell.exe" : (proc && proc.env && proc.env.SHELL) || "bash";
    var shellName = pathMod.basename(shell);
    var shellArgs = [];
    if (platform !== "win32" && (shellName === "bash" || shellName === "zsh")) {
      shellArgs = ["-l"];
    }
    var cwd = resolveCwd() || (proc && proc.env && proc.env.HOME) || undefined;

    try {
      var env = Object.assign({}, proc ? proc.env : {}, { TERM: "xterm-256color" });
      var child;
      var usePtyWrapper = false;
      if (platform !== "win32") {
        var scriptCandidates = [
          (proc && proc.env && proc.env.HOMEBREW_PREFIX ? proc.env.HOMEBREW_PREFIX + "/bin/script" : ""),
          "/home/linuxbrew/.linuxbrew/bin/script",
          "/usr/bin/script",
          "/bin/script",
        ].filter(Boolean);
        var scriptBin = scriptCandidates.find(function (p) {
          try {
            return fs.existsSync(p);
          } catch (_e) {
            return false;
          }
        });
        if (scriptBin) {
          var shellCmd = shQuote(shell) + (shellArgs.length ? " " + shellArgs.map(shQuote).join(" ") : "");
          child = childProcess.spawn(scriptBin, ["-qfec", shellCmd, "/dev/null"], {
            cwd: cwd,
            env: env,
            stdio: "pipe",
          });
          usePtyWrapper = true;
        }
      }
      if (!child) {
        child = childProcess.spawn(shell, shellArgs, {
          cwd: cwd,
          env: env,
          stdio: "pipe",
        });
      }
      state.child = child;
      state.mode = "interactive";

      if (child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", function (chunk) {
          appendOutput(chunk);
        });
      }
      if (child.stderr) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", function (chunk) {
          appendOutput(chunk);
        });
      }

      child.on("error", function (err) {
        appendOutput("\n[terminal] process error: " + (err && err.message ? err.message : String(err)) + "\n");
        setStatus("Shell error", "error");
      });

      child.on("exit", function (code, signal) {
        appendOutput("\n[terminal] shell exited (code=" + code + ", signal=" + signal + ")\n");
        state.child = null;
        setStatus("Shell exited", "warn");
      });

      appendOutput(
        "\n[terminal] interactive shell started" +
          (usePtyWrapper ? " (pty wrapper)" : "") +
          ": " +
          shell +
          (cwd ? " (cwd=" + cwd + ")" : "") +
          "\n"
      );
      setStatus("Interactive shell ready", "ok");
    } catch (e) {
      state.child = null;
      state.mode = "bridge";
      appendOutput("\n[terminal] failed to spawn shell, fallback to bridge mode: " + String(e) + "\n");
      setStatus("Fallback bridge mode", "warn");
    }
  }

  function stopInteractiveShell() {
    if (!state.child) return;
    try {
      state.child.kill("SIGTERM");
    } catch (_e) {}
    state.child = null;
    setStatus("Shell stopped", "warn");
  }

  function destroyTerminal() {
    if (state.destroyed) return;
    state.destroyed = true;
    if (bootstrapTimer) {
      clearInterval(bootstrapTimer);
      bootstrapTimer = null;
    }
    if (state.closeOutsideHandler) {
      document.removeEventListener("click", state.closeOutsideHandler);
      var content = document.querySelector("content");
      if (content) content.removeEventListener("click", state.closeOutsideHandler);
      state.closeOutsideHandler = null;
    }
    stopInteractiveShell();
  }

  function sendCommand(command) {
    var trimmed = (command || "").trim();
    if (!trimmed) return;
    appendOutput("\n$ " + trimmed + "\n");
    if (state.mode === "interactive") {
      sendInteractive(trimmed, true);
      return;
    }
    runBridgeCommand(trimmed);
  }

  function applyCwdNow() {
    var cwd = resolveCwd();
    if (!cwd) {
      setStatus("Working directory cleared", "warn");
      return;
    }

    // Bridge mode uses cwd per command; just persist and show state.
    if (state.mode !== "interactive" || !state.child) {
      setStatus("Working directory set", "ok");
      return;
    }

    // Interactive mode: apply immediately in current shell session.
    sendInteractive("cd " + shQuote(cwd), true);
    setStatus("Working directory updated", "ok");
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + FOOTER_ID + " { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }",
      "#" + FOOTER_ID + " .typora-terminal-icon { font-size:12px; font-weight:700; letter-spacing:0.5px; }",
      "#" + FOOTER_ID + " .typora-terminal-arrow { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; }",
      "#" + PANEL_ID + " { position:fixed; right:12px; bottom:38px; width:min(760px, calc(100vw - 24px)); height:min(62vh, 560px); background:var(--bg-color, #fff); color:var(--text-color, #111); border:1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius:8px; box-shadow:0 8px 28px rgba(0,0,0,.22); z-index:9999; display:none; flex-direction:column; overflow:hidden; }",
      "#" + PANEL_ID + ".open { display:flex; }",
      "#" + PANEL_ID + " .typora-terminal-header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-bottom:1px solid color-mix(in srgb, currentColor 16%, transparent); font-size:12px; }",
      "#" + PANEL_ID + " .typora-terminal-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }",
      "#" + PANEL_ID + " button { border:1px solid color-mix(in srgb, currentColor 24%, transparent); background:transparent; color:inherit; border-radius:6px; padding:2px 8px; line-height:1.5; cursor:pointer; font-size:12px; }",
      "#" + PANEL_ID + " button:hover { background:color-mix(in srgb, currentColor 10%, transparent); }",
      "#" + PANEL_ID + " .typora-terminal-output { flex:1; padding:10px; margin:0; overflow:auto; background:color-mix(in srgb, currentColor 3%, transparent); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; white-space:pre-wrap; word-break:break-word; }",
      "#" + PANEL_ID + " .typora-terminal-bottom { display:flex; flex-direction:column; gap:8px; padding:10px; border-top:1px solid color-mix(in srgb, currentColor 16%, transparent); }",
      "#" + PANEL_ID + " .typora-terminal-row { display:flex; gap:8px; align-items:center; }",
      "#" + PANEL_ID + " input { width:100%; min-width:0; border:1px solid color-mix(in srgb, currentColor 22%, transparent); background:transparent; color:inherit; border-radius:6px; padding:6px 8px; font-size:12px; }",
      "#" + PANEL_ID + " .typora-terminal-status.ok { color:#12a150; }",
      "#" + PANEL_ID + " .typora-terminal-status.warn { color:#c17d00; }",
      "#" + PANEL_ID + " .typora-terminal-status.error { color:#c62828; }",
    ].join("\n");
    document.head.appendChild(style);
  }

  function renderPanel() {
    if (state.panelEl) return;

    var panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div class="typora-terminal-header">' +
      '  <strong>Typora Terminal</strong>' +
      '  <div class="typora-terminal-actions">' +
      '    <button type="button" data-action="start">Start Shell</button>' +
      '    <button type="button" data-action="sigint">Ctrl+C</button>' +
      '    <button type="button" data-action="restart">Restart</button>' +
      '    <button type="button" data-action="clear">Clear</button>' +
      '  </div>' +
      '</div>' +
      '<pre class="typora-terminal-output"></pre>' +
      '<div class="typora-terminal-bottom">' +
      '  <div class="typora-terminal-row">' +
      '    <input type="text" data-role="cwd" placeholder="Working directory (optional)" />' +
      '    <span class="typora-terminal-status">Initializing...</span>' +
      '  </div>' +
      '  <div class="typora-terminal-row">' +
      '    <input type="text" data-role="cmd" placeholder="Type command and press Enter" />' +
      '  </div>' +
      '</div>';

    document.body.appendChild(panel);

    state.panelEl = panel;
    state.outputEl = panel.querySelector(".typora-terminal-output");
    state.inputEl = panel.querySelector('input[data-role="cmd"]');
    state.cwdEl = panel.querySelector('input[data-role="cwd"]');
    state.statusEl = panel.querySelector(".typora-terminal-status");

    var lastCwd = "";
    try {
      lastCwd = localStorage.getItem(KEY_LAST_CWD) || "";
    } catch (_e) {}
    if (lastCwd && state.cwdEl) state.cwdEl.value = lastCwd;

    panel.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      var action = target.getAttribute("data-action");
      if (!action) return;

      if (action === "start") {
        startInteractiveShell();
        return;
      }
      if (action === "sigint") {
        if (state.mode === "interactive" && state.child) {
          try {
            if (state.child.stdin) {
              state.child.stdin.write("\u0003");
              setStatus("Sent Ctrl+C", "warn");
            } else {
              state.child.kill("SIGINT");
              setStatus("Sent SIGINT", "warn");
            }
          } catch (e) {
            appendOutput("\n[terminal] failed to send SIGINT: " + String(e) + "\n");
            setStatus("SIGINT failed", "error");
          }
        } else {
          setStatus("SIGINT is only available in interactive mode", "warn");
        }
        return;
      }
      if (action === "restart") {
        stopInteractiveShell();
        startInteractiveShell();
        return;
      }
      if (action === "clear") {
        if (state.outputEl) state.outputEl.textContent = "";
        return;
      }
    });

    if (state.inputEl) {
      state.inputEl.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        var cmd = state.inputEl.value;
        state.inputEl.value = "";
        sendCommand(cmd);
      });
    }

    if (state.cwdEl) {
      state.cwdEl.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        applyCwdNow();
      });
      state.cwdEl.addEventListener("change", function () {
        applyCwdNow();
      });
      state.cwdEl.addEventListener("blur", function () {
        applyCwdNow();
      });
    }

    appendOutput("[terminal] plugin loaded\n");
    startInteractiveShell();
  }

  function setPanelOpen(open) {
    if (!state.panelEl) return;
    state.isOpen = open;
    if (open) {
      state.panelEl.classList.add("open");
      if (state.inputEl) state.inputEl.focus();
      if (!state.closeOutsideHandler) {
        state.closeOutsideHandler = function () {
          setPanelOpen(false);
        };
        document.addEventListener("click", state.closeOutsideHandler);
        var content = document.querySelector("content");
        if (content) content.addEventListener("click", state.closeOutsideHandler);
      }
    } else {
      state.panelEl.classList.remove("open");
      if (state.closeOutsideHandler) {
        document.removeEventListener("click", state.closeOutsideHandler);
        var content2 = document.querySelector("content");
        if (content2) content2.removeEventListener("click", state.closeOutsideHandler);
        state.closeOutsideHandler = null;
      }
    }
  }

  function renderFooter() {
    if (state.footerEl || document.getElementById(FOOTER_ID)) return;

    var footer = document.querySelector("footer.ty-footer");
    var item = document.createElement("div");
    item.className = "footer-item footer-item-right";
    item.id = FOOTER_ID;
    item.setAttribute("ty-hint", "Typora Terminal");
    item.innerHTML =
      '<span class="typora-terminal-icon">>_</span><span class="typora-terminal-arrow"></span>';

    item.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!state.panelEl) renderPanel();
      setPanelOpen(!state.isOpen);
    });

    if (footer) {
      var firstRight = footer.querySelector(".footer-item-right");
      if (firstRight) firstRight.insertAdjacentElement("beforebegin", item);
      else footer.appendChild(item);
    } else {
      item.style.position = "fixed";
      item.style.bottom = "6px";
      item.style.right = "12px";
      item.style.zIndex = "9999";
      document.body.appendChild(item);
    }
    state.footerEl = item;
  }

  function bootstrap() {
    ensureStyle();
    renderFooter();
    renderPanel();
    setPanelOpen(false);
    setStatus(state.mode === "interactive" ? "Interactive shell ready" : "Bridge mode", "ok");
  }

  function waitAndBootstrap() {
    var tries = 0;
    bootstrapTimer = setInterval(function () {
      tries += 1;
      if (document.readyState === "complete" || document.querySelector("footer.ty-footer")) {
        clearInterval(bootstrapTimer);
        bootstrapTimer = null;
        bootstrap();
      } else if (tries > 120) {
        clearInterval(bootstrapTimer);
        bootstrapTimer = null;
        bootstrap();
      }
    }, 250);
  }

  window.addEventListener("beforeunload", destroyTerminal);
  window.addEventListener("unload", destroyTerminal);
  waitAndBootstrap();
})();
