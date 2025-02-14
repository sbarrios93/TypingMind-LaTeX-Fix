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
    function reconstructDelimiters(text) {
        debugLog('Reconstructing delimiters for:', text);

        // First identify and protect existing LaTeX delimiters
        const protected = [];
        let protectedText = text.replace(
            /(\$\$[\s\S]*?\$\$|\$[^\$\n]+\$)/g,
            (match, p1) => {
                protected.push(p1);
                return `@@PROTECTED${protected.length - 1}@@`;
            }
        );

        // Now handle brackets and parentheses that should be LaTeX
        protectedText = protectedText.replace(
            /\[([\s\S]*?)\]/g,
            (match, content) => {
                // Only add backslashes if it looks like LaTeX content
                if (/[\\{}_^]/.test(content) || content.includes('\n')) {
                    return `\\[${content}\\]`;
                }
                return match;
            }
        );

        protectedText = protectedText.replace(
            /\(([\s\S]*?)\)/g,
            (match, content) => {
                // Only add backslashes if it looks like LaTeX content
                if (/[\\{}_^]/.test(content) || content.includes('\n')) {
                    return `\\(${content}\\)`;
                }
                return match;
            }
        );

        // Restore protected content
        protectedText = protectedText.replace(
            /@@PROTECTED(\d+)@@/g,
            (match, index) => {
                return protected[parseInt(index)];
            }
        );

        debugLog('Reconstructed text:', protectedText);
        return protectedText;
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

        const reconstructedText = reconstructDelimiters(text);
        debugLog('Reconstructed text:', reconstructedText);

        return {
            nodes: nodes,
            text: reconstructedText,
            originalText: text,
        };
    }

    function findMatchingDelimiter(text, startPos) {
        debugLog('Finding delimiter at position:', startPos);
        debugLog('Text snippet:', text.substr(startPos, 20));

        // Handle display dollars
        if (text.startsWith('$$', startPos)) {
            const endPos = text.indexOf('$$', startPos + 2);
            if (endPos !== -1) {
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.DISPLAY_DOLLARS,
                };
            }
        }

        // Handle inline dollars
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

        // Handle display brackets
        if (text.startsWith('\\[', startPos)) {
            const endPos = text.indexOf('\\]', startPos + 2);
            if (endPos !== -1) {
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.DISPLAY_BRACKETS,
                };
            }
        }

        // Handle inline parentheses
        if (text.startsWith('\\(', startPos)) {
            const endPos = text.indexOf('\\)', startPos + 2);
            if (endPos !== -1) {
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.INLINE_PARENS,
                };
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
        if (match.content.startsWith('$$') && match.content.endsWith('$$')) {
            latex = match.content.slice(2, -2).trim();
        } else if (
            match.content.startsWith('$') &&
            match.content.endsWith('$')
        ) {
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

        // Clean up any newlines in the LaTeX content
        latex = latex.replace(/\s*\n\s*/g, ' ').trim();
        debugLog('Cleaned LaTeX:', latex);

        const mathML = convertToMathML(latex, match.display);
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
        const { nodes, text, originalText } = getAdjacentTextNodes(node);

        if (text === originalText) {
            debugLog('No changes needed for this node');
            return;
        }

        // Check for any math delimiters
        let hasDelimiter = false;
        for (const del of Object.values(DELIMITERS)) {
            if (text.includes(del.start)) {
                hasDelimiter = true;
                break;
            }
        }

        if (!hasDelimiter) {
            debugLog('No delimiters found');
            return;
        }

        const segments = findMathDelimiters(text);
        if (segments.length === 1 && typeof segments[0] === 'string') {
            debugLog('Only one text segment found');
            return;
        }

        try {
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

                    // Also check for character data mutations
                    if (mutation.type === 'characterData') {
                        const node = mutation.target;
                        if (!node.parentElement?.closest('.math-processed')) {
                            shouldProcess = true;
                            newNodes.push(node);
                        }
                    }
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

    // Start the extension with proper timing
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Expose utility functions for debugging and manual control
    if (typeof window !== 'undefined') {
        window.LaTeXProcessor = {
            toggleDebug: function (enable = true) {
                window.DEBUG_LATEX = enable;
                debugLog('Debug mode ' + (enable ? 'enabled' : 'disabled'));
            },

            reprocess: function () {
                debugLog('Manually triggering LaTeX processing');
                processMath();
            },

            processElement: function (element) {
                debugLog('Processing specific element:', element);
                if (!element) {
                    debugLog('No element provided');
                    return;
                }

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
    }
})();
