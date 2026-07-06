// ==UserScript==
// @name         MakeCode Monaco Vim Bindings (V21.1 - True NerdFont Powerline)
// @namespace    http://tampermonkey.net/
// @version      21.1
// @description  Anti-aliased CSS Border Chevrons, NerdFonts, and VS Code palette
// @match        https://arcade.makecode.com/*
// @run-at       document-start
// @resource     monacoVim https://cdn.jsdelivr.net/npm/monaco-vim@0.4.2/dist/monaco-vim.js
// @grant        GM_getResourceText
// ==/UserScript==

(function() {
    'use strict';
    console.log("==================================================");
    console.log("✨ [Vim Injector] V21.1 Aesthetic Overhaul Booting...");
    console.log("==================================================");

    let vimScriptText;
    try {
        vimScriptText = GM_getResourceText("monacoVim");
        if (!vimScriptText || vimScriptText.length < 100000) throw new Error("Invalid resource payload.");
    } catch (e) {
        console.error("[Vim Injector] FATAL: @resource failed.");
        return;
    }

    const dataNode = document.createElement('div');
    dataNode.id = "vim-payload-transfer";
    dataNode.style.display = "none";
    dataNode.textContent = vimScriptText;
    document.documentElement.appendChild(dataNode);

    function nativePageExecution() {
        const rawVimLibrary = document.getElementById('vim-payload-transfer').textContent;
        let isLibraryInjected = false;
        let activeVimInstance = null;

        function injectVimLibrary() {
            if (isLibraryInjected) return;
            try {
                const _tempDefine = window.define;
                window.define = undefined;
                const scriptEl = document.createElement('script');
                scriptEl.textContent = rawVimLibrary;
                document.head.appendChild(scriptEl);
                window.define = _tempDefine;
                isLibraryInjected = true;
            } catch(e) { console.error("[Native Space] Injection Error:", e); }
        }

        function createStatusBar(editor) {
            const editorDomNode = editor.getDomNode();
            const container = editorDomNode.parentElement;
            let statusContainer = document.getElementById('neovim-status-container');

            if (!statusContainer) {
                const style = document.createElement('style');
                style.textContent = `
                    /* --- CSS VARIABLES & VS CODE / TOKYONIGHT THEME --- */
                    :root {
                        --pl-bg: #1f1f1f; /* Native VS Code Background */
                        --pl-border: #2b2b2b;
                        --pl-text: #cdd6f4;
                        --pl-height: 24px;

                        --pl-normal: #89b4fa;
                        --pl-insert: #a6e3a1;
                        --pl-visual: #cba6f7;
                        --pl-command: #f9e2af;

                        --pl-seg1: #282a36; /* Encoding - Darkest */
                        --pl-seg2: #3b4252; /* Language - Mid */
                        --pl-seg3: #89b4fa; /* Position - Highlight */

                        /* Arrow width controls the sharpness of the chevron */
                        --pl-arrow-w: 12px;
                    }

                    /* Base Container */
                    #neovim-status-container {
                        position: absolute; bottom: 0; left: 0; width: 100%; height: var(--pl-height);
                        background: var(--pl-bg); border-top: 1px solid var(--pl-border);
                        display: flex; justify-content: space-between; align-items: stretch;
                        z-index: 9999;
                        font-family: 'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'Hack Nerd Font', 'Menlo', monospace;
                        font-size: 11px; font-weight: 700;
                    }

                    .vim-left-zone { display: flex; align-items: stretch; flex-grow: 1; }
                    .vim-right-zone { display: flex; align-items: stretch; background: var(--pl-bg); }

                    /* --- PURE CSS POWERLINE SEGMENTS (LEFT) --- */
                    #vim-powerline-mode {
                        position: relative;
                        display: flex; align-items: center; justify-content: center;
                        padding: 0 10px 0 15px; color: #11111b; text-transform: uppercase;
                        letter-spacing: 0.5px; z-index: 10;
                        transition: background 0.1s;
                    }

                    /* The Left-to-Right Chevron (CSS Border Hack) */
                    #vim-powerline-mode::after {
                        content: ''; position: absolute; left: 100%; top: 0;
                        width: 0; height: 0;
                        border-style: solid;
                        border-width: calc(var(--pl-height) / 2) 0 calc(var(--pl-height) / 2) var(--pl-arrow-w);
                        border-top-color: transparent !important;
                        border-bottom-color: transparent !important;
                        border-right-color: transparent !important;
                        transition: border-left-color 0.1s;
                    }

                    /* Dynamic Mode Colors */
                    #vim-powerline-mode.mode-normal { background: var(--pl-normal); }
                    #vim-powerline-mode.mode-normal::after { border-left-color: var(--pl-normal); }
                    #vim-powerline-mode.mode-insert { background: var(--pl-insert); }
                    #vim-powerline-mode.mode-insert::after { border-left-color: var(--pl-insert); }
                    #vim-powerline-mode.mode-visual { background: var(--pl-visual); }
                    #vim-powerline-mode.mode-visual::after { border-left-color: var(--pl-visual); }
                    #vim-powerline-mode.mode-command { background: var(--pl-command); }
                    #vim-powerline-mode.mode-command::after { border-left-color: var(--pl-command); }

                    /* --- RAW OUTPUT & COMMAND PALETTE --- */
                    #vim-raw-output {
                        flex-grow: 1; display: flex; align-items: center;
                        padding-left: calc(var(--pl-arrow-w) + 12px); /* Safely clear the chevron tip */
                        color: var(--pl-text); z-index: 1;
                    }

                    #vim-raw-output input, .monaco-vim-dialog input, .vim-command-line input {
                        background: #181825 !important; color: #a6e3a1 !important;
                        border: 1px solid #313244 !important; outline: none !important;
                        padding: 0 8px !important; font-family: inherit !important;
                        font-size: 11px !important; height: 18px !important; width: 60% !important;
                        border-radius: 2px !important; margin-left: 6px !important;
                    }

                    /* --- PURE CSS POWERLINE SEGMENTS (RIGHT) --- */
                    .vim-right-segment {
                        position: relative; display: flex; align-items: center; justify-content: center;
                        padding: 0 15px 0 calc(var(--pl-arrow-w) + 8px); /* Pad left to clear incoming chevron */
                        color: var(--pl-text);
                    }

                    /* The Right-to-Left Chevron */
                    .vim-right-segment::before {
                        content: ''; position: absolute; right: 100%; top: 0;
                        width: 0; height: 0;
                        border-style: solid;
                        border-width: calc(var(--pl-height) / 2) var(--pl-arrow-w) calc(var(--pl-height) / 2) 0;
                        border-top-color: transparent !important;
                        border-bottom-color: transparent !important;
                        border-left-color: transparent !important;
                    }

                    /* Right Segments Z-Index & Color Stacking */
                    .segment-encoding { background: var(--pl-seg1); z-index: 3; font-weight: normal; }
                    .segment-encoding::before { border-right-color: var(--pl-seg1) !important; }

                    .segment-lang { background: var(--pl-seg2); z-index: 4; font-weight: normal; }
                    .segment-lang::before { border-right-color: var(--pl-seg2) !important; }

                    .segment-pos { background: var(--pl-seg3); color: #11111b; font-weight: bold; z-index: 5; }
                    .segment-pos::before { border-right-color: var(--pl-seg3) !important; }
                `;
                document.head.appendChild(style);

                statusContainer = document.createElement('div');
                statusContainer.id = 'neovim-status-container';

                // --- DOM STRUCTURE ---
                const leftZone = document.createElement('div');
                leftZone.className = 'vim-left-zone';

                const modeBlock = document.createElement('div');
                modeBlock.id = 'vim-powerline-mode';
                modeBlock.className = 'mode-normal';
                modeBlock.textContent = 'NORMAL';

                const rawOutput = document.createElement('div');
                rawOutput.id = 'vim-raw-output';

                leftZone.appendChild(modeBlock);
                leftZone.appendChild(rawOutput);

                const rightZone = document.createElement('div');
                rightZone.className = 'vim-right-zone';

                const encBlock = document.createElement('div');
                encBlock.className = 'vim-right-segment segment-encoding';
                encBlock.textContent = 'utf-8';

                // --- Update this specific block in the createStatusBar function ---
                const langBlock = document.createElement('div');
                langBlock.className = 'vim-right-segment segment-lang';
                // Added margin-right: 6px to the icon span for the requested padding
                langBlock.innerHTML = '<span style="font-size: 13px; margin-right: 6px; display: inline-block;"></span> TypeScript';

                const posBlock = document.createElement('div');
                posBlock.id = 'vim-cursor-pos';
                posBlock.className = 'vim-right-segment segment-pos';
                posBlock.textContent = '1:1';

                rightZone.appendChild(encBlock);
                rightZone.appendChild(langBlock);
                rightZone.appendChild(posBlock);

                statusContainer.appendChild(leftZone);
                statusContainer.appendChild(rightZone);
                container.appendChild(statusContainer);
                editorDomNode.style.paddingBottom = '24px';

                // --- LOGIC ---
                const observer = new MutationObserver(() => {
                    const textContent = rawOutput.textContent.toUpperCase();

                    if (textContent.includes('INSERT')) {
                        modeBlock.textContent = 'INSERT'; modeBlock.className = 'mode-insert';
                    } else if (textContent.includes('VISUAL LINE') || textContent.includes('V-LINE')) {
                        modeBlock.textContent = 'V-LINE'; modeBlock.className = 'mode-visual';
                    } else if (textContent.includes('VISUAL BLOCK') || textContent.includes('V-BLOCK')) {
                        modeBlock.textContent = 'V-BLOCK'; modeBlock.className = 'mode-visual';
                    } else if (textContent.includes('VISUAL')) {
                        modeBlock.textContent = 'VISUAL'; modeBlock.className = 'mode-visual';
                    } else if (textContent.includes('REPLACE')) {
                        modeBlock.textContent = 'REPLACE'; modeBlock.className = 'mode-command';
                    } else if (rawOutput.querySelector('input') || textContent.startsWith(':') || textContent.startsWith('/')) {
                        modeBlock.textContent = 'COMMAND'; modeBlock.className = 'mode-command';
                    } else {
                        modeBlock.textContent = 'NORMAL'; modeBlock.className = 'mode-normal';
                    }

                    Array.from(rawOutput.querySelectorAll('span')).forEach(span => {
                        const txt = span.textContent.toUpperCase();
                        if (txt.includes('--') && (txt.includes('NORMAL') || txt.includes('INSERT') || txt.includes('VISUAL') || txt.includes('REPLACE'))) {
                            span.style.display = 'none';
                        }
                    });
                });

                observer.observe(rawOutput, { childList: true, subtree: true, characterData: true });

                editor.onDidChangeCursorPosition((e) => {
                    posBlock.textContent = `${e.position.lineNumber}:${e.position.column}`;
                });
            }
            return document.getElementById('vim-raw-output');
        }

        function bindVimToEditor(editor) {
            if (activeVimInstance) activeVimInstance.dispose();
            const checkReady = setInterval(() => {
                const domNode = editor.getDomNode();
                if (domNode && document.body.contains(domNode) && editor.getModel()) {
                    clearInterval(checkReady);
                    if (!window.MonacoVim) return;

                    const rawOutputElement = createStatusBar(editor);
                    activeVimInstance = window.MonacoVim.initVimMode(editor, rawOutputElement);
                    console.log("[Native Space] Vim successfully bound with True Powerline CSS.");

                    // Inject custom Vim mapping: go -> gg (go to top of document)
                    try {
                        const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                        if (Vim && typeof Vim.noremap === 'function') {
                            Vim.noremap('go', 'gg', 'normal');
                            Vim.noremap('go', 'gg', 'visual');
                            console.log("[Native Space] Vim custom mappings applied: go -> gg");
                        } else {
                            console.warn("[Native Space] Vim object or noremap function not found on MonacoVim.");
                        }
                    } catch (e) {
                        console.error("[Native Space] Failed to register custom Vim mappings:", e);
                    }
                }
            }, 100);
            setTimeout(() => clearInterval(checkReady), 10000);
        }

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
                                window.monaco = monacoAPI;
                                injectVimLibrary();
                                const originalCreate = monacoAPI.editor.create;
                                monacoAPI.editor.create = function(...createArgs) {
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
