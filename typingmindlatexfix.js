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

    function cleanLatex(latex) {
        debugLog('Cleaning LaTeX:', latex);

        // First, protect certain commands
        let cleaned = latex
            // Protect \widetilde and similar commands
            .replace(
                /(\\widetilde|\\tilde|\\hat|\\bar)\{([^}]+)\}/g,
                '@@$1@@$2@@'
            )
            // Handle \left and \right
            .replace(/\\left\s*\(/g, '\\lparen ')
            .replace(/\\right\s*\)/g, '\\rparen ')
            .replace(/\\left\s*\[/g, '\\lbrack ')
            .replace(/\\right\s*\]/g, '\\rbrack ')
            .replace(/\\left\s*\{/g, '\\lbrace ')
            .replace(/\\right\s*\}/g, '\\rbrace ')
            // Fix common issues
            .replace(/([^\\])delta/g, '$1\\delta')
            .replace(/([^\\])pi/g, '$1\\pi')
            // Normalize whitespace
            .replace(/\s*\n\s*/g, ' ')
            .trim();

        // Restore protected commands
        cleaned = cleaned
            .replace(/@@\\widetilde@@([^@]+)@@/g, '\\widetilde{$1}')
            .replace(/@@\\tilde@@([^@]+)@@/g, '\\tilde{$1}')
            .replace(/@@\\hat@@([^@]+)@@/g, '\\hat{$1}')
            .replace(/@@\\bar@@([^@]+)@@/g, '\\bar{$1}');

        debugLog('Cleaned LaTeX:', cleaned);
        return cleaned;
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
            // Clean up the LaTeX before conversion
            const cleanedLatex = cleanLatex(latex);

            // Try conversion with cleaned LaTeX
            try {
                const mathML = TeXZilla.toMathML(cleanedLatex, isDisplay);
                return new XMLSerializer().serializeToString(mathML);
            } catch (e) {
                debugLog('First conversion attempt failed:', e);

                // Try alternative cleanup if first attempt fails
                const alternativeLatex = cleanedLatex
                    .replace(/\\lparen/g, '(')
                    .replace(/\\rparen/g, ')')
                    .replace(/\\lbrack/g, '[')
                    .replace(/\\rbrack/g, ']');

                const mathML = TeXZilla.toMathML(alternativeLatex, isDisplay);
                return new XMLSerializer().serializeToString(mathML);
            }
        } catch (e) {
            console.error('TeXZilla conversion error:', e);
            debugLog('Failed LaTeX:', latex);
            return null;
        }
    }

    function isLikelyLatex(content) {
        // Check for common LaTeX constructs and mathematical symbols
        const latexPatterns = [
            /\\[a-zA-Z]+/, // LaTeX commands
            /[_^]{.*?}/, // Subscripts and superscripts
            /\\?[∫∑∏√∞±≤≥≠]/, // Mathematical symbols
            /\\(left|right)/, // Brackets
            /\\(frac|sqrt|int)/, // Common math constructs
            /[α-ωΑ-Ω]/, // Greek letters
            /\\(delta|pi|alpha)/, // Named Greek letters
            /\{.*?\}/, // Curly brace groups
            /\\[[\]()]/, // Escaped brackets
            /\$.*?\$/, // Nested dollar signs
        ];

        return latexPatterns.some(pattern => pattern.test(content));
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
                if (isLikelyLatex(content)) {
                    return `\\[${content}\\]`;
                }
                return match;
            }
        );

        protectedText = protectedText.replace(
            /\(([\s\S]*?)\)/g,
            (match, content) => {
                // Only add backslashes if it looks like LaTeX content
                if (isLikelyLatex(content)) {
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

        // Function to safely add a node
        function addNode(n, type = 'text') {
            if (n) {
                const content = type === 'text' ? n.textContent : '\n';
                if (content && content.trim()) {
                    nodes.push({
                        type: type,
                        node: n,
                        content: content,
                    });
                    text += content;
                }
            }
        }

        // Collect preceding text nodes
        while (current.previousSibling) {
            if (current.previousSibling.nodeType === Node.TEXT_NODE) {
                addNode(current.previousSibling);
            } else if (
                current.previousSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.previousSibling.tagName)
            ) {
                addNode(current.previousSibling, 'newline');
            } else {
                break;
            }
            current = current.previousSibling;
        }

        // Reverse the collected nodes to maintain correct order
        nodes.reverse();

        // Add current node
        addNode(node);

        // Collect following text nodes
        current = node;
        while (current.nextSibling) {
            if (current.nextSibling.nodeType === Node.TEXT_NODE) {
                addNode(current.nextSibling);
            } else if (
                current.nextSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.nextSibling.tagName)
            ) {
                addNode(current.nextSibling, 'newline');
            } else {
                break;
            }
            current = current.nextSibling;
        }

        const reconstructedText = reconstructDelimiters(text);
        debugLog('Original text:', text);
        debugLog('Reconstructed text:', reconstructedText);

        return {
            nodes: nodes,
            text: reconstructedText,
            originalText: text,
        };
    }

    function findMatchingDelimiter(text, startPos) {
        debugLog('Finding delimiter at position:', startPos);

        // Helper function to find matching end delimiter
        function findMatching(start, end, pos) {
            let depth = 1;
            let i = pos + start.length;

            while (i < text.length) {
                if (text.startsWith(start, i) && text[i - 1] !== '\\') {
                    depth++;
                } else if (text.startsWith(end, i) && text[i - 1] !== '\\') {
                    depth--;
                    if (depth === 0) {
                        return i;
                    }
                }
                i++;
            }
            return -1;
        }

        // Handle display dollars
        if (text.startsWith('$$', startPos)) {
            const endPos = findMatching('$$', '$$', startPos);
            if (endPos !== -1) {
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.DISPLAY_DOLLARS,
                };
            }
        }

        // Handle inline dollars
        if (text[startPos] === '$' && !text.startsWith('$$', startPos)) {
            let pos = startPos + 1;
            while (pos < text.length) {
                if (
                    text[pos] === '$' &&
                    text[pos - 1] !== '\\' &&
                    !text.startsWith('$$', pos - 1)
                ) {
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
            const endPos = findMatching('\\[', '\\]', startPos);
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
            const endPos = findMatching('\\(', '\\)', startPos);
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

        try {
            const mathML = convertToMathML(latex, match.display);
            if (mathML) {
                container.innerHTML = mathML;
            } else {
                // If conversion fails, try to display original LaTeX
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
                    debugLog('Error processing node in batch:', e);
                }
            }

            if (index < nodes.length) {
                requestIdleCallback(processNextBatch);
            }
        }

        requestIdleCallback(processNextBatch);
    }

    function findTextNodes() {
        try {
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: node => {
                        if (
                            isInCodeBlock(node) ||
                            node.parentElement?.closest('.math-processed') ||
                            !node.textContent.trim()
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
        } catch (e) {
            debugLog('Error finding text nodes:', e);
            return [];
        }
    }

    function processMath() {
        try {
            debugLog('Processing math expressions');
            const nodes = findTextNodes();
            if (nodes.length > 0) {
                processNodes(nodes);
            }
        } catch (e) {
            debugLog('Error in processMath:', e);
        }
    }

    // Enhanced mutation observer handler
    function handleMutations(mutations) {
        try {
            let shouldProcess = false;
            let newNodes = new Set();

            mutations.forEach(mutation => {
                // Handle added nodes
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (!node.closest('.math-processed')) {
                            shouldProcess = true;
                            newNodes.add(node);
                        }
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        if (!node.parentElement?.closest('.math-processed')) {
                            shouldProcess = true;
                            newNodes.add(node);
                        }
                    }
                });

                // Handle character data changes
                if (mutation.type === 'characterData') {
                    const node = mutation.target;
                    if (!node.parentElement?.closest('.math-processed')) {
                        shouldProcess = true;
                        newNodes.add(node);
                    }
                }
            });

            if (shouldProcess) {
                debugLog(`Processing ${newNodes.size} new/modified nodes`);
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
                                                ) &&
                                                textNode.textContent.trim()
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
        } catch (e) {
            debugLog('Error handling mutations:', e);
        }
    }

    async function initialize() {
        try {
            debugLog('Initializing LaTeX converter...');
            await loadTeXZilla();
            injectStyles();

            // Initial processing
            processMath();

            // Set up mutation observer
            const observer = new MutationObserver(handleMutations);
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

    // Utility functions exposed to window
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
                                    ) &&
                                    textNode.textContent.trim()
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

            // Add recovery function
            recoverOriginal: function (element) {
                const mathElements = element.querySelectorAll(
                    '.math-container[data-original]'
                );
                mathElements.forEach(el => {
                    el.textContent = el.getAttribute('data-original');
                });
            },
        };
    }

    // Start the extension
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
