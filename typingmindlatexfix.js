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

    // Utility functions
    async function loadTeXZilla() {
        if (state.teXZillaLoaded) return;

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://fred-wang.github.io/TeXZilla/TeXZilla-min.js';
            script.onload = () => {
                state.teXZillaLoaded = true;
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
        try {
            const mathML = TeXZilla.toMathML(latex, isDisplay);
            return new XMLSerializer().serializeToString(mathML);
        } catch (e) {
            console.error('TeXZilla conversion error:', e);
            return null;
        }
    }
    function getAdjacentTextNodes(node) {
        const nodes = [];
        let current = node;

        // Get preceding text nodes
        while (current.previousSibling) {
            if (current.previousSibling.nodeType === Node.TEXT_NODE) {
                nodes.unshift(current.previousSibling);
            } else if (
                current.previousSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.previousSibling.tagName)
            ) {
                // Enhanced newline handling for backslash delimiters
                const prevText = current.previousSibling.textContent;
                if (prevText && prevText.trim().endsWith('\\')) {
                    nodes.unshift({
                        type: 'newline',
                        node: current.previousSibling,
                        preserveBackslash: true,
                    });
                } else {
                    nodes.unshift({
                        type: 'newline',
                        node: current.previousSibling,
                    });
                }
            } else {
                break;
            }
            current = current.previousSibling;
        }

        // Add current node
        nodes.push(node);

        // Get following text nodes
        current = node;
        while (current.nextSibling) {
            if (current.nextSibling.nodeType === Node.TEXT_NODE) {
                nodes.push(current.nextSibling);
            } else if (
                current.nextSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.nextSibling.tagName)
            ) {
                // Enhanced newline handling for following nodes
                const nextText = current.nextSibling.textContent;
                if (nextText && nextText.trim().startsWith('\\')) {
                    nodes.push({
                        type: 'newline',
                        node: current.nextSibling,
                        preserveBackslash: true,
                    });
                } else {
                    nodes.push({
                        type: 'newline',
                        node: current.nextSibling,
                    });
                }
            } else {
                break;
            }
            current = current.nextSibling;
        }

        return nodes;
    }

    function findMatchingDelimiter(text, startPos) {
        // Handle display dollars ($$...$$)
        if (text.startsWith('$$', startPos)) {
            let pos = startPos + 2;
            while (pos < text.length - 1) {
                if (text.startsWith('$$', pos) && text[pos - 1] !== '\\') {
                    return {
                        start: startPos,
                        end: pos + 2,
                        delimiter: DELIMITERS.DISPLAY_DOLLARS,
                    };
                }
                pos++;
            }
        }

        // Handle inline dollars ($...$)
        if (text[startPos] === '$') {
            let pos = startPos + 1;
            while (pos < text.length) {
                if (text[pos] === '$' && text[pos - 1] !== '\\') {
                    return {
                        start: startPos,
                        end: pos + 1,
                        delimiter: DELIMITERS.INLINE_DOLLARS,
                    };
                }
                pos++;
            }
        }

        // Enhanced handling for backslash delimiters
        if (text[startPos] === '\\') {
            for (const del of [
                DELIMITERS.DISPLAY_BRACKETS,
                DELIMITERS.INLINE_PARENS,
            ]) {
                const startDelimiter = del.start;
                const endDelimiter = del.end;

                if (text.substring(startPos).startsWith(startDelimiter)) {
                    let pos = startPos + startDelimiter.length;
                    let escaped = false;
                    let bracketCount = 1;

                    while (pos < text.length) {
                        // Handle escaped characters
                        if (text[pos] === '\\' && !escaped) {
                            escaped = true;
                            pos++;
                            continue;
                        }

                        // Check for nested delimiters
                        if (!escaped) {
                            if (
                                text.substring(pos).startsWith(startDelimiter)
                            ) {
                                bracketCount++;
                            } else if (
                                text.substring(pos).startsWith(endDelimiter)
                            ) {
                                bracketCount--;
                                if (bracketCount === 0) {
                                    return {
                                        start: startPos,
                                        end: pos + endDelimiter.length,
                                        delimiter: del,
                                    };
                                }
                            }
                        }

                        escaped = false;
                        pos++;
                    }
                }
            }
        }

        return null;
    }
    function findMathDelimiters(text) {
        const segments = [];
        let pos = 0;
        let lastPos = 0;

        // Normalize line endings
        text = text.replace(/\r\n/g, '\n');

        while (pos < text.length) {
            let found = false;

            // Check for potential delimiters
            if (
                (text[pos] === '$' || text[pos] === '\\') &&
                !(pos > 0 && text[pos - 1] === '\\')
            ) {
                const match = findMatchingDelimiter(text, pos);
                if (match) {
                    if (pos > lastPos) {
                        segments.push(text.slice(lastPos, pos));
                    }

                    // Extract the complete math expression
                    const content = text.slice(match.start, match.end);
                    segments.push({
                        type: 'math',
                        content: content,
                        display: match.delimiter.display,
                        isBackslash: content.startsWith('\\'),
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

        return segments;
    }

    function processMathExpression(match, isDisplay) {
        const container = document.createElement('span');
        container.className = 'math-container math-processed';
        if (isDisplay) {
            container.setAttribute('data-display', 'block');
        }

        let latex;
        if (match.isBackslash) {
            // Handle backslash delimiters
            for (const del of [
                DELIMITERS.DISPLAY_BRACKETS,
                DELIMITERS.INLINE_PARENS,
            ]) {
                if (
                    match.content.startsWith(del.start) &&
                    match.content.endsWith(del.end)
                ) {
                    latex = match.content.slice(
                        del.start.length,
                        -del.end.length
                    );
                    break;
                }
            }
        } else {
            // Handle dollar delimiters
            for (const del of [
                DELIMITERS.DISPLAY_DOLLARS,
                DELIMITERS.INLINE_DOLLARS,
            ]) {
                if (
                    match.content.startsWith(del.start) &&
                    match.content.endsWith(del.end)
                ) {
                    latex = match.content.slice(
                        del.start.length,
                        -del.end.length
                    );
                    break;
                }
            }
        }

        if (!latex) {
            container.textContent = match.content;
            return container;
        }

        // Convert to MathML and render
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

        const adjacentNodes = getAdjacentTextNodes(node);
        let combinedText = '';
        let lastWasNewline = false;

        // Improved text combination for multiline content
        adjacentNodes.forEach(n => {
            if (n.type === 'newline') {
                if (n.preserveBackslash) {
                    combinedText += '\n\\'; // Preserve backslash at line end
                } else {
                    combinedText += '\n';
                }
                lastWasNewline = true;
            } else {
                if (lastWasNewline && n.textContent.startsWith('\\')) {
                    // Don't add extra backslash if the text already starts with one
                    combinedText += n.textContent.substring(1);
                } else {
                    combinedText += n.textContent;
                }
                lastWasNewline = false;
            }
        });

        // Check for any math delimiters
        let hasDelimiter = false;
        for (const del of Object.values(DELIMITERS)) {
            if (combinedText.includes(del.start)) {
                hasDelimiter = true;
                break;
            }
        }
        if (!hasDelimiter) return;

        // Process the segments
        const segments = findMathDelimiters(combinedText);
        if (segments.length === 1 && typeof segments[0] === 'string') {
            return;
        }

        const wrapper = document.createElement('span');
        wrapper.className = 'math-processed-wrapper';

        segments.forEach(segment => {
            if (typeof segment === 'string') {
                if (segment) {
                    wrapper.appendChild(document.createTextNode(segment));
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

        // Replace the original nodes with the processed content
        const parent = node.parentNode;
        if (parent) {
            adjacentNodes.forEach(n => {
                if (n.type === 'newline' && n.node.parentNode) {
                    n.node.parentNode.removeChild(n.node);
                } else if (!n.type && n.parentNode) {
                    n.parentNode.removeChild(n);
                }
            });

            const firstNode = adjacentNodes[0];
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
