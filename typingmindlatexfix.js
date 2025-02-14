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
        let text = '';
        const nodesToRemove = [];

        // First, find the topmost parent that contains all the text
        let startNode = node;
        while (
            startNode.previousSibling &&
            (startNode.previousSibling.nodeType === Node.TEXT_NODE ||
                ['BR', 'DIV', 'P'].includes(startNode.previousSibling.tagName))
        ) {
            startNode = startNode.previousSibling;
        }

        // Now collect all text and nodes in sequence
        let current = startNode;
        while (current) {
            if (current.nodeType === Node.TEXT_NODE) {
                text += current.textContent;
                nodesToRemove.push(current);
            } else if (['BR', 'DIV', 'P'].includes(current.tagName)) {
                text += '\n';
                nodesToRemove.push(current);
            } else {
                break;
            }
            current = current.nextSibling;
        }

        debugLog('Collected text:', text);
        return {
            text: text,
            nodes: nodesToRemove,
        };
    }

    function findMatchingDelimiter(text, startPos) {
        debugLog('Finding delimiter at position:', startPos);
        debugLog('Text snippet:', text.substr(startPos, 20));

        // For backslash delimiters, we need to handle the case where the backslash
        // might be followed by a newline
        if (text[startPos] === '\\') {
            const restOfText = text.slice(startPos);
            debugLog('Checking backslash delimiter in:', restOfText);

            // Check for \[ ... \]
            if (restOfText.match(/^\\\s*\[/)) {
                const match = restOfText.match(/^\\\s*\[([\s\S]*?)\\\s*\]/);
                if (match) {
                    debugLog('Found display bracket match:', match[0]);
                    return {
                        start: startPos,
                        end: startPos + match[0].length,
                        delimiter: DELIMITERS.DISPLAY_BRACKETS,
                        isBackslash: true,
                    };
                }
            }

            // Check for \( ... \)
            if (restOfText.match(/^\\\s*\(/)) {
                const match = restOfText.match(/^\\\s*\(([\s\S]*?)\\\s*\)/);
                if (match) {
                    debugLog('Found inline paren match:', match[0]);
                    return {
                        start: startPos,
                        end: startPos + match[0].length,
                        delimiter: DELIMITERS.INLINE_PARENS,
                        isBackslash: true,
                    };
                }
            }
        }

        // Handle dollar delimiters
        if (text.startsWith('$$', startPos)) {
            const endPos = text.indexOf('$$', startPos + 2);
            if (endPos !== -1) {
                debugLog('Found display dollar match');
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.DISPLAY_DOLLARS,
                    isBackslash: false,
                };
            }
        }

        if (text[startPos] === '$') {
            let pos = startPos + 1;
            while (pos < text.length) {
                if (text[pos] === '$' && text[pos - 1] !== '\\') {
                    debugLog('Found inline dollar match');
                    return {
                        start: startPos,
                        end: pos + 1,
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

        text = text.replace(/\r\n/g, '\n'); // Normalize newlines
        debugLog('Normalized text:', text);

        while (pos < text.length) {
            let found = false;

            if (
                (text[pos] === '$' || text[pos] === '\\') &&
                !(pos > 0 && text[pos - 1] === '\\')
            ) {
                const match = findMatchingDelimiter(text, pos);
                if (match) {
                    debugLog('Found match:', match);
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
    function processMathExpression(match, isDisplay) {
        debugLog('Processing math expression:', match);
        const container = document.createElement('span');
        container.className = 'math-container math-processed';
        if (isDisplay) {
            container.setAttribute('data-display', 'block');
        }

        let latex;
        if (match.isBackslash) {
            // Handle backslash delimiters
            if (
                match.content.startsWith('\\[') &&
                match.content.endsWith('\\]')
            ) {
                latex = match.content.slice(2, -2).trim();
            } else if (
                match.content.startsWith('\\(') &&
                match.content.endsWith('\\)')
            ) {
                latex = match.content.slice(2, -2).trim();
            }
            debugLog('Extracted LaTeX from backslash:', latex);
        } else {
            // Handle dollar delimiters
            if (
                match.content.startsWith('$$') &&
                match.content.endsWith('$$')
            ) {
                latex = match.content.slice(2, -2).trim();
            } else if (
                match.content.startsWith('$') &&
                match.content.endsWith('$')
            ) {
                latex = match.content.slice(1, -1).trim();
            }
            debugLog('Extracted LaTeX from dollars:', latex);
        }

        if (!latex) {
            debugLog('No LaTeX content extracted');
            container.textContent = match.content;
            return container;
        }

        // Clean up any newlines in the LaTeX content
        latex = latex.replace(/\s*\n\s*/g, ' ').trim();
        debugLog('Cleaned LaTeX:', latex);

        const mathML = convertToMathML(latex, isDisplay);
        if (mathML) {
            container.innerHTML = mathML;
        } else {
            container.textContent = match.content;
        }

        return container;
    }

    function processNode(node) {
        if (!node || node.nodeType !== Node.TEXT_NODE || isInCodeBlock(node)) {
            return;
        }

        debugLog('Processing node:', node.textContent);
        const { text, nodes } = getAdjacentTextNodes(node);

        // Check for delimiters in the complete text
        let hasDelimiter = false;
        for (const del of Object.values(DELIMITERS)) {
            // For backslash delimiters, check for both parts
            if (del.start.startsWith('\\')) {
                const startChar = del.start.charAt(1);
                const endChar = del.end.charAt(1);
                if (text.includes(startChar) && text.includes(endChar)) {
                    hasDelimiter = true;
                    break;
                }
            } else if (text.includes(del.start)) {
                hasDelimiter = true;
                break;
            }
        }

        if (!hasDelimiter) {
            debugLog('No delimiters found');
            return;
        }

        // Process the complete text
        const segments = findMathDelimiters(text);
        if (segments.length === 1 && typeof segments[0] === 'string') {
            debugLog('Only one text segment found, no processing needed');
            return;
        }

        const wrapper = document.createElement('span');
        wrapper.className = 'math-processed-wrapper';

        segments.forEach(segment => {
            if (typeof segment === 'string') {
                if (segment) {
                    const textNode = document.createTextNode(segment);
                    wrapper.appendChild(textNode);
                }
            } else if (segment.type === 'math') {
                const mathElement = processMathExpression(
                    segment,
                    segment.display
                );
                if (mathElement) {
                    wrapper.appendChild(mathElement);
                }
            }
        });

        // Replace all collected nodes with the wrapper
        const parent = node.parentNode;
        if (parent) {
            const firstNode = nodes[0];
            nodes.forEach(n => {
                if (n.parentNode) {
                    n.parentNode.removeChild(n);
                }
            });
            if (firstNode && firstNode.parentNode) {
                parent.insertBefore(wrapper, firstNode);
            } else {
                parent.appendChild(wrapper);
            }
        }
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
        debugLog('Found text nodes:', nodes.length);
        return nodes;
    }

    function processMath() {
        debugLog('Processing math expressions');
        const nodes = findTextNodes();
        if (nodes.length > 0) {
            processNodes(nodes);
        }
    }

    // Enhanced initialization with better error handling and debugging
    async function initialize() {
        try {
            debugLog('Initializing LaTeX converter...');
            await loadTeXZilla();
            injectStyles();

            // Initial processing
            processMath();

            // Enhanced mutation observer with better handling of dynamic content
            const observer = new MutationObserver(mutations => {
                let shouldProcess = false;
                let newNodes = [];

                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if the node or its parents are already processed
                            if (!node.closest('.math-processed')) {
                                shouldProcess = true;
                                newNodes.push(node);
                            }
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            // For text nodes, check parent
                            if (
                                !node.parentElement?.closest('.math-processed')
                            ) {
                                shouldProcess = true;
                                newNodes.push(node);
                            }
                        }
                    });
                });

                if (shouldProcess) {
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
                            } else if (node.nodeType === Node.TEXT_NODE) {
                                processNode(node);
                            }
                        });
                    });
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
            });

            debugLog('Initialization complete');
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

    // Expose debug toggle and reprocess function
    if (typeof window !== 'undefined') {
        window.toggleLaTeXDebug = function (enable = true) {
            window.DEBUG_LATEX = enable;
            debugLog('Debug mode ' + (enable ? 'enabled' : 'disabled'));
        };

        window.reprocessLaTeX = function () {
            debugLog('Manually triggering LaTeX processing');
            processMath();
        };

        // Add a function to process specific content
        window.processLaTeXContent = function (element) {
            debugLog('Processing specific element:', element);
            const textNodes = [];
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: textNode => {
                        if (
                            !isInCodeBlock(textNode) &&
                            !textNode.parentElement?.closest('.math-processed')
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
        };
    }
})();
