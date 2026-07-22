// ==UserScript==
// @name         MakeCode Monaco Vim Bindings
// @namespace    http://tampermonkey.net/
// @version      25.0
// @description  Tailwind CSS Slate theme, flat matte colors, and CSS border chevrons
// @match        https://arcade.makecode.com/*
// @match        https://*.userpxt.io/*
// @run-at       document-start
// @resource     monacoVim https://cdn.jsdelivr.net/npm/monaco-vim@0.4.2/dist/monaco-vim.js
// @grant        GM_getResourceText
// ==/UserScript==

(function() {
    'use strict';

    // Polyfill document.querySelector for mock/jest environments if missing
    if (typeof document !== 'undefined' && !document.querySelector) {
        document.querySelector = function(selector) {
            if (selector.startsWith('#')) {
                return document.getElementById(selector.slice(1));
            }
            if (typeof document.querySelectorAll === 'function') {
                const els = document.querySelectorAll(selector);
                return (els && els.length > 0) ? els[0] : null;
            }
            return null;
        };
    }

    // Check if we are executing inside the cross-origin simulator iframe
    if (window.self !== window.top) {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                window.parent.postMessage({ type: 'VIM_ESCAPE_SIMULATOR' }, '*');
            }
        }, true); // Capture phase to intercept before the game engine consumes the key
        return; // Halt loader execution inside the iframe context
    }

    console.log("==================================================");
    console.log("✨ [Vim Injector] Booting...");
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
    if (document.documentElement) {
        document.documentElement.appendChild(dataNode);
    } else {
        const checkDoc = setInterval(() => {
            if (document.documentElement) {
                clearInterval(checkDoc);
                document.documentElement.appendChild(dataNode);
            }
        }, 5);
    }

    function nativePageExecution() {
        const patchedControllers = new WeakSet();
        const patchedRegisters = new WeakSet();

        // Listen for VIM_ESCAPE_SIMULATOR messages from the simulator iframe to return focus to the editor
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'VIM_ESCAPE_SIMULATOR') {
                console.log("[Native Space] Escape key detected in simulator. Focus returning to Monaco...");
                if (window.editor) {
                    window.editor.focus();
                }
            }
        });

        // Synchronously track active editor based on native browser focus changes
        window.addEventListener('focus', (e) => {
            if (window._vimSplits && window._vimSplits.panes) {
                const activeEl = document.activeElement;
                const paneIndex = window._vimSplits.panes.findIndex(p => {
                    const node = p.editor.getDomNode();
                    return node && (node === activeEl || node.contains(activeEl));
                });
                if (paneIndex !== -1 && paneIndex !== window._vimSplits.activePaneIndex) {
                    window._vimSplits.activePaneIndex = paneIndex;
                    window.editor = window._vimSplits.panes[paneIndex].editor;
                    activeVimInstance = window._vimSplits.panes[paneIndex].vim;
                    if (window._vimIntegrationState) {
                        window._vimIntegrationState.activeEditor = window.editor;
                    }
                    
                    // Swap status bar content
                    const rawOutput = document.getElementById('vim-raw-output');
                    const wrapper = paneIndex === 1 ? window._splitVimWrapper : window._mainVimWrapper;
                    if (rawOutput && wrapper && !rawOutput.contains(wrapper)) {
                        rawOutput.innerHTML = '';
                        rawOutput.appendChild(wrapper);
                    }
                    console.log(`[Native Space] Focus synchronously updated to pane ${paneIndex}`);
                }
            }
        }, true);

        // Prevent default browser reload/save actions when editor is focused
        window.addEventListener('keydown', (event) => {
            if (event.ctrlKey && (event.key === 'r' || event.key === 'R' || event.key === 's' || event.key === 'S')) {
                if (document.activeElement && document.activeElement.classList.contains('inputarea')) {
                    event.preventDefault();
                }
            }
        }, true);

        // Global capture-phase keydown listener to implement global IDE-wide Vim marks
        window.addEventListener('keydown', (event) => {
            if (document.activeElement && document.activeElement.classList.contains('inputarea')) {
                const mode = window.getActiveVimMode ? window.getActiveVimMode() : 'NORMAL';
                if (mode === 'NORMAL' || mode === 'VISUAL') {
                    const key = event.key;
                    // Skip modifier keys
                    if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return;
                    
                    if (key === 'Escape') {
                        window._pendingMarkSet = false;
                        window._pendingMarkJump = null;
                    } else if (window._pendingMarkSet) {
                        const markName = key;
                        window._pendingMarkSet = false;
                        
                        const activePaneIndex = window._vimSplits ? window._vimSplits.activePaneIndex : 0;
                        const activeEditor = (window._vimSplits && window._vimSplits.panes[activePaneIndex])
                            ? window._vimSplits.panes[activePaneIndex].editor
                            : window.editor;
                            
                        if (activeEditor) {
                            const model = activeEditor.getModel();
                            const filename = model ? (model.uri ? model.uri.path.split('/').pop() : 'main.ts') : 'main.ts';
                            const pos = activeEditor.getPosition() || { lineNumber: 1, column: 1 };
                            
                            window._globalVimMarks = window._globalVimMarks || {};
                            window._globalVimMarks[markName] = {
                                filename: filename,
                                line: pos.lineNumber - 1,
                                ch: pos.column - 1
                            };
                            showStatusBarMessage(`Mark '${markName}' set globally`);
                        }
                    } else if (window._pendingMarkJump) {
                        const markName = key;
                        const jumpType = window._pendingMarkJump;
                        window._pendingMarkJump = null;
                        
                        if (window._globalVimMarks && window._globalVimMarks[markName]) {
                            const mark = window._globalVimMarks[markName];
                            
                            event.preventDefault();
                            event.stopPropagation();
                            event.stopImmediatePropagation();
                            
                            jumpToGlobalMark(mark.filename, mark.line, mark.ch, jumpType === "'");
                            return;
                        }
                    } else if (key === 'm') {
                        window._pendingMarkSet = true;
                    } else if (key === "'" || key === "`") {
                        window._pendingMarkJump = key;
                    }
                }
            }
        }, true); // true = Capture phase!

        // Intercept Enter on Vim Ex command input to pre-process commands without spaces
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const active = document.activeElement;
                if (active && active.tagName === 'INPUT' && active.closest('#vim-raw-output')) {
                    const val = active.value;
                    const hasColon = val.startsWith(':');
                    const cleanVal = hasColon ? val.slice(1) : val;
                    const regex = /^([0-9\s,.$%']*|')(co|copy|m|move|t)([0-9$+-].*)$/i;
                    const match = cleanVal.trim().match(regex);
                    if (match) {
                        const range = match[1];
                        const command = match[2];
                        const target = match[3];
                        const rewritten = `${hasColon ? ':' : ''}${range}${command} ${target}`;
                        console.log(`[Vim Injector] Rewrote interactive input command: "${val}" -> "${rewritten}"`);
                        active.value = rewritten;
                    }
                }
            }
        }, true);

        window.getActiveVimMode = function() {
            if (activeVimInstance && activeVimInstance.ctxInsert && typeof activeVimInstance.ctxInsert.get === 'function') {
                if (activeVimInstance.ctxInsert.get()) {
                    return 'INSERT';
                }
            }
            const paneIndex = (window._vimSplits && window._vimSplits.activePaneIndex !== undefined) ? window._vimSplits.activePaneIndex : 0;
            const wrapper = paneIndex === 1 ? window._splitVimWrapper : window._mainVimWrapper;
            if (wrapper) {
                const modeSegment = typeof wrapper.querySelector === 'function' ? wrapper.querySelector('.mode-segment') : null;
                if (modeSegment) {
                    return modeSegment.textContent.toUpperCase();
                }
            }
            return 'NORMAL';
        };

        // Global Command History Manager for MonacoVim Ex Commands
        const commandHistory = [];
        let commandHistoryIndex = -1;
        let temporaryCommand = '';

        window.addEventListener('keydown', (e) => {
            const target = e.target;
            if (target && target.tagName === 'INPUT' && (target.closest('#vim-raw-output') || target.closest('.monaco-vim-dialog'))) {
                const key = e.key;
                const ctrl = e.ctrlKey;
                
                if (key === 'ArrowUp' || (ctrl && key.toLowerCase() === 'p')) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (commandHistory.length === 0) return;
                    
                    if (commandHistoryIndex === -1) {
                        temporaryCommand = target.value;
                    }
                    if (commandHistoryIndex < commandHistory.length - 1) {
                        commandHistoryIndex++;
                        target.value = commandHistory[commandHistoryIndex];
                        target.setSelectionRange(target.value.length, target.value.length);
                    }
                } else if (key === 'ArrowDown' || (ctrl && key.toLowerCase() === 'n')) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    if (commandHistoryIndex === -1) return;
                    if (commandHistoryIndex > 0) {
                        commandHistoryIndex--;
                        target.value = commandHistory[commandHistoryIndex];
                        target.setSelectionRange(target.value.length, target.value.length);
                    } else if (commandHistoryIndex === 0) {
                        commandHistoryIndex = -1;
                        target.value = temporaryCommand;
                        target.setSelectionRange(target.value.length, target.value.length);
                    }
                } else if (key === 'Enter') {
                    const cmd = target.value;
                    if (cmd && cmd.trim() && commandHistory[0] !== cmd) {
                        commandHistory.unshift(cmd);
                    }
                    commandHistoryIndex = -1;
                    temporaryCommand = '';
                } else if (key === 'Escape') {
                    commandHistoryIndex = -1;
                    temporaryCommand = '';
                }
            }
        }, true); // Capture phase is critical!

        // Global handler for Vim's Ctrl+w window/split commands
        window._ctrlWPrefixActive = false;
        window.addEventListener('keydown', (e) => {
            const isNormalMode = window.getActiveVimMode() === 'NORMAL';
            if (!isNormalMode && !window._ctrlWPrefixActive) return;
            
            if (window._ctrlWPrefixActive) {
                // Ignore modifier keys alone so they don't consume the prefix
                if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
                    return;
                }
                // We have an active Ctrl+w command prefix, handle the next key
                window._ctrlWPrefixActive = false; // Reset prefix
                
                const key = e.key.toLowerCase();
                if (key === 'w' || (e.ctrlKey && key === 'w')) {
                    // Cycle window focus
                    e.preventDefault();
                    e.stopPropagation();
                    if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                        const nextIndex = (window._vimSplits.activePaneIndex + 1) % 2;
                        const targetPane = window._vimSplits.panes[nextIndex];
                        if (targetPane && targetPane.editor) {
                            targetPane.editor.focus();
                            showStatusBarMessage(`Focused split window ${nextIndex}`);
                        }
                    }
                    return;
                }
                if (key === 'h' || key === 'k' || (e.ctrlKey && (key === 'h' || key === 'k'))) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.shiftKey) {
                        if (key === 'h') resizeSplit('width', -0.05);
                        else resizeSplit('height', 0.05);
                    } else {
                        if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                            const targetPane = window._vimSplits.panes[0];
                            if (targetPane && targetPane.editor) {
                                targetPane.editor.focus();
                                showStatusBarMessage("Focused left/top window");
                            }
                        }
                    }
                    return;
                }
                if (key === 'l' || key === 'j' || (e.ctrlKey && (key === 'l' || key === 'j'))) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.shiftKey) {
                        if (key === 'l') resizeSplit('width', 0.05);
                        else resizeSplit('height', -0.05);
                    } else {
                        if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                            const targetPane = window._vimSplits.panes[1];
                            if (targetPane && targetPane.editor) {
                                targetPane.editor.focus();
                                showStatusBarMessage("Focused right/bottom window");
                            }
                        }
                    }
                    return;
                }
                if (key === 'v' || (e.ctrlKey && key === 'v')) {
                    e.preventDefault();
                    e.stopPropagation();
                    createSplitPane('vertical');
                    return;
                }
                if (key === 's' || (e.ctrlKey && key === 's')) {
                    e.preventDefault();
                    e.stopPropagation();
                    createSplitPane('horizontal');
                    return;
                }
                if (key === 'c' || key === 'q') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window._vimSplits) {
                        closeSplitPane(window._vimSplits.activePaneIndex);
                    }
                    return;
                }
                if (key === '>') {
                    e.preventDefault();
                    e.stopPropagation();
                    resizeSplit('width', 0.05);
                    return;
                }
                if (key === '<') {
                    e.preventDefault();
                    e.stopPropagation();
                    resizeSplit('width', -0.05);
                    return;
                }
                if (key === '+') {
                    e.preventDefault();
                    e.stopPropagation();
                    resizeSplit('height', 0.05);
                    return;
                }
                if (key === '-') {
                    e.preventDefault();
                    e.stopPropagation();
                    resizeSplit('height', -0.05);
                    return;
                }
                if (key === '=') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                        window._vimSplits.splitRatio = 0.5;
                        applySplitsLayout();
                        showStatusBarMessage("Windows equalized");
                    }
                    return;
                }
            }
            
            // Catch Ctrl+w prefix keydown
            if (e.ctrlKey && e.key.toLowerCase() === 'w') {
                e.preventDefault();
                e.stopPropagation();
                window._ctrlWPrefixActive = true;
                
                // Auto-clear prefix after 2 seconds if no command key is pressed
                if (window._ctrlWPrefixTimeout) clearTimeout(window._ctrlWPrefixTimeout);
                window._ctrlWPrefixTimeout = setTimeout(() => {
                    window._ctrlWPrefixActive = false;
                }, 2000);
            }
        }, true);

        // Monkeypatch window.setTimeout to throttle macro/repeat replay loops and prevent editor state sync issues under load
        try {
            const originalSetTimeout = window.setTimeout;
            window.setTimeout = function(callback, delay, ...args) {
                if (window._vimIntegrationState && window._vimIntegrationState.isReplaying && (delay === 0 || delay === 1)) {
                    window._vimIntegrationState.replayedCount++;
                    if (window._vimIntegrationState.replayedCount >= window._vimIntegrationState.totalReplayCount) {
                        window._vimIntegrationState.isReplaying = false;
                    }
                    console.log("[Vim Injector] Throttling replay step:", window._vimIntegrationState.replayedCount);
                    return originalSetTimeout.call(this, callback, 50, ...args);
                }
                return originalSetTimeout.call(this, callback, delay, ...args);
            };
            console.log("[Native Space] Replay throttle setTimeout monkeypatch active.");
        } catch (err) {
            console.error("[Native Space] Failed to monkeypatch setTimeout:", err);
        }

        // Intercept maybeReset on Object.prototype to catch all instances of lastInsertModeChanges
        try {
            let _changesKey = Symbol('changesVal');
            let _protoMaybeResetKey = Symbol('protoMaybeResetVal');

            Object.defineProperty(Object.prototype, 'maybeReset', {
                get: function() {
                    return this[_protoMaybeResetKey] || false;
                },
                set: function(val) {
                    const isInsert = window.getActiveVimMode() === 'INSERT';
                    if (isInsert && window._suggestWidgetVisible && val === true) {
                        console.log("[Vim Injector] maybeReset set blocked (suggest widget visible).");
                        return; // Ignore reset while autocomplete list is active in insert mode
                    }
                    if (window._vimIntegrationState && window._vimIntegrationState.justTyped && val === true) {
                        console.log("[Vim Injector] maybeReset set blocked (typing active).");
                        return;
                    }
                    this[_protoMaybeResetKey] = val;
                },
                configurable: true
            });

            Object.defineProperty(Object.prototype, 'changes', {
                get: function() {
                    return this[_changesKey];
                },
                set: function(val) {
                    if (this.hasOwnProperty('maybeReset')) {
                        const isInsert = window.getActiveVimMode() === 'INSERT';
                        if (isInsert && window._suggestWidgetVisible && Array.isArray(val) && val.length === 0) {
                            console.log("[Vim Injector] Blocked clearing changes (suggest widget visible).");
                            return;
                        }
                        
                        if (Array.isArray(val) && !val._isProxy) {
                            val = new Proxy(val, {
                                get(target, prop, receiver) {
                                    if (prop === '_isProxy') return true;
                                    return Reflect.get(target, prop, receiver);
                                },
                                set(target, prop, value, receiver) {
                                    const isInsertActive = window.getActiveVimMode() === 'INSERT';
                                    if (!isInsertActive) {
                                        if (prop === 'length' && value === 0) {
                                            console.log("[Vim Injector] Blocked length=0 mutation on changes (not in insert mode).");
                                            return true;
                                        }
                                    }
                                    return Reflect.set(target, prop, value, receiver);
                                },
                                deleteProperty(target, prop) {
                                    const isInsertActive = window.getActiveVimMode() === 'INSERT';
                                    if (!isInsertActive) {
                                        console.log("[Vim Injector] Blocked delete mutation on changes (not in insert mode).");
                                        return true;
                                    }
                                    return Reflect.deleteProperty(target, prop);
                                }
                            });
                        }
                    }
                    
                    this[_changesKey] = val;
                    if (val && Array.isArray(val)) {
                        let _maybeResetKey = Symbol('maybeResetVal');
                        Object.defineProperty(this, 'maybeReset', {
                            get: function() {
                                return this[_maybeResetKey] || false;
                            },
                            set: function(mVal) {
                                if (window._vimIntegrationState && window._vimIntegrationState.justTyped && mVal === true) {
                                    console.log("[Vim Injector] maybeReset set blocked (typing active).");
                                    return;
                                }
                                console.log("[Vim Injector] maybeReset set allowed (typing inactive):", mVal);
                                this[_maybeResetKey] = mVal;
                            },
                            configurable: true
                        });
                    }
                },
                configurable: true
            });
            Object.defineProperty(Object.prototype, '_isPatched', {
                get: function() {
                    if (this.changes && Array.isArray(this.changes)) {
                        return true;
                    }
                    return undefined;
                },
                configurable: true
            });
            console.log("[Native Space] Dot-repeat last change tracking prototype patch applied successfully.");
        } catch (err) {
            console.error("[Native Space] Failed to apply prototype patch:", err);
        }

        let isLibraryInjected = false;
        let activeVimInstance = null;
 
        function injectVimLibrary() {
            if (isLibraryInjected) return;
            try {
                const payloadEl = document.getElementById('vim-payload-transfer');
                const rawVimLibrary = payloadEl ? payloadEl.textContent : '';
                if (!rawVimLibrary) {
                    console.error("[Native Space] Vim payload transfer DOM element not found.");
                    return;
                }
                const _tempDefine = window.define;
                window.define = undefined;
                const scriptEl = document.createElement('script');
                scriptEl.textContent = rawVimLibrary;
                document.head.appendChild(scriptEl);
                window.define = _tempDefine;
                isLibraryInjected = true;
            } catch(e) { console.error("[Native Space] Injection Error:", e); }
        }

        function updateFileNameSegment(editor) {
            const model = editor.getModel();
            const filenameEl = document.querySelector('.file-name');
            if (filenameEl && model && model.uri) {
                const uriPath = model.uri.path;
                const filename = uriPath ? uriPath.split('/').pop() : 'main.ts';
                filenameEl.textContent = filename || 'main.ts';
            } else if (filenameEl) {
                filenameEl.textContent = 'main.ts';
            }
        }

        function updateDiagnosticsSummary(editor) {
            if (!editor || !window.monaco) return;
            const model = editor.getModel();
            if (!model) return;
            
            const markers = window.monaco.editor.getModelMarkers({ resource: model.uri });
            let errors = 0;
            let warnings = 0;
            
            markers.forEach(m => {
                if (m.severity === 8) { // monaco.MarkerSeverity.Error
                    errors++;
                } else if (m.severity === 4) { // monaco.MarkerSeverity.Warning
                    warnings++;
                }
            });
            
            const errEl = document.getElementById('diag-errors');
            const warnEl = document.getElementById('diag-warnings');
            
            if (errEl) {
                if (errors > 0) {
                    errEl.querySelector('.diag-count').textContent = errors;
                    errEl.style.display = 'flex';
                } else {
                    errEl.style.display = 'none';
                }
            }
            
            if (warnEl) {
                if (warnings > 0) {
                    warnEl.querySelector('.diag-count').textContent = warnings;
                    warnEl.style.display = 'flex';
                } else {
                    warnEl.style.display = 'none';
                }
            }
        }        function updateLanguageSegment(editor) {
            const model = editor.getModel();
            const langEl = document.querySelector('.segment-lang');
            if (!langEl) return;
            if (model) {
                const path = model.uri.path.toLowerCase();
                if (path.endsWith('.py')) {
                    langEl.textContent = 'Python';
                    return;
                }
                if (path.endsWith('.js')) {
                    langEl.textContent = 'Javascript';
                    return;
                }
                if (path.endsWith('.cpp') || path.endsWith('.h') || path.endsWith('.hpp')) {
                    langEl.textContent = 'cpp';
                    return;
                }
            }
            // Default: Typescript
            langEl.textContent = 'Typescript';
        }

        function createStatusBar(editor) {
            const editorDomNode = editor.getDomNode();
            const container = editorDomNode.parentElement;
            let wrapper = document.getElementById('neovim-bar-wrapper');

            if (!wrapper) {
                const style = document.createElement('style');
                style.textContent = `
                    @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap');

                    /* Hide MakeCode default problems popup */
                    .errorList { display: none !important; }

                    :root {
                        --pl-bg: #121212; /* Darkened empty track background */
                        --pl-bg-gradient: #121212; /* Flat terminal background */
                        --pl-border: #3e3e3e; /* Clearer split divider border */
                        --pl-text: #cccccc; /* Muted terminal text */
                        --pl-height: 24px;

                        /* Flat matte terminal colors with a bit more pop and distinct vibrancy */
                        --pl-normal: #61afef; /* Sky Blue (One Dark) */
                        --pl-normal-border: #61afef;
                        --pl-insert: #98c379; /* Muted Green (One Dark) */
                        --pl-insert-border: #98c379;
                        --pl-visual: #c678dd; /* Muted Violet (One Dark) */
                        --pl-visual-border: #c678dd;
                        --pl-command: #e5c07b; /* Muted Amber (One Dark) */
                        --pl-command-border: #e5c07b;
                        --pl-replace: #e06c75; /* Muted Red (One Dark) */
                        --pl-replace-border: #e06c75;

                        --pl-seg1: #2d2d2d; /* Encoding: slightly lighter than background */
                        --pl-seg1-border: #2d2d2d;
                        --pl-seg2: #3f3f46; /* Language: Slate-700 / Zinc-700 equivalent */
                        --pl-seg2-border: #3f3f46;

                        /* Arrow width controls the sharpness of the chevron */
                        --pl-arrow-w: 12px;
                    }

                    #neovim-bar-wrapper, #neovim-bar-wrapper * {
                        font-family: "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                        font-variant-ligatures: contextual !important;
                        font-feature-settings: "calt" 1 !important;
                    }

                    #neovim-bar-wrapper {
                        position: absolute; bottom: 0; left: 0; width: 100%; min-height: var(--pl-height); height: auto;
                        background: var(--pl-bg-gradient); border-top: 1px solid var(--pl-border);
                        display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch;
                        z-index: 2 !important;
                        font-size: 11px; font-weight: 700;
                        box-sizing: content-box !important;
                        line-height: 1 !important;
                        box-shadow: 0 -1px 5px rgba(0, 0, 0, 0.15) !important;
                    }

                    #neovim-status-line {
                        width: 100%;
                        min-height: var(--pl-height); height: auto;
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-end;
                        flex-shrink: 0;
                    }

                    #neovim-status-line * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }

                    .vim-left-zone { display: flex; align-items: flex-end; flex-grow: 1; }
                    .vim-right-zone { display: flex; align-items: flex-end; background: var(--pl-bg-gradient); flex-shrink: 0; height: var(--pl-height); }

                    /* --- PURE CSS POWERLINE SEGMENTS (LEFT) --- */
                    #vim-mode-segment {
                        position: relative;
                        display: flex; align-items: center; justify-content: center;
                        padding: 0 10px 0 15px !important; color: #1f1f1f !important; text-transform: uppercase;
                        letter-spacing: 0.5px; z-index: 10;
                        height: var(--pl-height);
                        white-space: nowrap;
                        flex-shrink: 0;
                        line-height: 1 !important;
                        margin: 0 !important;
                        font-weight: 600 !important; /* Slightly less bold */
                        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35) !important; /* Engraved effect */
                        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15) !important; /* Micro-glint top highlight */
                    }

                    /* The Left-to-Right Chevron (CSS Border Hack) */
                    #neovim-status-line #vim-mode-segment::after {
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
                    #vim-mode-segment.mode-normal { background: var(--pl-normal); }
                    #vim-mode-segment.mode-normal::after { border-left-color: var(--pl-normal-border); }
                    #vim-mode-segment.mode-insert { background: var(--pl-insert); }
                    #vim-mode-segment.mode-insert::after { border-left-color: var(--pl-insert-border); }
                    #vim-mode-segment.mode-visual { background: var(--pl-visual); }
                    #vim-mode-segment.mode-visual::after { border-left-color: var(--pl-visual-border); }
                    #vim-mode-segment.mode-command { background: var(--pl-command); }
                    #vim-mode-segment.mode-command::after { border-left-color: var(--pl-command-border); }
                    #vim-mode-segment.mode-replace { background: var(--pl-replace); }
                    #vim-mode-segment.mode-replace::after { border-left-color: var(--pl-replace-border); }

                    /* --- CENTER AREA CONTAINER --- */
                    #neovim-center-container {
                        flex-grow: 1;
                        display: grid;
                        grid-template-columns: 1fr;
                        grid-template-rows: 1fr;
                        align-items: center;
                        position: relative;
                        padding-left: calc(var(--pl-arrow-w) + 12px) !important;
                        padding-right: calc(var(--pl-arrow-w) + 6px) !important;
                        min-height: var(--pl-height);
                        height: auto;
                        align-self: stretch;
                    }

                    /* --- RAW OUTPUT & COMMAND PALETTE --- */
                    #vim-raw-output {
                        grid-column: 1; grid-row: 1;
                        width: 100%; min-height: var(--pl-height); height: auto;
                        display: flex !important; align-items: center !important; justify-content: flex-start !important;
                        gap: 4px !important;
                        color: #ffffff !important;
                        font-family: "Fira Code", ui-monospace, monospace !important;
                        font-size: 13px !important; /* Scaled up to match main editor canvas */
                        font-weight: 500 !important; /* Refined to medium weight */
                        line-height: 24px !important; /* Locked vertical alignment */
                        z-index: 1;
                    }

                    #vim-raw-output span {
                        color: #ffffff !important;
                        font-family: "Fira Code", ui-monospace, monospace !important;
                        font-size: 13px !important;
                        font-weight: 500 !important;
                        line-height: 24px !important;
                        white-space: nowrap !important;
                    }

                    /* Target the Key Buffer span specifically (keep it small & styled like right-hand badges) */
                    #vim-raw-output span[style*="float: right"] {
                        position: relative !important;
                        z-index: 100 !important;
                        line-height: 24px !important;
                        font-family: "Fira Code", ui-monospace, monospace !important;
                        font-size: 11px !important; /* Stay small to match status badges */
                        font-weight: 700 !important; /* Keep bold */
                        color: var(--pl-text) !important; /* Muted grey */
                        margin-left: auto !important; /* Push to far right */
                    }

                    #vim-raw-output input, .monaco-vim-dialog input, .vim-command-line input {
                        background: var(--pl-bg) !important; /* match the darkest grey precisely */
                        color: #ffffff !important; /* pure white high contrast */
                        border: none !important;
                        outline: none !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        font-family: "Fira Code", ui-monospace, monospace !important;
                        font-size: 13px !important; /* Scaled up to match editor canvas */
                        font-weight: 500 !important; /* Refined to medium weight */
                        height: 24px !important; /* Fixed height to prevent vertical expansion */
                        width: auto !important;
                        flex-grow: 1 !important;
                        box-shadow: none !important;
                        line-height: 24px !important; /* Locked vertical centering */
                    }

                    .monaco-vim-dialog, .vim-command-line {
                        position: relative !important;
                        bottom: auto !important;
                        left: auto !important;
                        right: auto !important;
                        top: auto !important;
                        width: 100% !important;
                        height: 24px !important;
                        display: flex !important;
                        align-items: center !important;
                        background: transparent !important;
                        z-index: 10 !important;
                    }

                    .monaco-vim-dialog span, .vim-command-line span {
                        white-space: nowrap !important;
                    }

                    #neovim-message-area {
                        grid-column: 1; grid-row: 1;
                        position: relative;
                        display: none;
                        align-items: center;
                        color: var(--pl-text);
                        font-weight: normal;
                        white-space: pre-wrap;
                        word-break: break-word;
                        z-index: 2;
                        cursor: pointer;
                        width: 100%;
                        max-height: 40vh;
                        overflow-y: auto;
                        font-family: "Fira Code", ui-monospace, monospace !important;
                        font-size: 13px !important;
                        line-height: 1.4 !important;
                    }

                    #neovim-message-panel {
                        display: none;
                        padding: 8px 16px 8px 24px;
                        background: transparent;
                        color: var(--pl-text);
                        white-space: pre-wrap;
                        word-break: break-word;
                        font-family: inherit;
                        font-size: 12px;
                        line-height: 1.4;
                        border-top: none;
                        max-height: 40vh;
                        overflow-y: auto;
                        font-weight: normal;
                    }

                    /* --- PURE CSS POWERLINE SEGMENTS (RIGHT) --- */
                    .vim-right-segment {
                        position: relative; display: flex; align-items: center; justify-content: center;
                        padding: 0 20px 0 12px !important; /* 12px left, 20px right to clear 12px incoming left chevron tip */
                        white-space: nowrap;
                        height: var(--pl-height);
                        flex-shrink: 0;
                        line-height: 1 !important;
                        margin: 0 !important;
                        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05) !important; /* Micro-glint top highlight */
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
                    .segment-encoding { background: var(--pl-seg1); z-index: 3; font-weight: normal; color: #d8dee9 !important; }
                    .segment-encoding::before { border-right-color: var(--pl-seg1-border) !important; }

                    .segment-lang { background: var(--pl-seg2); z-index: 4; font-weight: normal; color: #d8dee9 !important; }
                    .segment-lang::before { border-right-color: var(--pl-seg2-border) !important; }

                    .segment-pos { color: #1f1f1f !important; font-weight: 600 !important; z-index: 5; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35) !important; }
                    .segment-pos.mode-normal { background: var(--pl-normal); }
                    .segment-pos.mode-normal::before { border-right-color: var(--pl-normal-border) !important; }
                    .segment-pos.mode-insert { background: var(--pl-insert); }
                    .segment-pos.mode-insert::before { border-right-color: var(--pl-insert-border) !important; }
                    .segment-pos.mode-visual { background: var(--pl-visual); }
                    .segment-pos.mode-visual::before { border-right-color: var(--pl-visual-border) !important; }
                    .segment-pos.mode-command { background: var(--pl-command); }
                    .segment-pos.mode-command::before { border-right-color: var(--pl-command-border) !important; }
                    .segment-pos.mode-replace { background: var(--pl-replace); }
                    .segment-pos.mode-replace::before { border-right-color: var(--pl-replace-border) !important; }
                `;
                document.head.appendChild(style);

                wrapper = document.createElement('div');
                wrapper.id = 'neovim-bar-wrapper';

                wrapper.innerHTML = `
                    <div id="neovim-status-line">
                        <div class="vim-left-zone">
                            <div id="vim-mode-segment" class="status-segment mode-segment mode-normal">NORMAL</div>
                            <div id="neovim-center-container">
                                <div id="vim-raw-output"></div>
                                <div id="neovim-message-area">
                                    <span class="message-text"></span>
                                </div>
                            </div>
                        </div>
                        <div class="vim-right-zone mode-normal">
                            <div class="vim-right-segment segment-encoding">utf-8</div>
                            <div class="vim-right-segment segment-lang"></div>
                            <div id="vim-pos-segment" class="vim-right-segment segment-pos mode-normal">1:1</div>
                        </div>
                    </div>
                    <div id="neovim-command-line" style="display: none; height: 0; width: 0; overflow: hidden;"></div>
                `;

                container.appendChild(wrapper);
                editorDomNode.style.paddingBottom = '25px';

                // --- OBSERVER FOR RAW OUTPUT ---
                const rawOutput = wrapper.querySelector('#vim-raw-output');
                const modeSegment = wrapper.querySelector('#vim-mode-segment');
                const posSegment = wrapper.querySelector('#vim-pos-segment');
                const msgArea = wrapper.querySelector('#neovim-message-area');
                const msgTooltip = wrapper.querySelector('#neovim-message-tooltip');

                // Set up click event to toggle message panel manually
                if (msgArea) {
                    msgArea.addEventListener('click', () => {
                        const isExpanded = msgArea.style.whiteSpace === 'pre-wrap';
                        if (isExpanded) {
                            msgArea.style.whiteSpace = 'nowrap';
                            msgArea.style.overflow = 'hidden';
                            msgArea.style.textOverflow = 'ellipsis';
                            msgArea.style.paddingTop = '0px';
                            msgArea.style.paddingBottom = '0px';
                            window._isMessageExpanded = false;
                        } else {
                            msgArea.style.whiteSpace = 'pre-wrap';
                            msgArea.style.overflow = 'visible';
                            msgArea.style.textOverflow = 'clip';
                            msgArea.style.paddingTop = '8px';
                            msgArea.style.paddingBottom = '8px';
                            window._isMessageExpanded = true;
                        }
                    });
                }
                
                // Global escape to close expanded message panel
                window.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        if (msgArea && msgArea.style.whiteSpace === 'pre-wrap') {
                            msgArea.style.whiteSpace = 'nowrap';
                            msgArea.style.overflow = 'hidden';
                            msgArea.style.textOverflow = 'ellipsis';
                            msgArea.style.paddingTop = '0px';
                            msgArea.style.paddingBottom = '0px';
                            window._isMessageExpanded = false;
                        }
                    }
                }, true);

                window._wasInInsertMode = false;
                const observer = new MutationObserver(() => {
                    const cleanPromptNodes = (parent) => {
                        parent.childNodes.forEach(node => {
                            if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('JavaScript regexp')) {
                                observer.disconnect();
                                node.textContent = node.textContent.replace(/\s*\(JavaScript regexp\):?\s*/g, '');
                                observer.observe(rawOutput, { childList: true, subtree: true, characterData: true });
                            } else if (node.nodeType === Node.ELEMENT_NODE) {
                                cleanPromptNodes(node);
                            }
                        });
                    };
                    cleanPromptNodes(rawOutput);

                    const textContent = rawOutput.textContent.toUpperCase();
                    let modeText = 'NORMAL';
                    let modeClass = 'mode-normal';

                    if (textContent.includes('INSERT')) {
                        modeText = 'INSERT'; modeClass = 'mode-insert';
                    } else if (textContent.includes('VISUAL LINE') || textContent.includes('V-LINE')) {
                        modeText = 'V-LINE'; modeClass = 'mode-visual';
                    } else if (textContent.includes('VISUAL BLOCK') || textContent.includes('V-BLOCK')) {
                        modeText = 'V-BLOCK'; modeClass = 'mode-visual';
                    } else if (textContent.includes('VISUAL')) {
                        modeText = 'VISUAL'; modeClass = 'mode-visual';
                    } else if (textContent.includes('REPLACE')) {
                        modeText = 'REPLACE'; modeClass = 'mode-command';
                    } else if (rawOutput.querySelector('input') || textContent.startsWith(':') || textContent.startsWith('/')) {
                        modeText = 'COMMAND'; modeClass = 'mode-command';
                    }

                    // Auto-reup auto-compilation on insert mode leave
                    const isInsert = modeText === 'INSERT';
                    if (window._wasInInsertMode && !isInsert) {
                        window._wasInInsertMode = false;
                        
                        try {
                            const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                            if (Vim && typeof Vim.getVimGlobalState_ === 'function') {
                                const globalState = Vim.getVimGlobalState_();
                                if (globalState && globalState.macroModeState && globalState.macroModeState.lastInsertModeChanges) {
                                    if (window._vimIntegrationState.recordedChanges && window._vimIntegrationState.recordedChanges.length > 0) {
                                        // Flush any pending auto-close brackets that are still present in the editor after the cursor
                                        if (window._vimIntegrationState.pendingAutoClose && window._vimIntegrationState.pendingAutoClose.length > 0) {
                                            try {
                                                const editor = window.editor;
                                                const pos = editor && editor.getPosition();
                                                const model = editor && editor.getModel();
                                                if (pos && model) {
                                                    const lineText = model.getLineContent(pos.lineNumber);
                                                    const afterCursor = lineText.substring(pos.column - 1);
                                                    console.log("[Vim Injector] Flush check:", { pos: JSON.stringify(pos), lineText, afterCursor, pendingAutoClose: JSON.stringify(window._vimIntegrationState.pendingAutoClose) });
                                                    let remainingText = afterCursor;
                                                    window._vimIntegrationState.pendingAutoClose.forEach(char => {
                                                        const idx = remainingText.indexOf(char);
                                                        if (idx !== -1) {
                                                            window._vimIntegrationState.recordedChanges.push(char);
                                                            remainingText = remainingText.substring(0, idx) + remainingText.substring(idx + 1);
                                                        }
                                                    });
                                                }
                                            } catch (err) {
                                                console.error("[Vim Injector] Error flushing pending auto-close:", err);
                                            }
                                            window._vimIntegrationState.pendingAutoClose = [];
                                        }
                                        globalState.macroModeState.lastInsertModeChanges.changes = [...window._vimIntegrationState.recordedChanges];
                                    }
                                    const changes = globalState.macroModeState.lastInsertModeChanges.changes;
                                    if (changes && changes.length > 0) {
                                        window._vimIntegrationState.savedChanges = [...changes];
                                        console.log("[Vim Injector] Saved final completed changes on insert leave:", JSON.stringify(window._vimIntegrationState.savedChanges));
                                    }
                                }
                            }
                        } catch (e) {}

                        if (window._vimSettings && window._vimSettings.reup) {
                            console.log("[Vim Injector] Auto-reup: Exited insert mode, triggering simulator run.");
                            runSimulator();
                        }
                    }
                    if (isInsert && !window._wasInInsertMode) {
                        if (!window._vimIntegrationState) {
                            window._vimIntegrationState = {};
                        }
                        window._vimIntegrationState.recordedChanges = [];
                        window._vimIntegrationState.pendingAutoClose = [];
                        console.log("[Vim Injector] Entered Insert Mode: initialized recordedChanges.");
                    }
                    if (isInsert) {
                        window._wasInInsertMode = true;
                    }

                    if (modeSegment) {
                        modeSegment.textContent = modeText;
                        modeSegment.className = `status-segment mode-segment ${modeClass}`;
                    }
                    if (posSegment) {
                        posSegment.className = `vim-right-segment segment-pos ${modeClass}`;
                    }
                    const rightZone = wrapper.querySelector('.vim-right-zone');
                    if (rightZone) {
                        rightZone.className = `vim-right-zone ${modeClass}`;
                    }

                    // Hide custom message area if user is currently typing a command (input is visible)
                    const hasInput = rawOutput.querySelector('input');
                    if (msgArea && hasInput) {
                        msgArea.style.display = 'none';
                    }

                    // Hide the key buffer span (e.g. showing duplicate '/') when command/search input is active
                    const keyBufferSpan = rawOutput.querySelector('span[style*="float: right"]');
                    if (keyBufferSpan) {
                        const targetDisplay = hasInput ? 'none' : '';
                        if (keyBufferSpan.style.display !== targetDisplay) {
                            observer.disconnect();
                            keyBufferSpan.style.display = targetDisplay;
                            observer.observe(rawOutput, { childList: true, subtree: true, characterData: true });
                        }
                    }

                    // Suppress "-- NORMAL --" or other mode display spans inside raw output
                    Array.from(rawOutput.querySelectorAll('span')).forEach(span => {
                        const txt = span.textContent.toUpperCase();
                        if (txt.includes('--') && (txt.includes('NORMAL') || txt.includes('INSERT') || txt.includes('VISUAL') || txt.includes('REPLACE'))) {
                            span.style.display = 'none';
                        }
                    });
                });

                observer.observe(rawOutput, { childList: true, subtree: true, characterData: true });

                // Set initial language
                updateLanguageSegment(editor);

                // Listen to editor changes safely
                if (typeof editor.onDidChangeCursorPosition === 'function') {
                    editor.onDidChangeCursorPosition((e) => {
                        const posBlock = document.getElementById('vim-pos-segment');
                        if (posBlock) {
                            posBlock.textContent = `${e.position.lineNumber}:${e.position.column}`;
                        }
                    });
                }

                if (typeof editor.onDidChangeModel === 'function') {
                    editor.onDidChangeModel(() => {
                        updateLanguageSegment(editor);
                    });
                }
            }

            return document.getElementById('vim-raw-output');
        }
        function setupEmacsInsertKeys(editor) {
            let suggestWidgetVisible = false;
            if (window._suggestWidgetVisible === undefined) {
                window._suggestWidgetVisible = false;
            }
            try {
                const controller = editor.getContribution('editor.contrib.suggestController');
                if (controller) {
                    const widget = controller.widget && controller.widget.value ? controller.widget.value : controller.widget;
                    if (widget && typeof widget.onDidShow === 'function') {
                        widget.onDidShow(() => {
                            suggestWidgetVisible = true;
                            window._suggestWidgetVisible = true;
                        });
                        widget.onDidHide(() => {
                            suggestWidgetVisible = false;
                            window._suggestWidgetVisible = false;
                        });
                    }
                }
            } catch (err) {
                console.error("[Native Space] Failed to register suggest widget visibility listener:", err);
            }

            editor.onKeyDown((e) => {
                // Intercept dot repeat in normal mode to restore changes array
                if (e.browserEvent.key === '.') {
                    // Let CodeMirror handle dot-repeat natively
                }
                const isInsertMode = window.getActiveVimMode() === 'INSERT';
                if (!isInsertMode) return;

                const pressedKey = e.browserEvent.key;
                if (window._vimIntegrationState.pendingAutoClose && window._vimIntegrationState.pendingAutoClose.length > 0) {
                    if (pressedKey === window._vimIntegrationState.pendingAutoClose[0]) {
                        window._vimIntegrationState.pendingAutoClose.shift();
                        window._vimIntegrationState.recordedChanges.push(pressedKey);
                    }
                }

                const key = e.browserEvent.key.toLowerCase();
                const ctrl = e.ctrlKey;
                const meta = e.metaKey;
                const shift = e.shiftKey;
                const alt = e.altKey;

                // 1. Suggest Widget Active Key Intercepts
                if (suggestWidgetVisible) {
                    if (ctrl && !meta && !alt && !shift) {
                        if (key === 'j') {
                            editor.trigger('keyboard', 'selectNextSuggestion', null);
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        } else if (key === 'k') {
                            editor.trigger('keyboard', 'selectPrevSuggestion', null);
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        } else if (key === 'e') {
                            editor.trigger('keyboard', 'hideSuggestWidget', null);
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                    } else if (key === 'enter' && !ctrl && !meta && !alt && !shift) {
                        editor.trigger('keyboard', 'acceptSelectedSuggestion', null);
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }

                // 2. Standard Emacs Key Bindings (and Fallbacks when suggest widget is closed)
                if (ctrl && !meta && !alt && !shift) {
                    let handled = false;
                    if (key === 'a') {
                        editor.trigger('keyboard', 'cursorHome', null);
                        handled = true;
                    } else if (key === 'e') {
                        editor.trigger('keyboard', 'cursorEnd', null);
                        handled = true;
                    } else if (key === 'b') {
                        editor.trigger('keyboard', 'cursorLeft', null);
                        handled = true;
                    } else if (key === 'f') {
                        editor.trigger('keyboard', 'cursorRight', null);
                        handled = true;
                    } else if (key === 'd') {
                        editor.trigger('keyboard', 'deleteRight', null);
                        handled = true;
                    } else if (key === 'j') {
                        // Emacs Ctrl-J fallback: newline-and-indent
                        editor.trigger('keyboard', 'type', { text: '\n' });
                        handled = true;
                    } else if (key === 'k') {
                        // Kill line (delete to end of line)
                        try {
                            const position = editor.getPosition();
                            const lineContent = editor.getModel().getLineContent(position.lineNumber);
                            let range;
                            if (position.column > lineContent.length) {
                                if (position.lineNumber < editor.getModel().getLineCount()) {
                                    range = new window.monaco.Range(
                                        position.lineNumber,
                                        position.column,
                                        position.lineNumber + 1,
                                        1
                                    );
                                }
                            } else {
                                range = new window.monaco.Range(
                                    position.lineNumber,
                                    position.column,
                                    position.lineNumber,
                                    lineContent.length + 1
                                );
                            }
                            if (range) {
                                editor.executeEdits('emacs-kill', [{
                                    range: range,
                                    text: '',
                                    forceMoveMarkers: true
                                }]);
                            }
                        } catch (err) {
                            console.error("Error in Ctrl+K delete to end of line:", err);
                        }
                        handled = true;
                    }

                    if (handled) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            });
        }

        // Initialize default Vim settings globally
        if (!window._vimSettings) {
            window._vimSettings = {
                nu: true,     // number (default enabled in Monaco)
                rnu: false,   // relativenumber (default disabled)
                reup: true,   // autocompile on insert leave (default enabled)
                leader: '<Space>' // customizable leader key
            };
        }

        function updateEditorLineNumbers(editor) {
            if (!editor || !window._vimSettings) return;
            const isNu = window._vimSettings.nu;
            const isRnu = window._vimSettings.rnu;
            
            if (!isNu && !isRnu) {
                if (typeof editor.updateOptions === 'function') {
                    editor.updateOptions({ lineNumbers: 'off' });
                }
            } else {
                if (typeof editor.updateOptions === 'function') {
                    editor.updateOptions({
                        lineNumbers: (num) => {
                            const position = editor.getPosition();
                            if (!position) return num;
                            if (num === position.lineNumber) {
                                return isNu ? String(num) : "0";
                            }
                            return isRnu ? String(Math.abs(num - position.lineNumber)) : String(num);
                        }
                    });
                }
            }
        }

        function applyVimLeaderKey() {
            if (!window.MonacoVim) return;
            const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
            if (!Vim) return;
            
            if (typeof Vim.handleEx === 'function' && !Vim.handleEx.__patched) {
                const originalHandleEx = Vim.handleEx;
                Vim.handleEx = function(cm, cmd) {
                    if (typeof cmd === 'string') {
                        const regex = /^([0-9\s,.$%']*|')(co|copy|m|move|t)([0-9$+-].*)$/i;
                        const match = cmd.trim().match(regex);
                        if (match) {
                            const range = match[1];
                            const command = match[2];
                            const target = match[3];
                            const rewritten = `${range}${command} ${target}`;
                            console.log(`[Vim Injector] Rewrote Ex command: "${cmd}" -> "${rewritten}"`);
                            cmd = rewritten;
                        }
                    }
                    return originalHandleEx.call(this, cm, cmd);
                };
                Vim.handleEx.__patched = true;
            }
            
            if (typeof Vim.processCommand === 'function' && !Vim.processCommand.__patched) {
                const originalProcessCommand = Vim.processCommand;
                Vim.processCommand = function(cm, cmd) {
                    if (typeof cmd === 'string') {
                        const regex = /^([0-9\s,.$%']*|')(co|copy|m|move|t)([0-9$+-].*)$/i;
                        const match = cmd.trim().match(regex);
                        if (match) {
                            const range = match[1];
                            const command = match[2];
                            const target = match[3];
                            const rewritten = `${range}${command} ${target}`;
                            console.log(`[Vim Injector] Rewrote Ex command in processCommand: "${cmd}" -> "${rewritten}"`);
                            cmd = rewritten;
                        }
                    }
                    return originalProcessCommand.call(this, cm, cmd);
                };
                Vim.processCommand.__patched = true;
            }
            
            let leader = (window._vimSettings && window._vimSettings.leader) || '<Space>';
            if (leader === ' ' || leader.toLowerCase() === 'space') {
                leader = '<Space>';
            }
            
            // Unmap the previous leader key if it differs
            if (window._currentMappedLeader && window._currentMappedLeader !== leader) {
                try {
                    Vim.unmap(window._currentMappedLeader);
                    console.log(`[Native Space] Unmapped old leader key '${window._currentMappedLeader}'`);
                } catch(e) {}
            }
            
            try {
                Vim.map(leader, ':hover<CR>');
                window._currentMappedLeader = leader;
                console.log(`[Native Space] Mapped leader key '${leader}' to show hover`);
            } catch(e) {}
        }

        // Initialize vim splits state globally
        if (!window._vimSplits) {
            window._vimSplits = {
                panes: [],
                activePaneIndex: 0,
                direction: 'vertical',
                splitRatio: 0.5
            };
        }

        function applyStyleWithImportant(element, property, value) {
            if (element && element.style && typeof element.style.setProperty === 'function') {
                element.style.setProperty(property, value, 'important');
            }
        }

        function removeStyleWithImportant(element, property) {
            if (element && element.style && typeof element.style.removeProperty === 'function') {
                element.style.removeProperty(property);
            }
        }        function applySplitsLayout() {
            if (!window._vimSplits || window._vimSplits.panes.length < 2) {
                // If only 1 pane, restore it to normal size
                const mainPane = window._vimSplits.panes[0];
                if (mainPane) {
                    const mainDomNode = mainPane.editor.getDomNode();
                    removeStyleWithImportant(mainDomNode, 'position');
                    removeStyleWithImportant(mainDomNode, 'left');
                    removeStyleWithImportant(mainDomNode, 'top');
                    removeStyleWithImportant(mainDomNode, 'width');
                    removeStyleWithImportant(mainDomNode, 'height');
                    mainPane.editor.layout();
                }
                
                // Clean up resize listener
                if (window._splitResizeListener) {
                    window.removeEventListener('resize', window._splitResizeListener);
                    window._splitResizeListener = null;
                }
                
                // Restore parent style
                if (window._originalParentPosition !== undefined) {
                    const mainPane = window._vimSplits.panes[0];
                    if (mainPane) {
                        const parent = mainPane.editor.getDomNode().parentNode;
                        if (parent) {
                            if (window._originalParentPosition) {
                                applyStyleWithImportant(parent, 'position', window._originalParentPosition);
                            } else {
                                removeStyleWithImportant(parent, 'position');
                            }
                            if (window._originalParentWidth) {
                                applyStyleWithImportant(parent, 'width', window._originalParentWidth);
                            } else {
                                removeStyleWithImportant(parent, 'width');
                            }
                            if (window._originalParentHeight) {
                                applyStyleWithImportant(parent, 'height', window._originalParentHeight);
                            } else {
                                removeStyleWithImportant(parent, 'height');
                            }
                        }
                    }
                    window._originalParentPosition = undefined;
                    window._originalParentWidth = undefined;
                    window._originalParentHeight = undefined;
                }
                
                // Remove separator and split container from DOM
                const sep = document.getElementById('vim-split-separator');
                if (sep && sep.parentNode) sep.parentNode.removeChild(sep);
                const splitCont = document.getElementById('vim-split-pane-1');
                if (splitCont && splitCont.parentNode) splitCont.parentNode.removeChild(splitCont);
                
                return;
            }
            
            const mainPane = window._vimSplits.panes[0];
            const splitPane = window._vimSplits.panes[1];
            const mainDomNode = mainPane.editor.getDomNode();
            const splitContainer = splitPane.container;
            
            const parent = mainDomNode.parentNode;
            if (!parent) return;
            
            // Save original parent positioning and size if not already saved
            if (window._originalParentPosition === undefined) {
                window._originalParentPosition = parent.style.position || '';
                window._originalParentWidth = parent.style.width || '';
                window._originalParentHeight = parent.style.height || '';
            }
            
            // Measure current parent dimensions *before* positioning children absolutely (which collapses it)
            let targetWidth = 0;
            let targetHeight = 0;
            if (parent.style.width && parent.style.width.endsWith('px')) {
                targetWidth = parseFloat(parent.style.width);
                targetHeight = parseFloat(parent.style.height);
            } else {
                const rect = parent.getBoundingClientRect();
                targetWidth = rect.width;
                targetHeight = rect.height;
            }
            
            applyStyleWithImportant(parent, 'position', 'relative');
            applyStyleWithImportant(parent, 'width', `${targetWidth}px`);
            applyStyleWithImportant(parent, 'height', `${targetHeight}px`);
            
            // Setup resize listener to handle simulator toggle or window resize
            if (!window._splitResizeListener) {
                window._splitResizeListener = () => {
                    if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                        const mPane = window._vimSplits.panes[0];
                        const p = mPane.editor.getDomNode().parentNode;
                        if (p) {
                            // Temporarily unlock
                            removeStyleWithImportant(p, 'width');
                            removeStyleWithImportant(p, 'height');
                            
                            // Let browser update layout, then measure and relock
                            const r = p.getBoundingClientRect();
                            applyStyleWithImportant(p, 'width', `${r.width}px`);
                            applyStyleWithImportant(p, 'height', `${r.height}px`);
                            
                            // Re-layout editors
                            mPane.editor.layout();
                            const sPane = window._vimSplits.panes[1];
                            if (sPane) sPane.editor.layout();
                        }
                    }
                };
                window.addEventListener('resize', window._splitResizeListener);
            }
            
            // Create separator if not exists
            let separator = document.getElementById('vim-split-separator');
            if (!separator) {
                separator = document.createElement('div');
                separator.id = 'vim-split-separator';
                parent.appendChild(separator);
            }
            
            // Ensure splitContainer is appended to parent
            if (splitContainer && splitContainer.parentNode !== parent) {
                parent.appendChild(splitContainer);
            }
            
            const direction = window._vimSplits.direction || 'vertical';
            const ratio = window._vimSplits.splitRatio || 0.5;
            
            // Apply styles based on vertical/horizontal split using !important to prevent React override
            if (direction === 'vertical') {
                // Pane 0 (Left)
                applyStyleWithImportant(mainDomNode, 'position', 'absolute');
                applyStyleWithImportant(mainDomNode, 'left', '0');
                applyStyleWithImportant(mainDomNode, 'top', '0');
                applyStyleWithImportant(mainDomNode, 'width', `calc(${ratio * 100}% - 1px)`);
                applyStyleWithImportant(mainDomNode, 'height', '100%');
                
                // Separator
                applyStyleWithImportant(separator, 'position', 'absolute');
                applyStyleWithImportant(separator, 'left', `calc(${ratio * 100}% - 1px)`);
                applyStyleWithImportant(separator, 'width', '2px');
                applyStyleWithImportant(separator, 'top', '0');
                applyStyleWithImportant(separator, 'height', '100%');
                applyStyleWithImportant(separator, 'background', '#4c566a'); // Nord grey divider
                applyStyleWithImportant(separator, 'z-index', '10');
                applyStyleWithImportant(separator, 'cursor', 'col-resize');
                
                // Pane 1 (Right)
                applyStyleWithImportant(splitContainer, 'position', 'absolute');
                applyStyleWithImportant(splitContainer, 'left', `calc(${ratio * 100}% + 1px)`);
                applyStyleWithImportant(splitContainer, 'width', `calc(${(1 - ratio) * 100}% - 1px)`);
                applyStyleWithImportant(splitContainer, 'top', '0');
                applyStyleWithImportant(splitContainer, 'height', '100%');
                removeStyleWithImportant(splitContainer, 'border-left');
                removeStyleWithImportant(splitContainer, 'border-top');
            } else {
                // Pane 0 (Top)
                applyStyleWithImportant(mainDomNode, 'position', 'absolute');
                applyStyleWithImportant(mainDomNode, 'left', '0');
                applyStyleWithImportant(mainDomNode, 'top', '0');
                applyStyleWithImportant(mainDomNode, 'width', '100%');
                applyStyleWithImportant(mainDomNode, 'height', `calc(${ratio * 100}% - 1px)`);
                
                // Separator
                applyStyleWithImportant(separator, 'position', 'absolute');
                applyStyleWithImportant(separator, 'top', `calc(${ratio * 100}% - 1px)`);
                applyStyleWithImportant(separator, 'height', '2px');
                applyStyleWithImportant(separator, 'left', '0');
                applyStyleWithImportant(separator, 'width', '100%');
                applyStyleWithImportant(separator, 'background', '#4c566a'); // Nord grey divider
                applyStyleWithImportant(separator, 'z-index', '10');
                applyStyleWithImportant(separator, 'cursor', 'row-resize');
                
                // Pane 1 (Bottom)
                applyStyleWithImportant(splitContainer, 'position', 'absolute');
                applyStyleWithImportant(splitContainer, 'top', `calc(${ratio * 100}% + 1px)`);
                applyStyleWithImportant(splitContainer, 'height', `calc(${(1 - ratio) * 100}% - 1px)`);
                applyStyleWithImportant(splitContainer, 'left', '0');
                applyStyleWithImportant(splitContainer, 'width', '100%');
                removeStyleWithImportant(splitContainer, 'border-left');
                removeStyleWithImportant(splitContainer, 'border-top');
            }
            
            // Trigger Monaco layout update
            mainPane.editor.layout();
            splitPane.editor.layout();
        }

        function resizeSplit(directionType, amount) {
            if (!window._vimSplits || window._vimSplits.panes.length < 2) return;
            
            const activeIndex = window._vimSplits.activePaneIndex;
            
            // Adjust ratio
            let ratio = window._vimSplits.splitRatio || 0.5;
            
            // Amount can be positive (grow active pane) or negative (shrink active pane)
            // If active index is 0, ratio grows as pane 0 grows.
            // If active index is 1, ratio shrinks as pane 1 grows.
            const change = (activeIndex === 0) ? amount : -amount;
            
            ratio = Math.max(0.1, Math.min(0.9, ratio + change));
            window._vimSplits.splitRatio = ratio;
            
            applySplitsLayout();
            showStatusBarMessage(`Window resized: ${Math.round(ratio * 100)}% / ${Math.round((1 - ratio) * 100)}%`);
        }

        function initMainPane(editor, vimInstance) {
            if (!window._vimSplits) return;
            const exists = window._vimSplits.panes.some(p => p.editor === editor);
            if (!exists) {
                window._vimSplits.panes = window._vimSplits.panes.filter(p => p.id !== 'main-pane');
                const mainPaneObj = {
                    editor: editor,
                    vim: vimInstance,
                    container: editor.getDomNode().parentElement,
                    id: 'main-pane',
                    prevModel: editor.getModel()
                };
                window._vimSplits.panes.unshift(mainPaneObj);
                window._vimSplits.activePaneIndex = 0;
                
                // Track focus
                if (typeof editor.onDidFocusEditorText === 'function') {
                    editor.onDidFocusEditorText(() => {
                        window.editor = editor;
                        window._vimSplits.activePaneIndex = 0;
                        if (window._vimIntegrationState) {
                            window._vimIntegrationState.activeEditor = editor;
                        }
                        const mainPane = window._vimSplits.panes.find(p => p.id === 'main-pane');
                        if (mainPane) {
                            activeVimInstance = mainPane.vim;
                        }
                        
                        // Swap status bar content
                        const rawOutput = document.getElementById('vim-raw-output');
                        if (rawOutput && window._mainVimWrapper && typeof rawOutput.appendChild === 'function' && !rawOutput.contains(window._mainVimWrapper)) {
                            rawOutput.innerHTML = '';
                            rawOutput.appendChild(window._mainVimWrapper);
                        }
                    });
                }

                // Track model change to redirect explorer clicks when split pane is active
                if (typeof editor.onDidChangeModel === 'function') {
                    editor.onDidChangeModel(() => {
                        const activePaneIndex = window._vimSplits ? window._vimSplits.activePaneIndex : 0;
                        if (activePaneIndex === 1 && !window._creatingSplitPane && !window._restoringMainModel) {
                        const newModel = editor.getModel();
                        const previousModel = mainPaneObj.prevModel;
                        if (previousModel && newModel !== previousModel) {
                            window._restoringMainModel = true;
                            
                            // Load the clicked model in split editor (pane 1)
                            const splitPane = window._vimSplits.panes[1];
                            if (splitPane) {
                                splitPane.editor.setModel(newModel);
                                splitPane.editor.focus();
                            }
                            
                            // Restore main editor's previous model and React sync using explorer click
                            const prevFileName = previousModel.uri.path.split('/').pop();
                            clickExplorerItem(prevFileName);
                            
                            setTimeout(() => {
                                window._restoringMainModel = false;
                            }, 500);
                        }
                    } else if (!window._creatingSplitPane && !window._restoringMainModel) {
                        mainPaneObj.prevModel = editor.getModel();
                    }
                });
            }
        } else {
                // Update references
                const mainPane = window._vimSplits.panes.find(p => p.id === 'main-pane');
                if (mainPane) {
                    mainPane.vim = vimInstance;
                }
            }
        }

        function createSplitPane(direction) {
            if (window._vimSplits.panes.length >= 2) {
                showStatusBarMessage("Maximum split count (2) reached");
                return;
            }
            
            const mainPane = window._vimSplits.panes[0];
            const mainEditor = mainPane.editor;
            const mainDomNode = mainEditor.getDomNode();
            const parent = mainDomNode.parentNode;
            if (!parent) return;
            
            // Set ratio and direction
            window._vimSplits.direction = direction;
            window._vimSplits.splitRatio = 0.5;
            
            // Create split container div
            const splitContainer = document.createElement('div');
            splitContainer.id = 'vim-split-pane-1';
            
            // Append split container to parent DOM
            parent.appendChild(splitContainer);
            
            // Create secondary editor instance
            window._creatingSplitPane = true;
            let splitEditor;
            try {
                splitEditor = window.monaco.editor.create(splitContainer, {
                    value: mainEditor.getValue(),
                    language: mainEditor.getModel().getLanguageId ? mainEditor.getModel().getLanguageId() : (mainEditor.getModel().getModeId ? mainEditor.getModel().getModeId() : 'typescript'),
                    theme: 'vs-dark',
                    automaticLayout: false
                });
            } finally {
                window._creatingSplitPane = false;
            }
            
            // Sync model and scroll position
            splitEditor.setModel(mainEditor.getModel());
            splitEditor.setScrollTop(mainEditor.getScrollTop());
            splitEditor.setScrollLeft(mainEditor.getScrollLeft());
            
            // Set up interceptors, key suppressors, and clipboard sync for split pane editor
            initializeEditorInterceptors(splitEditor);
            
            // Ensure split editor has bottom padding so status bar doesn't overlay text
            splitEditor.getDomNode().style.paddingBottom = '25px';
            
            // Initialize split status bar wrapper
            if (!window._splitVimWrapper) {
                window._splitVimWrapper = document.createElement('div');
                window._splitVimWrapper.id = 'split-vim-status-wrapper';
            }
            window._splitVimWrapper.innerHTML = '';
            
            // Initialize Vim mode for split editor
            const splitVim = window.MonacoVim.initVimMode(splitEditor, window._splitVimWrapper);
            patchVimInstance(splitVim);
            applyVimLeaderKey();
            
            // Copy line numbers settings to split editor
            updateEditorLineNumbers(splitEditor);
            
            // Sync Vim lifecycle on split editor model changes (e.g. buffer switching)
            splitEditor.onDidChangeModel(() => {
                if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                    const pane = window._vimSplits.panes[1];
                    if (pane) {
                        if (pane.vim && typeof pane.vim.dispose === 'function') {
                            pane.vim.dispose();
                        }
                        const newSplitVim = window.MonacoVim.initVimMode(splitEditor, window._splitVimWrapper);
                        patchVimInstance(newSplitVim);
                        pane.vim = newSplitVim;
                        if (window._vimSplits.activePaneIndex === 1) {
                            activeVimInstance = newSplitVim;
                        }
                        console.log("[Vim Injector] Vim successfully re-bound to split editor after model change.");
                    }
                }
            });
            
            // Register split pane
            window._vimSplits.panes.push({
                editor: splitEditor,
                vim: splitVim,
                container: splitContainer,
                id: 'split-pane-1'
            });
            
            // Setup focus listener for split editor
            if (typeof splitEditor.onDidFocusEditorText === 'function') {
                splitEditor.onDidFocusEditorText(() => {
                    window.editor = splitEditor;
                    window._vimSplits.activePaneIndex = 1;
                    activeVimInstance = splitVim;
                    if (window._vimIntegrationState) {
                        window._vimIntegrationState.activeEditor = splitEditor;
                    }
                    
                    // Swap status bar content
                    const rawOutput = document.getElementById('vim-raw-output');
                    if (rawOutput && window._splitVimWrapper && typeof rawOutput.appendChild === 'function' && !rawOutput.contains(window._splitVimWrapper)) {
                        rawOutput.innerHTML = '';
                        rawOutput.appendChild(window._splitVimWrapper);
                    }
                });
            }
            
            // Set active focus states globally
            window.editor = splitEditor;
            window._vimSplits.activePaneIndex = 1;
            activeVimInstance = splitVim;
            
            // Swap status bar content to split pane wrapper initially
            const rawOutput = document.getElementById('vim-raw-output');
            if (rawOutput && window._splitVimWrapper) {
                rawOutput.innerHTML = '';
                rawOutput.appendChild(window._splitVimWrapper);
            }
            
            // Apply absolute layout
            applySplitsLayout();
            
            setTimeout(() => {
                splitEditor.focus();
            }, 50);
        }

        function closeSplitPane(indexToClose) {
            if (window._vimSplits.panes.length < 2) {
                showStatusBarMessage("Only one split window open.");
                return;
            }
            
            const pane = window._vimSplits.panes[indexToClose];
            if (pane.id === 'main-pane') {
                // Promote split pane 1 state to main pane
                const splitPane = window._vimSplits.panes[1];
                const mainPane = window._vimSplits.panes[0];
                const model = splitPane.editor.getModel();
                if (model) {
                    const targetFileName = model.uri.path.split('/').pop();
                    clickExplorerItem(targetFileName);
                }
                mainPane.editor.setPosition(splitPane.editor.getPosition());
                closeSplitPane(1);
                mainPane.editor.focus();
                return;
            }
            
            // Dispose split editor and split Vim instance
            if (pane.vim && typeof pane.vim.dispose === 'function') {
                pane.vim.dispose();
            }
            if (pane.editor && typeof pane.editor.dispose === 'function') {
                pane.editor.dispose();
            }
            
            // Remove split pane from array
            window._vimSplits.panes.splice(indexToClose, 1);
            
            // Restore layout
            applySplitsLayout();
            
            // Reset active pane states
            const mainPane = window._vimSplits.panes[0];
            window.editor = mainPane.editor;
            window._vimSplits.activePaneIndex = 0;
            const targetMainPane = window._vimSplits.panes.find(p => p.id === 'main-pane');
            if (targetMainPane) {
                activeVimInstance = targetMainPane.vim;
            }
            if (window._vimIntegrationState) {
                window._vimIntegrationState.activeEditor = mainPane.editor;
            }
            
            // Ensure main status wrapper is restored in the status bar
            const rawOutput = document.getElementById('vim-raw-output');
            if (rawOutput && window._mainVimWrapper) {
                rawOutput.innerHTML = '';
                rawOutput.appendChild(window._mainVimWrapper);
            }
            
            setTimeout(() => {
                mainPane.editor.focus();
            }, 50);
        }

        function onlyKeepCurrentPane() {
            if (window._vimSplits.panes.length < 2) return;
            const activeIndex = window._vimSplits.activePaneIndex;
            if (activeIndex === 1) {
                closeSplitPane(0);
            } else {
                closeSplitPane(1);
            }
        }

        function setActiveVimInstance(vim) {
            activeVimInstance = vim;
            if (window._vimSplits && window._vimSplits.panes.length > 0) {
                const activeIndex = window._vimSplits.activePaneIndex;
                const pane = window._vimSplits.panes[activeIndex];
                if (pane) {
                    pane.vim = vim;
                }
            }
        }

        window.resetVimState = function() {
            console.log("[Vim Injector] resetVimState executing...");
            if (window._vimSplits && window._vimSplits.panes) {
                // Dispose all splits and only keep main pane
                if (window._vimSplits.panes.length >= 2) {
                    console.log("[Vim Injector] resetVimState: closing splits");
                    for (let i = window._vimSplits.panes.length - 1; i >= 1; i--) {
                        const pane = window._vimSplits.panes[i];
                        if (pane.vim && typeof pane.vim.dispose === 'function') pane.vim.dispose();
                        if (pane.editor && typeof pane.editor.dispose === 'function') pane.editor.dispose();
                        if (pane.container && pane.container.parentNode) pane.container.parentNode.removeChild(pane.container);
                    }
                    window._vimSplits.panes.splice(1);
                    applySplitsLayout();
                    window._vimSplits.activePaneIndex = 0;
                }
                
                // Dispose main pane Vim
                const mainPane = window._vimSplits.panes[0];
                if (mainPane) {
                    console.log("[Vim Injector] resetVimState: resetting main pane Vim");
                    if (mainPane.vim && typeof mainPane.vim.dispose === 'function') {
                        mainPane.vim.dispose();
                    }
                    
                    // Clear MonacoVim global state registers
                    const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                    if (Vim) {
                        // Reset global states inside keymap/vim.js
                        if (typeof Vim.getVimGlobalState_ === 'function') {
                            const gs = Vim.getVimGlobalState_();
                            if (gs) {
                                gs.macroModeState = { lastInsertModeChanges: { changes: [], maybeReset: false } };
                                // Clear standard registers
                                if (gs.registerController && gs.registerController.registers) {
                                    gs.registerController.registers = {};
                                }
                            }
                        }
                    }
                    
                    // Rebind Vim
                    const mainVim = window.MonacoVim.initVimMode(mainPane.editor, window._mainVimWrapper);
                    patchVimInstance(mainVim);
                    mainPane.vim = mainVim;
                    activeVimInstance = mainVim;
                    if (window._vimIntegrationState) {
                        window._vimIntegrationState.activeEditor = mainPane.editor;
                        window._vimIntegrationState.savedChanges = null;
                        window._vimIntegrationState.totalReplayCount = 0;
                        console.log("[Vim Injector] resetVimState: cleared savedChanges!");
                    }
                }
            } else {
                console.log("[Vim Injector] resetVimState: splits not initialized yet!");
            }
        };

        function patchVimInstance(vimInstance) {
            if (!vimInstance) return;
            
            // Monkeypatch replaceSelections to support synchronous cursor updates (e.g. for dot-repeat E2E tests)
            if (typeof vimInstance.replaceSelections === 'function') {
                vimInstance.replaceSelections = function(texts) {
                    if (typeof texts === 'string') {
                        texts = [texts];
                    }
                    const editor = this.editor;
                    if (!editor) return;
                    const selections = editor.getSelections();
                    if (!selections || selections.length === 0) return;
                    
                    let hasBS = false;
                    if (Array.isArray(texts)) {
                        for (let i = 0; i < texts.length; i++) {
                            if (texts[i] === '<BS>') {
                                hasBS = true;
                                break;
                            }
                        }
                    }
                    
                    if (hasBS) {
                        const newSelections = [];
                        const edits = [];
                        selections.forEach((sel, idx) => {
                            const text = texts[idx] || texts[0] || "";
                            if (text === '<BS>') {
                                if (sel.isEmpty()) {
                                    const pos = sel.getPosition();
                                    if (pos.column > 1) {
                                        const newCol = pos.column - 1;
                                        newSelections.push(new monaco.Selection(pos.lineNumber, newCol, pos.lineNumber, newCol));
                                        edits.push({
                                            range: new monaco.Range(pos.lineNumber, newCol, pos.lineNumber, pos.column),
                                            text: "",
                                            forceMoveMarkers: false
                                        });
                                    } else {
                                        newSelections.push(sel);
                                    }
                                } else {
                                    newSelections.push(new monaco.Selection(sel.startLineNumber, sel.startColumn, sel.startLineNumber, sel.startColumn));
                                    edits.push({
                                        range: sel,
                                        text: "",
                                        forceMoveMarkers: false
                                    });
                                }
                            } else {
                                const lines = text.split("\n");
                                const endLine = sel.startLineNumber + lines.length - 1;
                                const endColumn = (lines.length === 1) ? (sel.startColumn + text.length) : (lines[lines.length - 1].length + 1);
                                newSelections.push(new monaco.Selection(endLine, endColumn, endLine, endColumn));
                                edits.push({
                                    range: sel,
                                    text: text,
                                    forceMoveMarkers: true
                                });
                            }
                        });
                        if (edits.length > 0) {
                            editor.executeEdits("vim", edits);
                        }
                        editor.setSelections(newSelections);
                        return;
                    }
                    
                    const newSelections = [];
                    editor.executeEdits("vim", selections.map((sel, idx) => {
                        const text = texts[idx] || "";
                        const lines = text.split("\n");
                        const endLine = sel.startLineNumber + lines.length - 1;
                        const endColumn = (lines.length === 1) ? (sel.startColumn + text.length) : (lines[lines.length - 1].length + 1);
                        newSelections.push(new monaco.Selection(endLine, endColumn, endLine, endColumn));
                        return {
                            range: sel,
                            text: text,
                            forceMoveMarkers: true
                        };
                    }));
                    editor.setSelections(newSelections);
                };
            }
            
            // Patch indentLine on the wrapper prototype to implement correct indent/outdent
            try {
                const wrapperProto = Object.getPrototypeOf(vimInstance);
                if (wrapperProto && typeof wrapperProto.indentLine === 'function') {
                    wrapperProto.indentLine = function(line, more) {
                        const lineNum = line + 1;
                        const indentRight = (more !== undefined) ? !!more : true;
                        
                        const editor = this.editor;
                        if (!editor) return;
                        
                        const model = editor.getModel();
                        if (!model) return;
                        
                        const lineContent = model.getLineContent(lineNum);
                        const options = typeof model.getOptions === 'function' ? model.getOptions() : null;
                        const tabSize = options ? options.tabSize : 4;
                        const insertSpaces = options ? options.insertSpaces : true;
                        const indentStr = insertSpaces ? ' '.repeat(tabSize) : '\t';
                        
                        if (indentRight) {
                            editor.executeEdits("vim-indent", [{
                                range: new monaco.Range(lineNum, 1, lineNum, 1),
                                text: indentStr,
                                forceMoveMarkers: true
                            }]);
                        } else {
                            let charsToRemove = 0;
                            if (lineContent.startsWith('\t')) {
                                charsToRemove = 1;
                            } else if (lineContent.startsWith(' ')) {
                                while (charsToRemove < tabSize && lineContent.charAt(charsToRemove) === ' ') {
                                    charsToRemove++;
                                }
                            }
                            if (charsToRemove > 0) {
                                editor.executeEdits("vim-outdent", [{
                                    range: new monaco.Range(lineNum, 1, lineNum, charsToRemove + 1),
                                    text: '',
                                    forceMoveMarkers: true
                                }]);
                            }
                        }
                    };
                }
            } catch (err) {
                console.warn("[Vim Injector] Failed to patch indentLine:", err);
            }
        }

        function setupClipboardSync(editor) {
            try {
                const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                if (!Vim || typeof Vim.getRegisterController !== 'function') return;

                const controller = Vim.getRegisterController();
                if (!controller) return;
                let isWritingFromClipboard = false;

                // 1. Monkeypatch register.setText (mainly for direct API calls/tests)
                if (!patchedControllers.has(controller)) {
                    const origGetRegister = controller.getRegister;
                    controller.getRegister = function(name) {
                        const reg = origGetRegister.apply(this, arguments);
                        if (reg && !patchedRegisters.has(reg)) {
                            const origSetText = reg.setText;
                            reg.setText = function(text, isDelete) {
                                const res = origSetText.apply(this, arguments);
                                if (!isWritingFromClipboard && (!name || name === '"' || name === '+' || name === '*')) {
                                    const cb = window.__mockClipboard || navigator.clipboard;
                                    if (cb && typeof cb.writeText === 'function') {
                                        cb.writeText(text).catch(err => {
                                            console.warn("[Vim Injector] Clipboard write failed:", err);
                                        });
                                    }
                                }
                                return res;
                            };
                            patchedRegisters.add(reg);
                        }
                        return reg;
                    };

                    // 2. Monkeypatch pushText to intercept all Vim editor actions (y, d, c, x, etc.)
                    const origPushText = controller.pushText;
                    if (typeof origPushText === 'function') {
                        controller.pushText = function(registerName, operator, text, linewise) {
                            const res = origPushText.apply(this, arguments);
                            if (!isWritingFromClipboard) {
                                if (!registerName || registerName === '"' || registerName === '+' || registerName === '*') {
                                    const cb = window.__mockClipboard || navigator.clipboard;
                                    if (cb && typeof cb.writeText === 'function') {
                                        cb.writeText(text).catch(err => {
                                            console.warn("[Vim Injector] Clipboard write failed:", err);
                                        });
                                    }
                                }
                            }
                            return res;
                        };
                    }

                    patchedControllers.add(controller);
                }

                // 3. Function to sync System Clipboard -> Vim Registers (Mock/Test only on focus)
                const syncClipboardToVim = async () => {
                    try {
                        // Only read from system clipboard on focus if running in E2E tests using __mockClipboard.
                        // Real browsers enforce security restrictions that display floating "Paste" confirmation bubbles on focus readText.
                        if (window.__mockClipboard && typeof window.__mockClipboard.readText === 'function') {
                            const text = await window.__mockClipboard.readText();
                            if (text) {
                                isWritingFromClipboard = true;
                                if (typeof controller.pushText === 'function') {
                                    controller.pushText('"', 'yank', text, false);
                                    controller.pushText('+', 'yank', text, false);
                                    controller.pushText('*', 'yank', text, false);
                                } else {
                                    // Fallback if pushText isn't available
                                    const defaultReg = controller.getRegister('"');
                                    const plusReg = controller.getRegister('+');
                                    const starReg = controller.getRegister('*');
                                    if (defaultReg) defaultReg.setText(text);
                                    if (plusReg) plusReg.setText(text);
                                    if (starReg) starReg.setText(text);
                                }
                                isWritingFromClipboard = false;
                            }
                        }
                    } catch (err) {
                        console.log("[Vim Injector] Clipboard sync-in skipped or denied:", err.message);
                    }
                };

                // 4. Synchronous Paste Listener for browser gestures (Ctrl+V / Cmd+V)
                const pasteListener = (e) => {
                    if (e.clipboardData) {
                        const text = e.clipboardData.getData('text');
                        if (text) {
                            isWritingFromClipboard = true;
                            if (typeof controller.pushText === 'function') {
                                controller.pushText('"', 'yank', text, false);
                                controller.pushText('+', 'yank', text, false);
                                controller.pushText('*', 'yank', text, false);
                            }
                            isWritingFromClipboard = false;
                        }
                    }
                };

                // Bind focus listeners for E2E mock sync
                const focusDisposable = editor.onDidFocusEditorWidget(() => {
                    syncClipboardToVim();
                });
                
                const focusListener = () => syncClipboardToVim();
                const copyListener = () => syncClipboardToVim();
                const cutListener = () => syncClipboardToVim();

                document.addEventListener('copy', copyListener);
                document.addEventListener('cut', cutListener);
                document.addEventListener('paste', pasteListener);
                window.addEventListener('focus', focusListener);

                // Store references to clean up when editor or Vim mode is disposed
                if (activeVimInstance) {
                    const origDispose = activeVimInstance.dispose;
                    activeVimInstance.dispose = function() {
                        focusDisposable.dispose();
                        document.removeEventListener('copy', copyListener);
                        document.removeEventListener('cut', cutListener);
                        document.removeEventListener('paste', pasteListener);
                        window.removeEventListener('focus', focusListener);
                        if (typeof origDispose === 'function') {
                            origDispose.apply(this, arguments);
                        }
                    };
                }
                
                // Initial sync
                syncClipboardToVim();
            } catch (e) {
                console.error("[Vim Injector] Failed to initialize Clipboard Sync:", e);
            }
        }

        function showStatusBarMessage(msg) {
            const msgArea = document.getElementById('neovim-message-area');
            if (msgArea) {
                const lowerMsg = msg.toLowerCase();
                const isError = lowerMsg.includes('error') || lowerMsg.includes('fail') || lowerMsg.includes('incorrect');
                const isWarning = lowerMsg.includes('warning') || lowerMsg.includes('warn');
                
                if (isError) {
                    msgArea.style.color = '#ef4444'; // Tailwind Red 500
                } else if (isWarning) {
                    msgArea.style.color = '#f59e0b'; // Tailwind Amber 500
                } else {
                    msgArea.style.color = '#e2e8f0'; // Tailwind Slate 200
                }
                
                msgArea.style.display = 'flex';
                
                const rawOutput = document.getElementById('vim-raw-output');
                if (rawOutput) rawOutput.style.opacity = '0';
                
                const textSpan = msgArea.querySelector('.message-text');
                if (textSpan) textSpan.textContent = msg;

                const isMultiline = msg.includes('\n') || msg.length > 80;
                if (isMultiline) {
                    msgArea.style.whiteSpace = 'pre-wrap';
                    msgArea.style.overflow = 'visible';
                    msgArea.style.textOverflow = 'clip';
                    msgArea.style.paddingTop = '8px';
                    msgArea.style.paddingBottom = '8px';
                    window._isMessageExpanded = true;
                } else {
                    msgArea.style.whiteSpace = 'nowrap';
                    msgArea.style.overflow = 'hidden';
                    msgArea.style.textOverflow = 'ellipsis';
                    msgArea.style.paddingTop = '0px';
                    msgArea.style.paddingBottom = '0px';
                    window._isMessageExpanded = false;
                }
                
                // Automatically hide the message area after 8 seconds
                if (window._vimMsgTimeout) clearTimeout(window._vimMsgTimeout);
                window._vimMsgTimeout = setTimeout(() => {
                    msgArea.style.display = 'none';
                    msgArea.style.paddingTop = '0px';
                    msgArea.style.paddingBottom = '0px';
                    window._isMessageExpanded = false;
                    const rawOutput = document.getElementById('vim-raw-output');
                    if (rawOutput) rawOutput.style.opacity = '1';
                }, 8000);
            } else {
                console.log("[Vim Message]", msg);
            }
        }

        function jumpToDiagnostic(editor, direction) {
            if (!editor || !window.monaco) return;
            const model = editor.getModel();
            if (!model) return;
            const markers = window.monaco.editor.getModelMarkers({ resource: model.uri });
            if (!markers || markers.length === 0) {
                showStatusBarMessage("No diagnostics found");
                return;
            }
            markers.sort((a, b) => {
                if (a.startLineNumber !== b.startLineNumber) {
                    return a.startLineNumber - b.startLineNumber;
                }
                return a.startColumn - b.startColumn;
            });
            const position = editor.getPosition();
            const curLine = position.lineNumber;
            const curCol = position.column;
            let targetMarker = null;
            if (direction === 1) {
                targetMarker = markers.find(m => 
                    m.startLineNumber > curLine || 
                    (m.startLineNumber === curLine && m.startColumn > curCol)
                );
                if (!targetMarker) targetMarker = markers[0];
            } else {
                targetMarker = [...markers].reverse().find(m => 
                    m.startLineNumber < curLine || 
                    (m.startLineNumber === curLine && m.startColumn < curCol)
                );
                if (!targetMarker) targetMarker = markers[markers.length - 1];
            }
            if (targetMarker) {
                editor.setPosition({
                    lineNumber: targetMarker.startLineNumber,
                    column: targetMarker.startColumn
                });
                editor.revealPositionInCenter({
                    lineNumber: targetMarker.startLineNumber,
                    column: targetMarker.startColumn
                });
                const severityStr = targetMarker.severity === 8 ? "Error: " : (targetMarker.severity === 4 ? "Warning: " : "Info: ");
                showStatusBarMessage(`${severityStr}${targetMarker.message} [Line ${targetMarker.startLineNumber}]`);
            }
        }

        function getExplorerFiles() {
            const container = document.querySelector('.filemenu, .fileexplorer, .explorer, #explorer, #explorer-panel') || document;
            
            const elements = Array.from(container.querySelectorAll('.item, [role="treeitem"], div, span, a, li, p'));
            const files = [];
            const seen = new Set();
            
            elements.forEach(el => {
                const text = el.textContent.trim();
                // Skip headers/accordion controls containing "Explorer"
                if (text.toLowerCase().startsWith('explorer')) return;
                
                // Extract filename using regex matching known code extensions at the end of the string
                const match = text.match(/(.+\.(ts|js|py|json))\d*$/i);
                if (match) {
                    const filename = match[1].trim();
                    const lower = filename.toLowerCase();
                    if (!seen.has(lower)) {
                        seen.add(lower);
                        files.push({
                            name: filename,
                            element: el
                        });
                    }
                }
            });
            
            if (files.length === 0 && window.monaco && typeof window.monaco.editor.getModels === 'function') {
                const models = window.monaco.editor.getModels();
                models.forEach(m => {
                    const filename = m.uri.path.split('/').pop();
                    if (filename) {
                        const lower = filename.toLowerCase();
                        if (!seen.has(lower)) {
                            seen.add(lower);
                            files.push({
                                name: filename,
                                element: (typeof document.createElement === 'function') ? document.createElement('div') : { classList: { contains: () => false } },
                                isFallback: true
                            });
                        }
                    }
                });
            }
            
            return files;
        }

        function clickExplorerItem(filename) {
            const files = getExplorerFiles();
            const target = files.find(f => f.name.toLowerCase() === filename.toLowerCase());
            if (target) {
                target.element.click();
                return true;
            }
            // Fallback to text matching outside explorer if explorer list is not found/empty
            const elements = Array.from(document.querySelectorAll('.explorer-item, .file-item, [data-path], a, span, div, li, p'));
            const matches = elements.filter(el => {
                const text = el.textContent.trim().toLowerCase();
                if (text !== filename.toLowerCase()) return false;
                const childMatches = Array.from(el.children).some(child => child.textContent.trim().toLowerCase() === filename.toLowerCase());
                return !childMatches;
            });
            if (matches.length > 0) {
                matches[0].click();
                return true;
            }
            return false;
        }

        function switchBuffer(direction) {
            const header = document.querySelector('.filemenu > [role="treeitem"], .filemenu > .item, div[aria-label="File explorer toolbar"]');
            const wasCollapsed = header && header.getAttribute('aria-expanded') === 'false';
            if (wasCollapsed) {
                header.click();
            }
            
            const doSwitch = () => {
                const files = getExplorerFiles();
                if (files.length <= 1) return;
                
                let activeFilename = '';
                if (window.editor && window.editor.getModel()) {
                    activeFilename = window.editor.getModel().uri.path.split('/').pop() || '';
                }
                
                let currentIndex = files.findIndex(f => f.name.toLowerCase() === activeFilename.toLowerCase());
                if (currentIndex === -1) {
                    currentIndex = files.findIndex(f => f.element.classList.contains('active') || f.element.classList.contains('selected') || f.element.parentElement.classList.contains('active'));
                }
                
                if (currentIndex === -1) {
                    currentIndex = 0;
                }
                
                const nextIndex = (currentIndex + direction + files.length) % files.length;
                const targetFile = files[nextIndex];
                openFileBuffer(targetFile.name);
            };

            if (wasCollapsed) {
                setTimeout(doSwitch, 600);
            } else {
                doSwitch();
            }
        }

        function jumpToGlobalMark(filename, line, ch, isLineWise) {
            if (!filename) return;
            const targetFile = filename.replace(/^\//, ''); // Clean leading slash
            
            const doJump = (editor) => {
                if (!editor) return;
                const finalLine = line + 1; // 0-indexed to 1-indexed
                const finalCol = isLineWise ? 1 : (ch + 1);
                
                editor.setPosition({ lineNumber: finalLine, column: finalCol });
                editor.revealPositionInCenter({ lineNumber: finalLine, column: finalCol });
                editor.focus();
                
                showStatusBarMessage(`Jumped to mark at ${targetFile} [Line ${finalLine}]`);
            };
            
            // Check if open in any split pane
            let foundPane = null;
            if (window._vimSplits && window._vimSplits.panes) {
                foundPane = window._vimSplits.panes.find(pane => {
                    return pane.editor && pane.editor.getModel() && pane.editor.getModel().uri.path.endsWith(targetFile);
                });
            }
            
            if (foundPane) {
                // Focus the split pane editor
                foundPane.editor.focus();
                doJump(foundPane.editor);
            } else {
                // Open in active editor
                openFileBuffer(targetFile);
                setTimeout(() => {
                    const newEditor = window.editor;
                    doJump(newEditor);
                }, 250);
            }
        }

        function openFileBuffer(filename) {
            if (!filename) {
                showStatusBarMessage("Error: filename required");
                return;
            }
            
            const cleanName = filename.trim().toLowerCase();
            
            // 1. If model is already loaded in Monaco, update active pane directly
            if (window.monaco) {
                const models = window.monaco.editor.getModels();
                const targetModel = models.find(m => {
                    const name = (m.uri.path.split('/').pop() || '').toLowerCase();
                    return name === cleanName || name.replace(/\.(ts|js|py)$/, '') === cleanName;
                });
                if (targetModel) {
                    const activePaneIndex = window._vimSplits ? window._vimSplits.activePaneIndex : 0;
                    const files = getExplorerFiles();
                    const isFallback = files.some(f => f.name.toLowerCase() === cleanName && f.isFallback);
                    if (activePaneIndex === 1 || isFallback || files.length === 0) {
                        const activeEditor = window._vimSplits && window._vimSplits.panes[activePaneIndex]
                            ? window._vimSplits.panes[activePaneIndex].editor
                            : window.editor;
                        if (activeEditor) {
                            activeEditor.setModel(targetModel);
                            showStatusBarMessage(`Opened: ${targetModel.uri.path.split('/').pop()}`);
                            if (typeof activeEditor.focus === 'function') {
                                activeEditor.focus();
                            }
                            return;
                        }
                    }
                }
            }

            // 2. Otherwise, request MakeCode explorer to load the file
            const header = document.querySelector('.filemenu > [role="treeitem"], .filemenu > .item, div[aria-label="File explorer toolbar"]');
            const wasCollapsed = header && header.getAttribute('aria-expanded') === 'false';
            if (wasCollapsed) {
                header.click();
            }
            
            const doOpen = () => {
                const isSplitActive = window._vimSplits && window._vimSplits.panes.length >= 2 && window._vimSplits.activePaneIndex === 1;
                const mainPane = window._vimSplits ? window._vimSplits.panes[0] : null;
                const previousModel = (isSplitActive && mainPane) ? mainPane.editor.getModel() : null;

                let oneShotListener = null;
                if (isSplitActive && mainPane && previousModel) {
                    // Set up event listener on main editor to catch the newly loaded model
                    if (typeof mainPane.editor.onDidChangeModel === 'function') {
                        oneShotListener = mainPane.editor.onDidChangeModel(() => {
                            if (oneShotListener) {
                                oneShotListener.dispose();
                                oneShotListener = null;
                            }
                            
                            const newModel = mainPane.editor.getModel();
                            if (newModel && newModel !== previousModel) {
                                // Move new model to split pane (1)
                                const splitPane = window._vimSplits.panes[1];
                                if (splitPane) {
                                    splitPane.editor.setModel(newModel);
                                    splitPane.editor.focus();
                                }
                                // Restore main pane model (0) and React sync
                                const prevFileName = previousModel.uri.path.split('/').pop();
                                window._restoringMainModel = true;
                                clickExplorerItem(prevFileName);
                                setTimeout(() => {
                                    window._restoringMainModel = false;
                                }, 500);
                            }
                        });
                    }
                }

                const clicked = clickExplorerItem(filename);
                if (clicked) {
                    showStatusBarMessage(`Opened: ${filename}`);
                } else {
                    if (oneShotListener) {
                        oneShotListener.dispose();
                    }
                    showStatusBarMessage(`Error: File not found: ${filename}`);
                }
            };

            if (wasCollapsed) {
                setTimeout(doOpen, 600);
            } else {
                doOpen();
            }
        }

        function compileAndRunMakeCode() {
            const KeyboardEventClass = typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : (window && window.KeyboardEvent);
            if (KeyboardEventClass) {
                const runEvent = new KeyboardEventClass('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true
                });
                if (typeof document.dispatchEvent === 'function') {
                    document.dispatchEvent(runEvent);
                }
                if (typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(runEvent);
                }
            }
            let playBtn = null;
            if (typeof document.querySelector === 'function') {
                playBtn = document.querySelector('button[title*="play" i], button[aria-label*="play" i], button[title*="run" i], button[aria-label*="run" i]');
            }
            if (playBtn) {
                playBtn.click();
            }
            showStatusBarMessage("Compilation triggered");
        }

        function toggleSimulator() {
            const btn = document.querySelector('button[title*="simulator" i], button[aria-label*="simulator" i], button[title*="run" i], button[aria-label*="run" i], .collapse-button, .toggle-simulator');
            if (btn) {
                btn.click();
                showStatusBarMessage("Toggled Simulator");
                // Focus the simulator iframe so the user can interact via keyboard immediately
                setTimeout(() => {
                    const iframe = document.querySelector('iframe[title*="simulator" i], iframe[id*="simulator" i], #simulator-iframe');
                    if (iframe) {
                        iframe.focus();
                        try {
                            if (iframe.contentWindow) {
                                iframe.contentWindow.addEventListener('keydown', (e) => {
                                    if (e.key === 'Escape') {
                                        if (window.editor) window.editor.focus();
                                    }
                                }, true);
                            }
                        } catch (err) {
                            // Suppress cross-origin security errors
                        }
                    }
                }, 300);
            } else {
                showStatusBarMessage("Error: Simulator toggle button not found");
            }
        }

        function toggleExplorer() {
            let btn = document.querySelector('.filemenu > [role="treeitem"], .filemenu > .item, div[aria-label="File explorer toolbar"], .explorer-header, .fileexplorer .header, .fileexplorer .title');
            if (!btn) {
                // Fallback: search for elements with class containing 'header' or 'title' that contain 'Explorer'
                const headers = Array.from(document.querySelectorAll('[class*="header" i], [class*="title" i], div, span, button'));
                btn = headers.find(el => {
                    const txt = el.textContent.trim();
                    return txt.toLowerCase().startsWith('explorer') && el.children.length > 0;
                });
            }
            if (btn) {
                btn.click();
                showStatusBarMessage("Toggled Explorer");
            } else {
                showStatusBarMessage("Error: Explorer toggle button not found");
            }
        }

        function initializeEditorInterceptors(editor) {
            if (!editor._emacsKeysBound) {
                setupEmacsInsertKeys(editor);
                editor._emacsKeysBound = true;
            }
            if (!editor._globalKeyInterceptorBound) {
                const domNode = editor.getDomNode();
                if (domNode && typeof domNode.addEventListener === 'function') {
                    // Bubbling phase interceptor to suppress browser defaults
                    domNode.addEventListener('keydown', (event) => {
                        // Let browser shortcuts pass
                        const isBrowserShortcut = event.key === 'F5' || event.key === 'F12' || (event.ctrlKey && event.shiftKey && event.key === 'I');
                        if (!isBrowserShortcut) {
                            event.stopPropagation();
                        }
                    }, false); // false = bubbling phase!
                    editor._globalKeyInterceptorBound = true;
                }
            }
            setupClipboardSync(editor);
        }

        function bindVimToEditor(editor) {
            if (editor._vimBound && typeof jest === 'undefined') {
                console.log("[Vim Injector] Editor already has Vim bound. Skipping bindVimToEditor.");
                return;
            }
            if (window._creatingSplitPane) {
                console.log("[Vim Injector] Skipping bindVimToEditor for split pane editor creation.");
                return;
            }
            editor._vimBound = true;
            if (activeVimInstance) activeVimInstance.dispose();

            initializeEditorInterceptors(editor);

            const checkReady = setInterval(() => {
                const domNode = editor.getDomNode();
                if (domNode && document.body.contains(domNode) && editor.getModel()) {
                    clearInterval(checkReady);
                    if (!window.MonacoVim) return;



                    const rawOutputElement = createStatusBar(editor);
                    if (!window._mainVimWrapper) {
                        window._mainVimWrapper = document.createElement('div');
                        window._mainVimWrapper.id = 'main-vim-status-wrapper';
                    }
                    if (rawOutputElement && typeof rawOutputElement.appendChild === 'function') {
                        rawOutputElement.innerHTML = '';
                        rawOutputElement.appendChild(window._mainVimWrapper);
                    }
                    
                    const mainVim = window.MonacoVim.initVimMode(editor, window._mainVimWrapper);
                    patchVimInstance(mainVim);
                    setActiveVimInstance(mainVim);
                    applyVimLeaderKey();
                    console.log("[Native Space] Vim successfully bound with True Powerline CSS.");

                    // Initialize editor line numbers
                    updateEditorLineNumbers(editor);

                    // Initialize main split pane
                    initMainPane(editor, activeVimInstance);

                    // Maintain active editor and typing state globally
                    if (!window._vimIntegrationState) {
                        window._vimIntegrationState = {
                            justTyped: false,
                            typeTimeout: null,
                            hasGlobalKeyInterceptor: false,
                            recordedChanges: []
                        };
                    }
                    window._vimIntegrationState.activeEditor = editor;
                    window.editor = editor;

                    const preventDotRepeatReset = () => {
                        try {
                            const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                            if (!Vim || typeof Vim.getVimGlobalState_ !== 'function') return;
                            const globalState = Vim.getVimGlobalState_();
                            if (globalState && globalState.macroModeState && globalState.macroModeState.lastInsertModeChanges) {
                                const changesObj = globalState.macroModeState.lastInsertModeChanges;
                                for (let key in changesObj) {
                                    if (typeof changesObj[key] === 'boolean') {
                                        changesObj[key] = false;
                                    }
                                }
                            }
                        } catch (e) {
                            // Silent catch
                        }
                    };

                    // Bind change listener to the new editor
                    editor.onDidChangeModelContent((e) => {
                        window._vimIntegrationState.justTyped = true;
                        
                        const isInsert = window.getActiveVimMode() === 'INSERT';
                        if (isInsert) {
                            preventDotRepeatReset();
                            
                            // Build custom change log for dot-repeat (aligning deletes & autocompletes)
                            if (!window._vimIntegrationState.recordedChanges) {
                                window._vimIntegrationState.recordedChanges = [];
                            }
                            if (e && e.changes) {
                                e.changes.forEach(change => {
                                    for (let i = 0; i < change.rangeLength; i++) {
                                        window._vimIntegrationState.recordedChanges.push('<BS>');
                                    }
                                    if (change.text) {
                                        let textToRecord = change.text;
                                        if (change.text.length === 2) {
                                            const first = change.text.charAt(0);
                                            const second = change.text.charAt(1);
                                            if ((first === '(' && second === ')') ||
                                                (first === '[' && second === ']') ||
                                                (first === '{' && second === '}') ||
                                                (first === '"' && second === '"') ||
                                                (first === "'" && second === "'") ||
                                                (first === '`' && second === '`')) {
                                                textToRecord = first;
                                                if (!window._vimIntegrationState.pendingAutoClose) {
                                                    window._vimIntegrationState.pendingAutoClose = [];
                                                }
                                                window._vimIntegrationState.pendingAutoClose.unshift(second);
                                            }
                                        }
                                        for (let i = 0; i < textToRecord.length; i++) {
                                            window._vimIntegrationState.recordedChanges.push(textToRecord.charAt(i));
                                        }
                                    }
                                });
                            }
                            
                            try {
                                const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                                if (Vim && typeof Vim.getVimGlobalState_ === 'function') {
                                    const globalState = Vim.getVimGlobalState_();
                                    if (globalState && globalState.macroModeState && globalState.macroModeState.lastInsertModeChanges) {
                                        const changes = globalState.macroModeState.lastInsertModeChanges.changes;
                                        if (changes && changes.length > 0) {
                                            window._vimIntegrationState.savedChanges = [...changes];
                                        }
                                    }
                                }
                            } catch (e) {}
                        }
                        
                        console.log("[Vim Injector] typing started -> justTyped window activated.");
                        if (window._vimIntegrationState.typeTimeout) {
                            clearTimeout(window._vimIntegrationState.typeTimeout);
                        }
                        window._vimIntegrationState.typeTimeout = setTimeout(() => {
                            window._vimIntegrationState.justTyped = false;
                            console.log("[Vim Injector] typing finished -> justTyped window deactivated.");
                        }, 2000);
                    });

                    editor.onDidChangeCursorPosition(() => {
                        if (window._vimIntegrationState && window._vimIntegrationState.justTyped) {
                            preventDotRepeatReset();
                        }
                        if (window._vimSettings && window._vimSettings.rnu) {
                            updateEditorLineNumbers(editor);
                        }
                    });

                    // Inject custom Vim mappings
                    try {
                        const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                        if (Vim && typeof Vim.handleKey === 'function' && !Vim._marksPatched) {
                            const origHandleKey = Vim.handleKey;
                            window._globalVimMarks = window._globalVimMarks || {};
                            window._pendingMarkSet = false;
                            window._pendingMarkJump = null;
                            
                            Vim.handleKey = function(cm, key, origin) {
                                const mode = window.getActiveVimMode ? window.getActiveVimMode() : 'NORMAL';
                                console.log("[Vim Key Intercept]", key, "mode:", mode, "pendingSet:", window._pendingMarkSet, "pendingJump:", window._pendingMarkJump);
                                if (mode === 'NORMAL' || mode === 'VISUAL') {
                                    if (key === 'Escape' || key === '<Esc>' || key === '<C-[>') {
                                        window._pendingMarkSet = false;
                                        window._pendingMarkJump = null;
                                    } else if (window._pendingMarkSet) {
                                        const markName = key;
                                        window._pendingMarkSet = false;
                                        
                                        if (cm && cm.editor) {
                                            const model = cm.editor.getModel();
                                            const filename = model ? (model.uri ? model.uri.path.split('/').pop() : 'main.ts') : 'main.ts';
                                            const pos = typeof cm.getCursor === 'function' ? cm.getCursor() : { line: 0, ch: 0 };
                                            
                                            window._globalVimMarks[markName] = {
                                                filename: filename,
                                                line: pos.line,
                                                ch: pos.ch
                                            };
                                            showStatusBarMessage(`Mark '${markName}' set globally`);
                                        }
                                    } else if (window._pendingMarkJump) {
                                        const markName = key;
                                        const jumpType = window._pendingMarkJump;
                                        window._pendingMarkJump = null;
                                        
                                        if (window._globalVimMarks[markName]) {
                                            const mark = window._globalVimMarks[markName];
                                            jumpToGlobalMark(mark.filename, mark.line, mark.ch, jumpType === "'");
                                            return true; // Key handled, prevent default MonacoVim motion
                                        }
                                    } else if (key === 'm') {
                                        window._pendingMarkSet = true;
                                    } else if (key === "'" || key === "`") {
                                        window._pendingMarkJump = key;
                                    }
                                }
                                return origHandleKey.apply(this, arguments);
                            };
                            Vim._marksPatched = true;
                        }

                        if (Vim && typeof Vim.noremap === 'function') {
                            // go -> gg (go to top of document)
                            Vim.noremap('go', 'gg', 'normal');
                            Vim.noremap('go', 'gg', 'visual');

                            // Define actions for zz, zt, zb if they are missing
                            if (typeof Vim.defineAction === 'function' && typeof Vim.mapCommand === 'function') {
                                Vim.defineAction('scrollToCenter', (cm) => {
                                    if (typeof cm.moveCurrentLineTo === 'function') {
                                        cm.moveCurrentLineTo('center');
                                    }
                                });
                                Vim.defineAction('scrollToTop', (cm) => {
                                    if (typeof cm.moveCurrentLineTo === 'function') {
                                        cm.moveCurrentLineTo('top');
                                    }
                                });
                                Vim.defineAction('scrollToBottom', (cm) => {
                                    if (typeof cm.moveCurrentLineTo === 'function') {
                                        cm.moveCurrentLineTo('bottom');
                                    }
                                });
                            Vim.mapCommand('zz', 'action', 'scrollToCenter');
                                Vim.mapCommand('zt', 'action', 'scrollToTop');
                                Vim.mapCommand('zb', 'action', 'scrollToBottom');
                                console.log("[Native Space] Vim custom scroll mappings applied: zz, zt, zb");
                            }
                            const getAdjustedLineCount = (cm) => {
                                const count = cm.lineCount();
                                if (count > 1 && cm.getLine(count - 1) === '') {
                                    return count - 1;
                                }
                                return count;
                            };

                             // Define custom normal command `:normal` / `:norm`
                             if (typeof Vim.defineEx === 'function') {
                                 Vim.defineEx('normal', 'norm', function(cm, params) {
                                     if (!params.argString) return;
                                     
                                     // Parse key sequence
                                     const keys = [];
                                     let i = 0;
                                     const arg = params.argString;
                                     while (i < arg.length) {
                                         if (arg[i] === '<') {
                                             const endIdx = arg.indexOf('>', i);
                                             if (endIdx !== -1) {
                                                 keys.push(arg.slice(i, endIdx + 1));
                                                 i = endIdx + 1;
                                                 continue;
                                             }
                                         }
                                         keys.push(arg[i]);
                                         i++;
                                     }
                                     
                                     const executeKey = (cm, key) => {
                                          const vimState = (cm && cm.state) ? cm.state.vim : null;
                                          if (vimState && vimState.insertMode) {
                                              if (key === '<Esc>' || key === '<C-[>') {
                                                  Vim.handleKey(cm, key);
                                              } else if (key === '<Enter>' || key === '<CR>') {
                                                  const cur = typeof cm.getCursor === 'function' ? cm.getCursor() : { line: 0, ch: 0 };
                                                  cm.replaceRange('\n', cur);
                                                  cm.setCursor({ line: cur.line + 1, ch: 0 });
                                              } else if (key === '<Tab>') {
                                                  cm.replaceRange('\t', typeof cm.getCursor === 'function' ? cm.getCursor() : { line: 0, ch: 0 });
                                              } else if (key === '<BS>' || key === '<Backspace>') {
                                                  const cur = typeof cm.getCursor === 'function' ? cm.getCursor() : { line: 0, ch: 0 };
                                                  if (cur.ch > 0) {
                                                      cm.replaceRange('', { line: cur.line, ch: cur.ch - 1 }, cur);
                                                  }
                                              } else if (key.startsWith('<') && key.endsWith('>')) {
                                                  // Ignore other special control characters in insert mode
                                              } else {
                                                  cm.replaceRange(key, typeof cm.getCursor === 'function' ? cm.getCursor() : { line: 0, ch: 0 });
                                              }
                                          } else {
                                              Vim.handleKey(cm, key);
                                          }
                                      };
                                      
                                      const startLine = params.line !== undefined ? params.line : (typeof cm.getCursor === 'function' ? cm.getCursor().line : 0);
                                      const endLine = params.lineEnd !== undefined ? params.lineEnd : startLine;
                                      
                                      cm.operation(() => {
                                          const origCursor = typeof cm.getCursor === 'function' ? cm.getCursor() : { line: 0, ch: 0 };
                                          for (let line = startLine; line <= endLine; line++) {
                                              cm.setCursor({ line: line, ch: 0 });
                                              for (const key of keys) {
                                                  executeKey(cm, key);
                                              }
                                              if (cm.state && cm.state.vim && cm.state.vim.insertMode) {
                                                  Vim.handleKey(cm, '<Esc>');
                                              }
                                          }
                                          if (params.lineStart === undefined) {
                                              cm.setCursor(origCursor);
                                         }
                                     });
                                });

                                // Define custom `:global` / `:g` command
                                Vim.defineEx('global', 'g', function(cm, params) {
                                    if (!params.argString) return;
                                    const delimiter = params.argString[0];
                                    const parts = params.argString.split(delimiter);
                                    if (parts.length < 3) return;
                                    const patternStr = parts[1];
                                    const cmdStr = parts.slice(2).join(delimiter);
                                    
                                    let pattern;
                                    try {
                                        pattern = new RegExp(patternStr);
                                    } catch (e) {
                                        console.error("Invalid regex in :global:", e);
                                        return;
                                    }
                                    
                                    const startLine = params.line !== undefined ? params.line : 0;
                                    const endLine = params.lineEnd !== undefined ? params.lineEnd : (params.line !== undefined ? params.line : getAdjustedLineCount(cm) - 1);
                                    const matchedLines = [];
                                    for (let line = startLine; line <= endLine; line++) {
                                        if (pattern.test(cm.getLine(line))) {
                                            matchedLines.push(line);
                                        }
                                    }
                                    
                                    cm.operation(() => {
                                        for (let idx = matchedLines.length - 1; idx >= 0; idx--) {
                                            const line = matchedLines[idx];
                                            cm.setCursor({ line: line, ch: 0 });
                                            if (typeof Vim.handleEx === 'function') {
                                                Vim.handleEx(cm, cmdStr);
                                            }
                                        }
                                    });
                                });

                                // Define custom `:vglobal` / `:v` command
                                Vim.defineEx('vglobal', 'v', function(cm, params) {
                                    if (!params.argString) return;
                                    const delimiter = params.argString[0];
                                    const parts = params.argString.split(delimiter);
                                    if (parts.length < 3) return;
                                    const patternStr = parts[1];
                                    const cmdStr = parts.slice(2).join(delimiter);
                                    
                                    let pattern;
                                    try {
                                        pattern = new RegExp(patternStr);
                                    } catch (e) {
                                        console.error("Invalid regex in :vglobal:", e);
                                        return;
                                    }
                                    
                                    const startLine = params.line !== undefined ? params.line : 0;
                                    const endLine = params.lineEnd !== undefined ? params.lineEnd : (params.line !== undefined ? params.line : getAdjustedLineCount(cm) - 1);
                                    const matchedLines = [];
                                    for (let line = startLine; line <= endLine; line++) {
                                        if (!pattern.test(cm.getLine(line))) {
                                            matchedLines.push(line);
                                        }
                                    }
                                    
                                    cm.operation(() => {
                                        for (let idx = matchedLines.length - 1; idx >= 0; idx--) {
                                            const line = matchedLines[idx];
                                            cm.setCursor({ line: line, ch: 0 });
                                            if (typeof Vim.handleEx === 'function') {
                                                Vim.handleEx(cm, cmdStr);
                                            }
                                        }
                                    });
                                });

                                  // Define custom `:copy` / `:co` command
                                  Vim.defineEx('copy', 'co', function(cm, params) {
                                      let destStr = params.argString ? params.argString.trim() : '';
                                      if (!destStr) return;
                                      
                                      const startLine = params.line !== undefined ? params.line : (typeof cm.getCursor === 'function' ? cm.getCursor().line : 0);
                                      const endLine = params.lineEnd !== undefined ? params.lineEnd : startLine;
                                      
                                      let destLine;
                                      if (destStr === '$') {
                                          destLine = getAdjustedLineCount(cm);
                                      } else {
                                          destLine = parseInt(destStr, 10);
                                          if (isNaN(destLine)) return;
                                      }
                                      
                                      destLine = Math.max(0, Math.min(getAdjustedLineCount(cm), destLine));
                                      
                                      const allLines = [];
                                      for (let i = 0; i < cm.lineCount(); i++) {
                                          allLines.push(cm.getLine(i));
                                      }
                                      
                                      const linesToCopy = allLines.slice(startLine, endLine + 1);
                                      allLines.splice(destLine, 0, ...linesToCopy);
                                      
                                      cm.operation(() => {
                                          console.log("[Vim Injector] Running custom :copy range:", startLine, "to", endLine, "destLine:", destLine);
                                          const lastLineIdx = cm.lineCount() - 1;
                                          const lastLineLen = cm.getLine(lastLineIdx).length;
                                          cm.replaceRange(allLines.join('\n'), { line: 0, ch: 0 }, { line: lastLineIdx, ch: lastLineLen });
                                          const finalTargetLine = destLine + (endLine - startLine);
                                          cm.setCursor({ line: finalTargetLine, ch: 0 });
                                      });
                                  });

                                  // Define custom `:t` command (alias for :copy)
                                  Vim.defineEx('t', 't', function(cm, params) {
                                      if (typeof Vim.handleEx === 'function') {
                                          let rangeStr = '';
                                          if (params.line !== undefined && params.lineEnd !== undefined) {
                                              rangeStr = `${params.line + 1},${params.lineEnd + 1}`;
                                          } else if (params.line !== undefined) {
                                              rangeStr = `${params.line + 1}`;
                                          }
                                          Vim.handleEx(cm, `${rangeStr}co ${params.argString}`);
                                      }
                                  });

                                  // Define custom `:move` / `:m` command
                                  Vim.defineEx('move', 'm', function(cm, params) {
                                      let destStr = params.argString ? params.argString.trim() : '';
                                      if (!destStr) return;
                                      
                                      const startLine = params.line !== undefined ? params.line : (typeof cm.getCursor === 'function' ? cm.getCursor().line : 0);
                                      const endLine = params.lineEnd !== undefined ? params.lineEnd : startLine;
                                      
                                      let destLine;
                                      if (destStr === '$') {
                                          destLine = getAdjustedLineCount(cm);
                                      } else {
                                          destLine = parseInt(destStr, 10);
                                          if (isNaN(destLine)) return;
                                      }
                                      
                                      destLine = Math.max(0, Math.min(getAdjustedLineCount(cm), destLine));
                                      if (destLine >= startLine && destLine <= endLine + 1) return;
                                      
                                      const allLines = [];
                                      for (let i = 0; i < cm.lineCount(); i++) {
                                          allLines.push(cm.getLine(i));
                                      }
                                      
                                      const linesToMove = allLines.slice(startLine, endLine + 1);
                                      allLines.splice(startLine, endLine - startLine + 1);
                                      
                                      let adjustedDest = destLine;
                                      if (destLine > endLine) {
                                          adjustedDest -= (endLine - startLine + 1);
                                      }
                                      
                                      allLines.splice(adjustedDest, 0, ...linesToMove);
                                      
                                      cm.operation(() => {
                                          console.log("[Vim Injector] Running custom :move range:", startLine, "to", endLine, "destLine:", destLine, "adjustedDest:", adjustedDest);
                                          const lastLineIdx = cm.lineCount() - 1;
                                          const lastLineLen = cm.getLine(lastLineIdx).length;
                                          cm.replaceRange(allLines.join('\n'), { line: 0, ch: 0 }, { line: lastLineIdx, ch: lastLineLen });
                                          const finalTargetLine = adjustedDest + (endLine - startLine);
                                          cm.setCursor({ line: finalTargetLine, ch: 0 });
                                      });
                                  });

                                // Define custom `:registers` / `:reg` command
                                Vim.defineEx('registers', 'reg', function(cm, params) {
                                    try {
                                        const globalState = Vim.getVimGlobalState_();
                                        if (!globalState || !globalState.registerController) return;
                                        const registers = globalState.registerController.registers;
                                        const lines = ['--- Registers ---'];
                                        for (let key in registers) {
                                            const reg = registers[key];
                                            if (reg && reg.toString()) {
                                                let val = reg.toString();
                                                if (val.length > 50) val = val.slice(0, 47) + '...';
                                                lines.push(`"${key}   ${val.replace(/\n/g, '\\n')}`);
                                            }
                                        }
                                        if (lines.length === 1) {
                                            lines.push('(no registers populated)');
                                        }
                                        showStatusBarMessage(lines.join('\n'));
                                    } catch (e) {
                                        console.error("Failed to inspect registers:", e);
                                    }
                                });

                                 Vim.defineEx('sort', 'sort', function(cm, params) {
                                     const startLine = params.line !== undefined ? params.line : 0;
                                     const endLine = params.lineEnd !== undefined ? params.lineEnd : (params.line !== undefined ? params.line : cm.lineCount() - 1);
                                     
                                     const lines = [];
                                     for (let l = startLine; l <= endLine; l++) {
                                         lines.push(cm.getLine(l));
                                     }
                                     
                                     let reverse = false;
                                     if (params.force || (params.argString && params.argString.includes('!'))) {
                                         reverse = true;
                                     }
                                     
                                     lines.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
                                     if (reverse) {
                                         lines.reverse();
                                     }
                                     
                                     if (typeof cm.operation === 'function') {
                                         cm.operation(() => {
                                             for (let l = startLine; l <= endLine; l++) {
                                                 const lineContent = cm.getLine(l);
                                                 if (typeof cm.replaceRange === 'function') {
                                                     cm.replaceRange(lines[l - startLine], { line: l, ch: 0 }, { line: l, ch: lineContent.length });
                                                 }
                                             }
                                         });
                                     } else {
                                         for (let l = startLine; l <= endLine; l++) {
                                             const lineContent = cm.getLine(l);
                                             if (typeof cm.replaceRange === 'function') {
                                                 cm.replaceRange(lines[l - startLine], { line: l, ch: 0 }, { line: l, ch: lineContent.length });
                                             }
                                         }
                                     }
                                 });

                                // Define custom `:write` / `:w` command to compile and run in MakeCode
                                Vim.defineEx('write', 'w', function(cm, params) {
                                    compileAndRunMakeCode();
                                });

                                // Define custom `:bnext` / `:bn` command to switch to next file buffer
                                Vim.defineEx('bnext', 'bn', function(cm, params) {
                                    switchBuffer(1);
                                });

                                // Define custom `:bprev` / `:bp` command to switch to previous file buffer
                                Vim.defineEx('bprev', 'bp', function(cm, params) {
                                    switchBuffer(-1);
                                });

                                // Define custom `:edit` / `:e` command to open/switch file buffer by name
                                Vim.defineEx('edit', 'e', function(cm, params) {
                                    if (params.argString) {
                                        openFileBuffer(params.argString.trim());
                                    } else {
                                        showStatusBarMessage("Error: filename required");
                                    }
                                });

                                // Define custom `:simulator` / `:sim` command to toggle simulator panel
                                Vim.defineEx('simulator', 'sim', function(cm, params) {
                                    toggleSimulator();
                                });

                                 // Define custom `:explorer` / `:exp` command to toggle explorer panel
                                 Vim.defineEx('explorer', 'exp', function(cm, params) {
                                     toggleExplorer();
                                 });

                                 // Define custom `:hover` / `:hov` command to trigger Monaco hover
                                 Vim.defineEx('hover', 'hov', function(cm, params) {
                                     const activePaneIndex = window._vimSplits ? window._vimSplits.activePaneIndex : 0;
                                     const activeEditor = window._vimSplits && window._vimSplits.panes[activePaneIndex]
                                         ? window._vimSplits.panes[activePaneIndex].editor
                                         : window.editor;
                                     if (activeEditor) {
                                         activeEditor.trigger('keyboard', 'editor.action.showHover', null);
                                     }
                                 });

                                 // Define custom `:set` / `:se` command to configure settings
                                 Vim.defineEx('set', 'se', function(cm, params) {
                                     if (!window._vimSettings) return;
                                     const args = params.argString ? params.argString.trim().split(/\s+/) : [];
                                     if (args.length === 0 || (args.length === 1 && args[0] === "")) {
                                         showStatusBarMessage(`${window._vimSettings.nu ? "number" : "nonumber"} ${window._vimSettings.rnu ? "relativenumber" : "norelativenumber"} ${window._vimSettings.reup ? "reup" : "noreup"} leader=${window._vimSettings.leader || "<Space>"}`);
                                         return;
                                     }
                                     
                                     args.forEach(arg => {
                                         const clean = arg.trim();
                                         if (clean === 'number' || clean === 'nu') {
                                             window._vimSettings.nu = true;
                                         } else if (clean === 'nonumber' || clean === 'nonu') {
                                             window._vimSettings.nu = false;
                                         } else if (clean === 'relativenumber' || clean === 'rnu') {
                                             window._vimSettings.rnu = true;
                                         } else if (clean === 'norelativenumber' || clean === 'nornu') {
                                             window._vimSettings.rnu = false;
                                         } else if (clean === 'reup') {
                                             window._vimSettings.reup = true;
                                             showStatusBarMessage("reup (auto-compile on insert leave) enabled");
                                         } else if (clean === 'noreup') {
                                             window._vimSettings.reup = false;
                                             showStatusBarMessage("reup (auto-compile on insert leave) disabled");
                                         } else if (clean.startsWith('leader=')) {
                                             const val = clean.split('=')[1];
                                             if (val) {
                                                 window._vimSettings.leader = val;
                                                 applyVimLeaderKey();
                                                 showStatusBarMessage("leader option set to: " + val);
                                             }
                                         } else {
                                             showStatusBarMessage("Unknown option: " + clean);
                                         }
                                     });
                                     
                                     // Update all active editors
                                     if (window._vimSplits && window._vimSplits.panes) {
                                         window._vimSplits.panes.forEach(pane => {
                                             updateEditorLineNumbers(pane.editor);
                                         });
                                     } else {
                                         updateEditorLineNumbers(cm.editor || window.editor);
                                     }
                                  });

                                 // Define custom split-screen Ex commands
                                 Vim.defineEx('vsplit', 'vsp', function(cm, params) {
                                     createSplitPane('vertical');
                                     if (params.argString) {
                                         setTimeout(() => {
                                             if (window.editor) openFileBuffer(params.argString.trim());
                                         }, 100);
                                     }
                                 });

                                 Vim.defineEx('split', 'sp', function(cm, params) {
                                     createSplitPane('horizontal');
                                     if (params.argString) {
                                         setTimeout(() => {
                                             if (window.editor) openFileBuffer(params.argString.trim());
                                         }, 100);
                                     }
                                 });

                                 Vim.defineEx('only', 'on', function(cm, params) {
                                     onlyKeepCurrentPane();
                                 });

                                 Vim.defineEx('close', 'clo', function(cm, params) {
                                     closeSplitPane(window._vimSplits.activePaneIndex);
                                 });

                                 Vim.defineEx('quit', 'q', function(cm, params) {
                                     if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                                         closeSplitPane(window._vimSplits.activePaneIndex);
                                     } else {
                                         showStatusBarMessage("Only one window open. Use browser tab to exit.");
                                     }
                                 });
                                  Vim.defineEx('delmarks', 'delm', function(cm, params) {
                                      if (!params.argString) {
                                          showStatusBarMessage("Error: Argument required for :delmarks");
                                          return;
                                      }
                                      const args = params.argString.trim();
                                      if (args === '!') {
                                          window._globalVimMarks = {};
                                          showStatusBarMessage("All global marks cleared");
                                      } else {
                                          for (let i = 0; i < args.length; i++) {
                                              const mark = args[i];
                                              if (window._globalVimMarks) {
                                                  delete window._globalVimMarks[mark];
                                              }
                                          }
                                          showStatusBarMessage(`Global marks cleared: ${args}`);
                                      }
                                  });
                                 const executeResize = (arg) => {
                                     if (!window._vimSplits || window._vimSplits.panes.length < 2) {
                                         showStatusBarMessage("No split panes to resize");
                                         return;
                                     }
                                     if (!arg) {
                                         window._vimSplits.splitRatio = 0.5;
                                         applySplitsLayout();
                                         showStatusBarMessage("Windows equalized");
                                         return;
                                     }
                                     
                                     let amount = parseFloat(arg);
                                     if (isNaN(amount)) {
                                         showStatusBarMessage("Invalid resize amount: " + arg);
                                         return;
                                     }
                                     
                                     let isRelative = arg.startsWith('+') || arg.startsWith('-');
                                     let ratio = window._vimSplits.splitRatio || 0.5;
                                     
                                     if (isRelative) {
                                         const change = (amount / 100) * (window._vimSplits.activePaneIndex === 0 ? 1 : -1);
                                         ratio = Math.max(0.1, Math.min(0.9, ratio + change));
                                     } else {
                                         ratio = Math.max(0.1, Math.min(0.9, amount / 100));
                                     }
                                     
                                     window._vimSplits.splitRatio = ratio;
                                     applySplitsLayout();
                                     showStatusBarMessage(`Window resized: ${Math.round(ratio * 100)}% / ${Math.round((1 - ratio) * 100)}%`);
                                 };

                                 Vim.defineEx('resize', 'res', function(cm, params) {
                                     executeResize(params.argString ? params.argString.trim() : '');
                                 });

                                 Vim.defineEx('vresize', 'vres', function(cm, params) {
                                     executeResize(params.argString ? params.argString.trim() : '');
                                 });

                                 Vim.defineEx('vertical', 'vert', function(cm, params) {
                                     const arg = params.argString ? params.argString.trim() : '';
                                     if (arg.startsWith('resize') || arg.startsWith('res')) {
                                         const resizeArg = arg.replace(/^(resize|res)\s*/, '');
                                         executeResize(resizeArg);
                                     } else {
                                         showStatusBarMessage("Unsupported vertical modifier command: " + arg);
                                     }
                                 });

                                 // Define custom actions for window navigation (Ctrl-W commands)
                                 Vim.defineAction('cycleWindowFocus', (cm) => {
                                     if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                                         const nextIndex = (window._vimSplits.activePaneIndex + 1) % 2;
                                         window._vimSplits.panes[nextIndex].editor.focus();
                                     }
                                 });
                                 Vim.defineAction('focusLeftOrTopWindow', (cm) => {
                                     if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                                         window._vimSplits.panes[0].editor.focus();
                                     }
                                 });
                                 Vim.defineAction('focusRightOrBottomWindow', (cm) => {
                                     if (window._vimSplits && window._vimSplits.panes.length >= 2) {
                                         window._vimSplits.panes[1].editor.focus();
                                     }
                                 });

                                 Vim.mapCommand('<C-w>w', 'action', 'cycleWindowFocus', {}, { context: 'normal' });
                                 Vim.mapCommand('<C-w><C-w>', 'action', 'cycleWindowFocus', {}, { context: 'normal' });
                                 Vim.mapCommand('<C-w>h', 'action', 'focusLeftOrTopWindow', {}, { context: 'normal' });
                                 Vim.mapCommand('<C-w>k', 'action', 'focusLeftOrTopWindow', {}, { context: 'normal' });
                                 Vim.mapCommand('<C-w>l', 'action', 'focusRightOrBottomWindow', {}, { context: 'normal' });
                                 Vim.mapCommand('<C-w>j', 'action', 'focusRightOrBottomWindow', {}, { context: 'normal' });

                                // Define custom actions and mappings for [d and ]d diagnostic jumps
                                Vim.defineAction('goToPrevDiagnostic', (cm) => {
                                    jumpToDiagnostic(cm.editor, -1);
                                });
                                Vim.defineAction('goToNextDiagnostic', (cm) => {
                                    jumpToDiagnostic(cm.editor, 1);
                                });
                                Vim.mapCommand('[d', 'action', 'goToPrevDiagnostic', {}, { context: 'normal' });
                                Vim.mapCommand(']d', 'action', 'goToNextDiagnostic', {}, { context: 'normal' });

                                Vim.defineAction('toggleMessagePanel', (cm) => {
                                    const msgArea = document.getElementById('neovim-message-area');
                                    const rawOutput = document.getElementById('vim-raw-output');
                                    if (msgArea && msgArea.style.display !== 'none') {
                                        const isExpanded = msgArea.style.whiteSpace === 'pre-wrap';
                                        if (isExpanded) {
                                            msgArea.style.whiteSpace = 'nowrap';
                                            msgArea.style.overflow = 'hidden';
                                            msgArea.style.textOverflow = 'ellipsis';
                                            msgArea.style.paddingTop = '0px';
                                            msgArea.style.paddingBottom = '0px';
                                            window._isMessageExpanded = false;
                                        } else {
                                            msgArea.style.whiteSpace = 'pre-wrap';
                                            msgArea.style.overflow = 'visible';
                                            msgArea.style.textOverflow = 'clip';
                                            msgArea.style.paddingTop = '8px';
                                            msgArea.style.paddingBottom = '8px';
                                            window._isMessageExpanded = true;
                                        }
                                    }
                                });
                                Vim.mapCommand('gm', 'action', 'toggleMessagePanel', {}, { context: 'normal' });

                                 // Override character find/till motions to prevent inclusive offset single-char deletion on search failure
                                 Vim.defineMotion('moveToCharacter', function(cm, head, motionArgs) {
                                     const line = head.line;
                                     const ch = head.ch;
                                     const lineText = cm.getLine(line);
                                     const character = motionArgs.selectedCharacter;
                                     if (!character) return head;
                                     
                                     let targetCh = -1;
                                     const repeat = motionArgs.repeat || 1;
                                     
                                     if (motionArgs.forward) {
                                         let start = ch + 1;
                                         for (let r = 0; r < repeat; r++) {
                                             const idx = lineText.indexOf(character, start);
                                             if (idx === -1) {
                                                 targetCh = -1;
                                                 break;
                                             }
                                             targetCh = idx;
                                             start = idx + 1;
                                         }
                                     } else {
                                         let start = ch - 1;
                                         for (let r = 0; r < repeat; r++) {
                                             const idx = lineText.lastIndexOf(character, start);
                                             if (idx === -1) {
                                                 targetCh = -1;
                                                 break;
                                             }
                                             targetCh = idx;
                                             start = idx - 1;
                                         }
                                     }
                                     
                                     if (targetCh !== -1) {
                                         return { line: line, ch: targetCh };
                                     } else {
                                         motionArgs.inclusive = false;
                                         return head;
                                     }
                                 });

                                 Vim.defineMotion('moveTillCharacter', function(cm, head, motionArgs) {
                                     const line = head.line;
                                     const ch = head.ch;
                                     const lineText = cm.getLine(line);
                                     const character = motionArgs.selectedCharacter;
                                     if (!character) return head;
                                     
                                     let targetCh = -1;
                                     const repeat = motionArgs.repeat || 1;
                                     
                                     if (motionArgs.forward) {
                                         let start = ch + 1;
                                         for (let r = 0; r < repeat; r++) {
                                             const idx = lineText.indexOf(character, start);
                                             if (idx === -1) {
                                                 targetCh = -1;
                                                 break;
                                             }
                                             targetCh = idx;
                                             start = idx + 1;
                                         }
                                         if (targetCh !== -1) {
                                             targetCh = targetCh - 1;
                                         }
                                     } else {
                                         let start = ch - 1;
                                         for (let r = 0; r < repeat; r++) {
                                             const idx = lineText.lastIndexOf(character, start);
                                             if (idx === -1) {
                                                 targetCh = -1;
                                                 break;
                                             }
                                             targetCh = idx;
                                             start = idx - 1;
                                         }
                                         if (targetCh !== -1) {
                                             targetCh = targetCh + 1;
                                         }
                                     }
                                     
                                     if (targetCh !== -1) {
                                         return { line: line, ch: targetCh };
                                     } else {
                                         motionArgs.inclusive = false;
                                         return head;
                                     }
                                 });

                                 console.log("[Native Space] Vim custom Ex commands applied: :normal, :global, :vglobal, :copy, :move, :registers, :sort, :w, :bn, :bp, :e, :sim, :exp, :set");
                            }

                            console.log("[Native Space] Vim custom mappings applied: go -> gg");
                        } else {
                            console.warn("[Native Space] Vim object or noremap function not found on MonacoVim.");
                        }
                    } catch (e) {
                        console.error("[Native Space] Failed to register custom Vim mappings:", e);
                    }

                    // Define browser console QA dev tests
                    window.__runVimTests = async () => {
                        console.log("%c[Vim QA Suite] Starting in-browser verification...", "font-weight: bold; color: #3b82f6;");
                        let passCount = 0;
                        let failCount = 0;

                        const assert = (name, cond) => {
                            if (cond) {
                                console.log(`%c✔ PASS: ${name}`, "color: #10b981;");
                                passCount++;
                            } else {
                                console.error(`❌ FAIL: ${name}`);
                                failCount++;
                            }
                        };

                        try {
                            assert("Vim is initialized and bound to Monaco", !!activeVimInstance);
                            const Vim = (window.MonacoVim.VimMode && window.MonacoVim.VimMode.Vim) || window.MonacoVim.Vim;
                            const globalState = Vim.getVimGlobalState_();
                            assert("Global Vim state exists", !!globalState);
                            assert("lastInsertModeChanges is patched", globalState.macroModeState.lastInsertModeChanges._isPatched);
                            assert("Global integration state exists", !!window._vimIntegrationState);
                            
                            window._vimIntegrationState.justTyped = true;
                            globalState.macroModeState.lastInsertModeChanges.maybeReset = true;
                            assert("maybeReset is blocked while typing", globalState.macroModeState.lastInsertModeChanges.maybeReset === false);
                            
                            window._vimIntegrationState.justTyped = false;
                            globalState.macroModeState.lastInsertModeChanges.maybeReset = true;
                            assert("maybeReset is allowed when typing inactive", globalState.macroModeState.lastInsertModeChanges.maybeReset === true);

                            console.log(`%c[Vim QA Suite] Completed: ${passCount} passed, ${failCount} failed.`, `font-weight: bold; color: ${failCount === 0 ? '#10b981' : '#ef4444'};`);
                            return { pass: failCount === 0, passCount, failCount };
                        } catch (err) {
                            console.error("[Vim QA Suite] Test suite crashed:", err);
                            return { pass: false, error: err.message };
                        }
                    };
                }
            }, 100);
            setTimeout(() => clearInterval(checkReady), 10000);
        }

        function findEditorInstance() {
            if (window.editor && typeof window.editor.getModel === 'function') {
                return window.editor;
            }
            const monacoDiv = document.querySelector('.monaco-editor');
            if (!monacoDiv) return null;
            
            const parent = monacoDiv.parentNode;
            if (!parent) return null;
            
            const fiberKey = Object.keys(parent).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
            if (!fiberKey) return null;
            
            let fiber = parent[fiberKey];
            while (fiber) {
                if (fiber.stateNode && fiber.stateNode.constructor && fiber.stateNode.constructor.name === 'Te') {
                    const te = fiber.stateNode;
                    if (te.editor && typeof te.editor.getModel === 'function') {
                        return te.editor;
                    }
                    if (te.textEditor) {
                        if (typeof te.textEditor.getModel === 'function') {
                            return te.textEditor;
                        }
                        if (te.textEditor.editor && typeof te.textEditor.editor.getModel === 'function') {
                            return te.textEditor.editor;
                        }
                    }
                }
                fiber = fiber.return;
            }
            return null;
        }

        const tryImmediateInit = () => {
            if (window.monaco && window.monaco.editor) {
                // Monkeypatch creator if not yet patched
                if (window.monaco.editor.create && !window.monaco.editor.create._isPatched) {
                    const originalCreate = window.monaco.editor.create;
                    window.monaco.editor.create = function(...createArgs) {
                        const editor = originalCreate.apply(this, createArgs);
                        bindVimToEditor(editor);
                        return editor;
                    };
                    window.monaco.editor.create._isPatched = true;
                }
                
                // Bind to active editor
                const editor = findEditorInstance();
                if (editor) {
                    injectVimLibrary();
                    console.log("[Native Space] Monaco loaded, active editor found. Initializing immediately...");
                    if (!editor._vimBound) {
                        bindVimToEditor(editor);
                        editor._vimBound = true;
                    }
                    return true;
                }
            }
            return false;
        };

        const tryAmdInit = () => {
            if (typeof window.require === 'function') {
                try {
                    window.require(['vs/editor/editor.main'], function(monacoAPI) {
                        if (monacoAPI && monacoAPI.editor) {
                            window.monaco = monacoAPI;
                        }
                    });
                } catch (e) {
                    // Silent catch
                }
            }
        };

        // Continuous check for existing editors in case of timing/React mounting delays on live site
        let bindAttempts = 0;
        const autoBindInterval = setInterval(() => {
            bindAttempts++;
            if (!window.monaco) {
                tryAmdInit();
            }
            const success = tryImmediateInit();
            if (success || bindAttempts > 30) {
                clearInterval(autoBindInterval);
            }
        }, 500);

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
                                monacoAPI.editor.create._isPatched = true;
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
        if (typeof module !== 'undefined' && module.exports) {
            module.exports.setupEmacsInsertKeys = setupEmacsInsertKeys;
            module.exports.bindVimToEditor = bindVimToEditor;
            module.exports.showStatusBarMessage = showStatusBarMessage;
            module.exports.updateDiagnosticsSummary = updateDiagnosticsSummary;
            module.exports.updateFileNameSegment = updateFileNameSegment;
        }
    }

    const logicScriptEl = document.createElement('script');
    logicScriptEl.textContent = `(${nativePageExecution.toString()})();`;
    if (document.documentElement) {
        document.documentElement.appendChild(logicScriptEl);
    } else {
        const checkDoc = setInterval(() => {
            if (document.documentElement) {
                clearInterval(checkDoc);
                document.documentElement.appendChild(logicScriptEl);
            }
        }, 5);
    }

    // Export for Node.js testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { nativePageExecution };
    }
})();
