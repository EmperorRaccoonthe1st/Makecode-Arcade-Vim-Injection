// ==UserScript==
// @name         MakeCode Monaco Vim Bindings (V18.1 - NeoVim Polish)
// @namespace    http://tampermonkey.net/
// @version      18.1
// @description  Hardened AMD MitM, deterministic DOM binding, and sleek NeoVim Status Bar
// @match        https://arcade.makecode.com/*
// @run-at       document-start
// @resource     monacoVim https://cdn.jsdelivr.net/npm/monaco-vim@0.4.2/dist/monaco-vim.js
// @grant        GM_getResourceText
// ==/UserScript==

(function() {
    'use strict';
    console.log("==================================================");
    console.log(" [Vim Injector] V18.1 NeoVim Polish Booting...");
    console.log("==================================================");

    let vimScriptText;
    try {
        vimScriptText = GM_getResourceText("monacoVim");
        if (!vimScriptText || vimScriptText.length < 100000) throw new Error("Invalid resource payload.");
    } catch (e) {
        console.error("[Vim Injector] FATAL: @resource failed.");
        return;
    }

    // Transfer payload across sandbox boundary
    const dataNode = document.createElement('div');
    dataNode.id = "vim-payload-transfer";
    dataNode.style.display = "none";
    dataNode.textContent = vimScriptText;
    document.documentElement.appendChild(dataNode);

    function nativePageExecution() {
        console.log("[Native Space] Context Secured. Commencing hardened interception.");
        const rawVimLibrary = document.getElementById('vim-payload-transfer').textContent;
        let isLibraryInjected = false;
        let activeVimInstance = null;

        // 1. Inject the Vim Library Safely
        function injectVimLibrary() {
            if (isLibraryInjected) return;
            console.log("[Native Space] Blinding AMD and evaluating monaco-vim...");
            try {
                const _tempDefine = window.define;
                window.define = undefined;

                const scriptEl = document.createElement('script');
                scriptEl.textContent = rawVimLibrary;
                document.head.appendChild(scriptEl);

                window.define = _tempDefine;
                isLibraryInjected = true;
                console.log("[Native Space] Library evaluation complete.");
            } catch(e) {
                console.error("[Native Space] Failed to evaluate library:", e);
            }
        }

        // 2. Create the NeoVim Status Bar (Updated Version)
        function createStatusBar(editorDomNode) {
            let statusBar = document.getElementById('monaco-vim-status-bar');
            if (!statusBar) {
                // Inject NeoVim/Powerline-inspired styles
                const style = document.createElement('style');
                style.textContent = `
                    #monaco-vim-status-bar {
                        display: flex !important;
                        height: 26px !important;
                        background: #1f1f1f !important; /* Base color */
                        color: #dcdcdc !important;
                        font-family: 'Menlo', 'Monaco', 'Consolas', monospace !important;
                        font-size: 11px !important;
                        font-weight: 700 !important;
                        border-top: 1px solid #3c3c3c !important;
                        overflow: hidden;
                    }
                    /* Segmented Powerline effect */
                    #monaco-vim-status-bar .vim-segment {
                        padding: 0 15px !important;
                        display: flex;
                        align-items: center;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        clip-path: polygon(0 0, 90% 0, 100% 100%, 10% 100%);
                        margin-right: -10px;
                    }
                    /* Normal Mode: Blue */
                    .vim-mode-normal { background: #569cd6 !important; color: #000 !important; z-index: 3; }
                    /* Insert Mode: Green/Teal */
                    .vim-mode-insert { background: #4ec9b0 !important; color: #000 !important; z-index: 3; }

                    /* Command Palette Tweaks */
                    .vim-command-line {
                        background: #2d2d2d !important;
                        border: 1px solid #555 !important;
                        color: #fff !important;
                        padding: 6px 10px !important;
                        box-shadow: 0 4px 10px rgba(0,0,0,0.5) !important;
                        border-radius: 0 !important;
                        font-family: 'Consolas', monospace !important;
                    }
                `;
                document.head.appendChild(style);

                statusBar = document.createElement('div');
                statusBar.id = 'monaco-vim-status-bar';
                editorDomNode.appendChild(statusBar);

                // Increase editor height slightly for the bar
                const currentHeight = parseInt(editorDomNode.style.height || 0);
                if (currentHeight) editorDomNode.style.height = (currentHeight + 26) + 'px';
            }
            return statusBar;
        }

        // 3. Deterministic Binding Engine
        function bindVimToEditor(editor) {
            if (activeVimInstance) {
                activeVimInstance.dispose(); // Clean up old bindings if recreating
            }

            // Poll until the editor is physically painted on the screen
            const checkReady = setInterval(() => {
                const domNode = editor.getDomNode();
                if (domNode && document.body.contains(domNode) && editor.getModel()) {
                    clearInterval(checkReady);

                    if (!window.MonacoVim) {
                        console.error("[Native Space] Bind aborted: window.MonacoVim is missing.");
                        return;
                    }

                    console.log("[Native Space] Editor DOM is stable. Binding Vim Mode...");
                    const statusBar = createStatusBar(domNode);

                    try {
                        activeVimInstance = window.MonacoVim.initVimMode(editor, statusBar);
                        console.log("✅ [Native Space] Vim successfully bound with Status Bar!");
                    } catch (err) {
                        console.error("❌ [Native Space] Binding failed:", err);
                    }
                }
            }, 100);

            // Failsafe timeout
            setTimeout(() => clearInterval(checkReady), 10000);
        }

        // 4. The AMD Hook
        let _require = window.require;
        Object.defineProperty(window, 'require', {
            get: () => _require,
            set: (originalRequire) => {
                _require = function(...args) {
                    const deps = args[0];
                    if (Array.isArray(deps) && deps.includes('vs/editor/editor.main') && typeof args[1] === 'function') {
                        const originalCb = args[1];
                        args[1] = function(...cbArgs) {
                            const monacoAPI = cbArgs[deps.indexOf('vs/editor/editor.main')];

                            if (monacoAPI && monacoAPI.editor) {
                                console.log("[Native Space] AMD Intercepted. Exposing global API.");
                                window.monaco = monacoAPI;
                                injectVimLibrary();

                                const originalCreate = monacoAPI.editor.create;
                                monacoAPI.editor.create = function(...createArgs) {
                                    console.log("[Native Space] Editor.create() called.");
                                    const editor = originalCreate.apply(this, createArgs);
                                    bindVimToEditor(editor);
                                    return editor;
                                };
                            }
                            return originalCb.apply(this, cbArgs);
                        };
                    }
                    return originalRequire.apply(this, args);
                };
                Object.assign(_require, originalRequire);
            },
            configurable: true
        });
    }

    const logicScriptEl = document.createElement('script');
    logicScriptEl.textContent = `(${nativePageExecution.toString()})();`;
    document.documentElement.appendChild(logicScriptEl);
})();
