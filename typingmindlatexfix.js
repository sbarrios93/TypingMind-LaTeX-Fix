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
        debugLog('Getting adjacent text nodes for:', node.textContent);
        const nodes = [];
        let current = node;
        let lastWasBackslash = false;

        // Get preceding text nodes
        while (current.previousSibling) {
            if (current.previousSibling.nodeType === Node.TEXT_NODE) {
                const text = current.previousSibling.textContent;
                if (lastWasBackslash && text.trim().endsWith('\\')) {
                    nodes.unshift({
                        type: 'text',
                        content: text,
                        preserveBackslash: true,
                    });
                } else {
                    nodes.unshift({
                        type: 'text',
                        content: text,
                        node: current.previousSibling,
                    });
                }
                lastWasBackslash = text.trim().endsWith('\\');
            } else if (
                current.previousSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.previousSibling.tagName)
            ) {
                nodes.unshift({
                    type: 'newline',
                    node: current.previousSibling,
                    preserveBackslash: lastWasBackslash,
                });
            } else {
                break;
            }
            current = current.previousSibling;
        }

        // Add current node
        nodes.push({
            type: 'text',
            content: node.textContent,
            node: node,
        });

        // Get following text nodes
        current = node;
        lastWasBackslash = node.textContent.trim().endsWith('\\');

        while (current.nextSibling) {
            if (current.nextSibling.nodeType === Node.TEXT_NODE) {
                const text = current.nextSibling.textContent;
                nodes.push({
                    type: 'text',
                    content: text,
                    node: current.nextSibling,
                    preserveBackslash: lastWasBackslash,
                });
                lastWasBackslash = text.trim().endsWith('\\');
            } else if (
                current.nextSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.nextSibling.tagName)
            ) {
                nodes.push({
                    type: 'newline',
                    node: current.nextSibling,
                    preserveBackslash: lastWasBackslash,
                });
            } else {
                break;
            }
            current = current.nextSibling;
        }

        debugLog('Total nodes found:', nodes.length);
        return nodes;
    }

    function normalizeDelimiterText(text) {
        // Preserve backslashes at line endings
        return text.replace(/\\\r?\n\s*/g, '\\').replace(/\r?\n\s*/g, ' ');
    }

    function findMatchingDelimiter(text, startPos) {
        debugLog('Finding delimiter at position:', startPos);
        debugLog('Text snippet:', text.substr(startPos, 20));

        // Normalize text while preserving important backslashes
        const normalizedText = normalizeDelimiterText(text);
        debugLog('Normalized text:', normalizedText);

        if (normalizedText[startPos] === '\\') {
            debugLog('Found backslash delimiter');

            for (const del of [
                DELIMITERS.DISPLAY_BRACKETS,
                DELIMITERS.INLINE_PARENS,
            ]) {
                const startDelimiter = del.start.replace(/\\/g, '\\');
                const endDelimiter = del.end.replace(/\\/g, '\\');

                if (
                    normalizedText
                        .substring(startPos)
                        .startsWith(startDelimiter)
                ) {
                    debugLog('Matched start delimiter:', startDelimiter);
                    let pos = startPos + startDelimiter.length;
                    let bracketCount = 1;
                    let escaped = false;

                    while (pos < normalizedText.length) {
                        if (!escaped) {
                            if (
                                normalizedText
                                    .substring(pos)
                                    .startsWith(endDelimiter)
                            ) {
                                bracketCount--;
                                if (bracketCount === 0) {
                                    debugLog(
                                        'Found matching end delimiter at:',
                                        pos
                                    );
                                    // Calculate the actual end position in original text
                                    const originalEnd = text.indexOf(
                                        del.end,
                                        startPos + del.start.length
                                    );
                                    return {
                                        start: startPos,
                                        end: originalEnd + del.end.length,
                                        delimiter: del,
                                        isBackslash: true,
                                    };
                                }
                            } else if (
                                normalizedText
                                    .substring(pos)
                                    .startsWith(startDelimiter)
                            ) {
                                bracketCount++;
                            }
                        }
                        escaped = !escaped && normalizedText[pos] === '\\';
                        pos++;
                    }
                }
            }
        }

        // Handle dollars (no changes needed for dollar handling)
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

        return null;
    }

    function findMathDelimiters(text) {
        debugLog('Finding math delimiters in text:', text);
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

        debugLog('Extracted LaTeX:', latex);

        if (!latex) {
            container.textContent = match.content;
            return container;
        }

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
        const adjacentNodes = getAdjacentTextNodes(node);

        debugLog('Adjacent nodes found:', adjacentNodes.length);

        let combinedText = '';
        adjacentNodes.forEach((n, i) => {
            if (n.type === 'newline') {
                combinedText += n.preserveBackslash ? '\\\n' : '\n';
                debugLog(
                    `Node ${i}: newline${
                        n.preserveBackslash ? ' (preserved backslash)' : ''
                    }`
                );
            } else {
                combinedText += n.content;
                debugLog(`Node ${i}: "${n.content}"`);
            }
        });

        debugLog('Combined text:', combinedText);

        let hasDelimiter = false;
        for (const del of Object.values(DELIMITERS)) {
            if (combinedText.includes(del.start)) {
                hasDelimiter = true;
                break;
            }
        }
        if (!hasDelimiter) return;

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

        const parent = node.parentNode;
        if (parent) {
            adjacentNodes.forEach(n => {
                if (n.type === 'newline' && n.node.parentNode) {
                    n.node.parentNode.removeChild(n.node);
                } else if (n.type === 'text' && n.node && n.node.parentNode) {
                    n.node.parentNode.removeChild(n.node);
                }
            });

            const firstNode = adjacentNodes[0];
            if (firstNode && firstNode.node && firstNode.node.parentNode) {
                parent.insertBefore(wrapper, firstNode.node);
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
            processMath();

            const observer = new MutationObserver(mutations => {
                let shouldProcess = false;
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        shouldProcess = true;
                        break;
                    }
                }
                if (shouldProcess) {
                    debugLog('New nodes detected, processing...');
                    requestIdleCallback(processMath);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });

            debugLog('Initialization complete');
        } catch (error) {
            console.error('Error initializing LaTeX converter:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
