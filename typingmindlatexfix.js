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
            debugLog('Failed LaTeX:', latex);
            return null;
        }
    }
    function isLikelyLatex(content) {
        // Check for common LaTeX constructs and mathematical symbols
        return (
            /[_^{}\\]/.test(content) || // LaTeX control characters
            /\\?[a-zA-Z]{2,}/.test(content) || // Possible commands
            /\d+/.test(content) || // Numbers
            /[∫∑∏√∞±≤≥≠]/.test(content) || // Math symbols
            /[α-ωΑ-Ω]/.test(content) || // Greek letters
            content.includes('\n') // Multiline content
        );
    }

    function getAdjacentTextNodes(node) {
        debugLog('Getting adjacent text nodes for:', node.textContent);
        const nodes = [];
        let current = node;
        let text = '';

        // Collect preceding text nodes
        while (current.previousSibling) {
            if (current.previousSibling.nodeType === Node.TEXT_NODE) {
                text = current.previousSibling.textContent + text;
                nodes.unshift({
                    type: 'text',
                    node: current.previousSibling,
                    content: current.previousSibling.textContent,
                });
            } else if (
                current.previousSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.previousSibling.tagName)
            ) {
                text = '\n' + text;
                nodes.unshift({
                    type: 'newline',
                    node: current.previousSibling,
                });
            } else {
                break;
            }
            current = current.previousSibling;
        }

        // Add current node
        text += node.textContent;
        nodes.push({
            type: 'text',
            node: node,
            content: node.textContent,
        });

        // Collect following text nodes
        current = node;
        while (current.nextSibling) {
            if (current.nextSibling.nodeType === Node.TEXT_NODE) {
                text += current.nextSibling.textContent;
                nodes.push({
                    type: 'text',
                    node: current.nextSibling,
                    content: current.nextSibling.textContent,
                });
            } else if (
                current.nextSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.nextSibling.tagName)
            ) {
                text += '\n';
                nodes.push({
                    type: 'newline',
                    node: current.nextSibling,
                });
            } else {
                break;
            }
            current = current.nextSibling;
        }

        debugLog('Collected text:', text);
        return {
            nodes: nodes,
            text: text,
        };
    }

    function findMatchingDelimiter(text, startPos) {
        debugLog('Finding delimiter at position:', startPos);

        // Handle display dollars
        if (text.startsWith('$$', startPos)) {
            const endPos = text.indexOf('$$', startPos + 2);
            if (endPos !== -1) {
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.DISPLAY_DOLLARS,
                    type: 'dollars',
                };
            }
        }

        // Handle inline dollars
        if (text[startPos] === '$' && !text.startsWith('$$', startPos)) {
            let pos = startPos + 1;
            while (pos < text.length) {
                if (text[pos] === '$' && text[pos - 1] !== '\\') {
                    return {
                        start: startPos,
                        end: pos + 1,
                        delimiter: DELIMITERS.INLINE_DOLLARS,
                        type: 'dollars',
                    };
                }
                pos++;
            }
        }

        // Handle unescaped square brackets that should be LaTeX
        if (text[startPos] === '[') {
            const endPos = text.indexOf(']', startPos + 1);
            if (endPos !== -1) {
                const content = text.slice(startPos + 1, endPos);
                if (isLikelyLatex(content)) {
                    return {
                        start: startPos,
                        end: endPos + 1,
                        delimiter: DELIMITERS.DISPLAY_BRACKETS,
                        type: 'brackets',
                    };
                }
            }
        }

        // Handle unescaped parentheses that should be LaTeX
        if (text[startPos] === '(') {
            const endPos = text.indexOf(')', startPos + 1);
            if (endPos !== -1) {
                const content = text.slice(startPos + 1, endPos);
                if (isLikelyLatex(content)) {
                    return {
                        start: startPos,
                        end: endPos + 1,
                        delimiter: DELIMITERS.INLINE_PARENS,
                        type: 'brackets',
                    };
                }
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
                (text[pos] === '$' ||
                    text[pos] === '[' ||
                    text[pos] === '(' ||
                    text.startsWith('\\[', pos) ||
                    text.startsWith('\\(', pos)) &&
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
                        delimiterType: match.type,
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
    function processMathExpression(match) {
        debugLog('Processing math expression:', match);
        const container = document.createElement('span');
        container.className = 'math-container math-processed';
        if (match.display) {
            container.setAttribute('data-display', 'block');
        }

        let latex;
        // Extract the inner content without the delimiters
        if (match.content.startsWith('$$') && match.content.endsWith('$$')) {
            latex = match.content.slice(2, -2).trim();
        } else if (
            match.content.startsWith('$') &&
            match.content.endsWith('$')
        ) {
            latex = match.content.slice(1, -1).trim();
        } else if (
            match.content.startsWith('[') &&
            match.content.endsWith(']')
        ) {
            // Just get the inner content for square brackets
            latex = match.content.slice(1, -1).trim();
        } else if (
            match.content.startsWith('(') &&
            match.content.endsWith(')')
        ) {
            // Just get the inner content for parentheses
            latex = match.content.slice(1, -1).trim();
        } else if (
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

        if (!latex) {
            debugLog('No LaTeX content extracted');
            container.textContent = match.content;
            return container;
        }

        try {
            // Handle \left and \right in the latex content
            latex = latex
                .replace(/\\left\s*\(/g, '\\lparen ')
                .replace(/\\right\s*\)/g, '\\rparen ')
                .replace(/\\left\s*\[/g, '\\lbrack ')
                .replace(/\\right\s*\]/g, '\\rbrack ');

            debugLog('Processing LaTeX:', latex);
            // Pass the display parameter based on the delimiter type
            const isDisplay =
                match.content.startsWith('$$') ||
                match.content.startsWith('\\[') ||
                match.content.startsWith('[');

            const mathML = convertToMathML(latex, isDisplay);
            if (mathML) {
                container.innerHTML = mathML;
            } else {
                container.textContent = match.content;
            }
        } catch (e) {
            debugLog('Error converting to MathML:', e);
            container.textContent = match.content;
        }

        return container;
    }
    function processNode(node) {
        if (!node || node.nodeType !== Node.TEXT_NODE || isInCodeBlock(node)) {
            return;
        }

        debugLog('Processing node:', node.textContent);
        const { nodes, text } = getAdjacentTextNodes(node);

        // Check for any math delimiters
        let hasDelimiter = false;
        if (
            text.includes('$') ||
            text.includes('[') ||
            text.includes('(') ||
            text.includes('\\[') ||
            text.includes('\\(')
        ) {
            hasDelimiter = true;
        }

        if (!hasDelimiter) {
            debugLog('No delimiters found');
            return;
        }

        try {
            const segments = findMathDelimiters(text);
            if (segments.length === 1 && typeof segments[0] === 'string') {
                debugLog('Only one text segment found');
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
                    const mathElement = processMathExpression(segment);
                    if (mathElement) {
                        wrapper.appendChild(mathElement);
                    }
                }
            });

            // Replace the original nodes with the wrapper
            const parent = node.parentNode;
            if (parent) {
                // Remove all nodes first
                nodes.forEach(n => {
                    try {
                        if (n.node && n.node.parentNode) {
                            n.node.parentNode.removeChild(n.node);
                        }
                    } catch (e) {
                        debugLog('Error removing node:', e);
                    }
                });

                // Then append the wrapper
                try {
                    parent.appendChild(wrapper);
                } catch (e) {
                    debugLog('Error appending wrapper:', e);
                }
            }
        } catch (e) {
            debugLog('Error in processNode:', e);
        }
    }

    function processNodes(nodes) {
        let index = 0;

        function processNextBatch(deadline) {
            while (index < nodes.length && deadline.timeRemaining() > 0) {
                try {
                    processNode(nodes[index++]);
                } catch (e) {
                    debugLog('Error processing node:', e);
                }
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
                    // Check for text content changes
                    if (mutation.type === 'characterData') {
                        const node = mutation.target;
                        if (!node.parentElement?.closest('.math-processed')) {
                            shouldProcess = true;
                            newNodes.push(node);
                        }
                    }

                    // Check for added nodes
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (!node.closest('.math-processed')) {
                                shouldProcess = true;
                                newNodes.push(node);
                            }
                        } else if (node.nodeType === Node.TEXT_NODE) {
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
                            try {
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
                            } catch (e) {
                                debugLog('Error processing mutation node:', e);
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

    // Utility functions for external control
    const LaTeXProcessor = {
        toggleDebug: function (enable = true) {
            window.DEBUG_LATEX = enable;
            debugLog('Debug mode ' + (enable ? 'enabled' : 'disabled'));
        },

        reprocess: function () {
            debugLog('Manually triggering LaTeX processing');
            processMath();
        },

        processElement: function (element) {
            if (!element) {
                debugLog('No element provided');
                return;
            }

            debugLog('Processing specific element:', element);
            try {
                const textNodes = [];
                const walker = document.createTreeWalker(
                    element,
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
            } catch (e) {
                debugLog('Error processing element:', e);
            }
        },

        getState: function () {
            return {
                teXZillaLoaded: state.teXZillaLoaded,
                debug: !!window.DEBUG_LATEX,
            };
        },
    };

    // Start the extension
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Expose utility functions globally
    if (typeof window !== 'undefined') {
        window.LaTeXProcessor = LaTeXProcessor;
    }
})();
