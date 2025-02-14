(() => {
    // Constants
    const DELIMITERS = {
        DISPLAY_DOLLARS: { start: '$$', end: '$$', display: true },
        INLINE_DOLLARS: { start: '$', end: '$', display: false },
        DISPLAY_BRACKETS: { start: '\\[', end: '\\]', display: true },
        INLINE_PARENS: { start: '\\(', end: '\\)', display: false },
    };

    // State management
    let state = {
        teXZillaLoaded: false,
    };

    // Debug utility function
    function debugLog(message, data = null) {
        console.log(`[LaTeX Debug] ${message}`, data || '');
    }

    async function loadTeXZilla() {
        if (state.teXZillaLoaded) return;
        debugLog('Loading TeXZilla...');

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://fred-wang.github.io/TeXZilla/TeXZilla-min.js';
            script.onload = () => {
                state.teXZillaLoaded = true;
                debugLog('TeXZilla loaded successfully');
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function injectStyles() {
        const styles = document.createElement('style');
        styles.textContent = `
            .math-container {
                display: inline-block;
                vertical-align: middle;
                text-align: left;
            }
            .math-container[data-display="block"] {
                display: block;
                margin: 0.2em 0;
                text-align: center;
            }
            .math-container math {
                vertical-align: 0.5ex;
            }
            .math-processed { /* Marker class */ }
            .math-processed-wrapper {
                display: inline;
                text-align: left;
            }
        `;
        document.head.appendChild(styles);
        debugLog('Styles injected');
    }

    function isInCodeBlock(element) {
        let parent = element;
        while (parent) {
            if (parent.tagName === 'PRE' || parent.tagName === 'CODE') {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    function convertToMathML(latex, isDisplay) {
        debugLog('Converting to MathML:', { latex, isDisplay });
        try {
            const mathML = TeXZilla.toMathML(latex, isDisplay);
            return new XMLSerializer().serializeToString(mathML);
        } catch (e) {
            console.error('TeXZilla conversion error:', e);
            return null;
        }
    }
    function getAdjacentTextNodes(node) {
        debugLog('Getting adjacent text nodes');
        const nodes = [];
        let current = node;
        let text = '';

        // Collect preceding text content
        while (current && current.previousSibling) {
            current = current.previousSibling;
            if (current.nodeType === Node.TEXT_NODE) {
                text = current.textContent + text;
                nodes.unshift({
                    type: 'text',
                    content: current.textContent,
                    node: current,
                });
            } else if (
                current.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.tagName)
            ) {
                text = '\n' + text;
                nodes.unshift({
                    type: 'newline',
                    node: current,
                });
            }
        }

        // Add current node
        text += node.textContent;
        nodes.push({
            type: 'text',
            content: node.textContent,
            node: node,
        });

        // Collect following text content
        current = node;
        while (current && current.nextSibling) {
            current = current.nextSibling;
            if (current.nodeType === Node.TEXT_NODE) {
                text += current.textContent;
                nodes.push({
                    type: 'text',
                    content: current.textContent,
                    node: current,
                });
            } else if (
                current.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.tagName)
            ) {
                text += '\n';
                nodes.push({
                    type: 'newline',
                    node: current,
                });
            }
        }

        debugLog('Combined text:', text);
        return {
            nodes: nodes,
            combinedText: text,
        };
    }

    function normalizeDelimiterText(text) {
        // Preserve backslashes at line endings and normalize newlines
        return text.replace(/\\\r?\n\s*/g, '\\').replace(/\r?\n\s*/g, ' ');
    }

    function findMatchingDelimiter(text, startPos) {
        debugLog('Finding delimiter at position:', startPos);

        // Normalize text while preserving backslash delimiters
        const normalizedText = normalizeDelimiterText(text);
        debugLog('Normalized text:', normalizedText);

        // Handle backslash delimiters first
        if (normalizedText[startPos] === '\\') {
            // Check for display brackets \[...\]
            if (normalizedText.substring(startPos).startsWith('\\[')) {
                let pos = startPos + 2;
                let bracketCount = 1;
                while (pos < normalizedText.length) {
                    if (
                        normalizedText.substring(pos).startsWith('\\]') &&
                        !normalizedText[pos - 1] === '\\'
                    ) {
                        return {
                            start: startPos,
                            end: text.indexOf('\\]', startPos + 2) + 2,
                            delimiter: DELIMITERS.DISPLAY_BRACKETS,
                            isBackslash: true,
                        };
                    }
                    pos++;
                }
            }

            // Check for inline parentheses \(...\)
            if (normalizedText.substring(startPos).startsWith('\\(')) {
                let pos = startPos + 2;
                let parenCount = 1;
                while (pos < normalizedText.length) {
                    if (
                        normalizedText.substring(pos).startsWith('\\)') &&
                        !normalizedText[pos - 1] === '\\'
                    ) {
                        return {
                            start: startPos,
                            end: text.indexOf('\\)', startPos + 2) + 2,
                            delimiter: DELIMITERS.INLINE_PARENS,
                            isBackslash: true,
                        };
                    }
                    pos++;
                }
            }
        }

        // Handle dollar delimiters
        if (normalizedText.startsWith('$$', startPos)) {
            const endPos = normalizedText.indexOf('$$', startPos + 2);
            if (endPos !== -1) {
                return {
                    start: startPos,
                    end: text.indexOf('$$', startPos + 2) + 2,
                    delimiter: DELIMITERS.DISPLAY_DOLLARS,
                    isBackslash: false,
                };
            }
        }

        if (normalizedText[startPos] === '$') {
            let pos = startPos + 1;
            while (pos < normalizedText.length) {
                if (
                    normalizedText[pos] === '$' &&
                    normalizedText[pos - 1] !== '\\'
                ) {
                    return {
                        start: startPos,
                        end: text.indexOf('$', startPos + 1) + 1,
                        delimiter: DELIMITERS.INLINE_DOLLARS,
                        isBackslash: false,
                    };
                }
                pos++;
            }
        }

        return null;
    }

    function findMathDelimiters(text) {
        debugLog('Finding math delimiters in text');
        const segments = [];
        let pos = 0;
        let lastPos = 0;

        while (pos < text.length) {
            let found = false;

            if (
                (text[pos] === '$' || text[pos] === '\\') &&
                !(pos > 0 && text[pos - 1] === '\\')
            ) {
                const match = findMatchingDelimiter(text, pos);
                if (match) {
                    debugLog('Found delimiter match:', match);
                    if (pos > lastPos) {
                        segments.push(text.slice(lastPos, pos));
                    }

                    segments.push({
                        type: 'math',
                        content: text.slice(match.start, match.end),
                        display: match.delimiter.display,
                        isBackslash: match.isBackslash,
                    });

                    lastPos = match.end;
                    pos = match.end;
                    found = true;
                }
            }

            if (!found) {
                pos++;
            }
        }

        if (lastPos < text.length) {
            segments.push(text.slice(lastPos));
        }

        debugLog('Found segments:', segments);
        return segments;
    }
    function processNodes(nodes) {
        let index = 0;

        function processNextBatch(deadline) {
            while (index < nodes.length && deadline.timeRemaining() > 0) {
                processNode(nodes[index++]);
            }

            if (index < nodes.length) {
                requestIdleCallback(processNextBatch);
            }
        }

        requestIdleCallback(processNextBatch);
    }

    function findTextNodes() {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: node => {
                    if (
                        isInCodeBlock(node) ||
                        node.parentElement?.closest('.math-processed')
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                },
            }
        );

        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            nodes.push(node);
        }
        return nodes;
    }

    function processMath() {
        const nodes = findTextNodes();
        if (nodes.length > 0) {
            processNodes(nodes);
        }
    }

    // Debug utility function
    function debugLog(message, data = null) {
        if (typeof window !== 'undefined' && window.DEBUG_LATEX) {
            console.log(`[LaTeX Debug] ${message}`, data || '');
        }
    }

    // Enhanced initialization with error handling
    async function initialize() {
        try {
            debugLog('Initializing LaTeX converter...');
            await loadTeXZilla();
            debugLog('TeXZilla loaded successfully');

            injectStyles();
            debugLog('Styles injected');

            // Initial processing
            processMath();
            debugLog('Initial math processing complete');

            // Enhanced mutation observer for dynamic content
            const observer = new MutationObserver(mutations => {
                let shouldProcess = false;
                let newNodes = [];

                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        shouldProcess = true;
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check if the node or its parents are already processed
                                if (!node.closest('.math-processed')) {
                                    newNodes.push(node);
                                }
                            }
                        });
                    }
                }

                if (shouldProcess && newNodes.length > 0) {
                    debugLog(`Processing ${newNodes.length} new nodes`);
                    requestIdleCallback(() => {
                        newNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const textNodes = [];
                                const walker = document.createTreeWalker(
                                    node,
                                    NodeFilter.SHOW_TEXT,
                                    {
                                        acceptNode: textNode => {
                                            if (
                                                !isInCodeBlock(textNode) &&
                                                !textNode.parentElement?.closest(
                                                    '.math-processed'
                                                )
                                            ) {
                                                return NodeFilter.FILTER_ACCEPT;
                                            }
                                            return NodeFilter.FILTER_REJECT;
                                        },
                                    }
                                );

                                let textNode;
                                while ((textNode = walker.nextNode())) {
                                    textNodes.push(textNode);
                                }

                                if (textNodes.length > 0) {
                                    processNodes(textNodes);
                                }
                            }
                        });
                    });
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });

            debugLog('Mutation observer set up');
        } catch (error) {
            console.error('Error initializing LaTeX converter:', error);
            debugLog('Initialization error:', error);
        }
    }

    // Start the extension with proper timing
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Expose debug toggle for development
    if (typeof window !== 'undefined') {
        window.toggleLaTeXDebug = function (enable = true) {
            window.DEBUG_LATEX = enable;
            debugLog('Debug mode ' + (enable ? 'enabled' : 'disabled'));
        };
    }
})();
