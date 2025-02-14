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

        // Get preceding text nodes
        while (current.previousSibling) {
            if (current.previousSibling.nodeType === Node.TEXT_NODE) {
                debugLog(
                    'Found preceding text node:',
                    current.previousSibling.textContent
                );
                nodes.unshift(current.previousSibling);
            } else if (
                current.previousSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.previousSibling.tagName)
            ) {
                debugLog(
                    'Found preceding newline node:',
                    current.previousSibling.tagName
                );
                nodes.unshift({
                    type: 'newline',
                    node: current.previousSibling,
                    preserveBackslash: current.previousSibling.textContent
                        .trim()
                        .endsWith('\\'),
                });
            } else {
                break;
            }
            current = current.previousSibling;
        }

        nodes.push(node);
        debugLog('Added current node:', node.textContent);

        // Get following text nodes
        current = node;
        while (current.nextSibling) {
            if (current.nextSibling.nodeType === Node.TEXT_NODE) {
                debugLog(
                    'Found following text node:',
                    current.nextSibling.textContent
                );
                nodes.push(current.nextSibling);
            } else if (
                current.nextSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.nextSibling.tagName)
            ) {
                debugLog(
                    'Found following newline node:',
                    current.nextSibling.tagName
                );
                nodes.push({
                    type: 'newline',
                    node: current.nextSibling,
                    preserveBackslash: current.nextSibling.textContent
                        .trim()
                        .startsWith('\\'),
                });
            } else {
                break;
            }
            current = current.nextSibling;
        }

        debugLog('Total nodes found:', nodes.length);
        return nodes;
    }

    function findMatchingDelimiter(text, startPos) {
        debugLog('Finding delimiter at position:', startPos);
        debugLog('Text snippet:', text.substr(startPos, 20));

        if (text[startPos] === '\\') {
            debugLog('Found backslash delimiter');
            debugLog('Full text being processed:', text);

            // Log character codes for debugging
            const nextFewChars = Array.from(text.substr(startPos, 10)).map(
                c => ({
                    char: c,
                    code: c.charCodeAt(0),
                })
            );
            debugLog('Character codes:', nextFewChars);

            for (const del of [
                DELIMITERS.DISPLAY_BRACKETS,
                DELIMITERS.INLINE_PARENS,
            ]) {
                if (text.substring(startPos).startsWith(del.start)) {
                    debugLog('Matched start delimiter:', del.start);
                    let pos = startPos + del.start.length;
                    let bracketCount = 1;

                    while (pos < text.length) {
                        if (text.substring(pos).startsWith(del.end)) {
                            bracketCount--;
                            if (bracketCount === 0) {
                                debugLog(
                                    'Found matching end delimiter at:',
                                    pos
                                );
                                return {
                                    start: startPos,
                                    end: pos + del.end.length,
                                    delimiter: del,
                                };
                            }
                        }
                        pos++;
                    }
                }
            }
        }

        // Handle dollars
        if (text.startsWith('$$', startPos)) {
            debugLog('Found display dollars');
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
            debugLog('Found inline dollars');
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

        text = text.replace(/\r\n/g, '\n');

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
        for (const del of Object.values(DELIMITERS)) {
            if (
                match.content.startsWith(del.start) &&
                match.content.endsWith(del.end)
            ) {
                latex = match.content.slice(del.start.length, -del.end.length);
                debugLog('Extracted LaTeX:', latex);
                break;
            }
        }

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

        // Debug logging for adjacent nodes
        debugLog('Adjacent nodes found:', adjacentNodes.length);
        adjacentNodes.forEach((n, i) => {
            if (n.type === 'newline') {
                debugLog(`Node ${i}: newline`);
            } else {
                debugLog(`Node ${i}: "${n.textContent}"`);
            }
        });

        let combinedText = '';
        let lastWasNewline = false;

        adjacentNodes.forEach(n => {
            if (n.type === 'newline') {
                combinedText += '\n';
                lastWasNewline = true;
            } else {
                if (lastWasNewline && n.textContent.startsWith('\\')) {
                    combinedText += n.textContent;
                } else {
                    combinedText += n.textContent;
                }
                lastWasNewline = false;
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
