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
                nodes.push({ type: 'newline', node: current.nextSibling });
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

        // Handle backslash delimiters (\[...\] and \(...\))
        if (text[startPos] === '\\') {
            for (const del of [
                DELIMITERS.DISPLAY_BRACKETS,
                DELIMITERS.INLINE_PARENS,
            ]) {
                if (text.startsWith(del.start, startPos)) {
                    let pos = startPos + del.start.length;
                    let escaped = false;

                    while (pos < text.length) {
                        if (text[pos] === '\\') {
                            if (!escaped) {
                                escaped = true;
                                pos++;
                                continue;
                            }
                        }

                        if (text.startsWith(del.end, pos) && !escaped) {
                            return {
                                start: startPos,
                                end: pos + del.end.length,
                                delimiter: del,
                            };
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

        text = text.replace(/\r\n/g, '\n');

        while (pos < text.length) {
            let found = false;

            if (
                (text[pos] === '$' || text[pos] === '\\') &&
                !(pos > 0 && text[pos - 1] === '\\')
            ) {
                const match = findMatchingDelimiter(text, pos);
                if (match) {
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

        return segments;
    }

    function processMathExpression(match, isDisplay) {
        const container = document.createElement('span');
        container.className = 'math-container math-processed';
        if (isDisplay) {
            container.setAttribute('data-display', 'block');
        }

        let latex;
        for (const del of Object.values(DELIMITERS)) {
            if (match.startsWith(del.start) && match.endsWith(del.end)) {
                latex = match.slice(del.start.length, -del.end.length);
                break;
            }
        }

        if (!latex) {
            container.textContent = match;
            return container;
        }

        const mathML = convertToMathML(latex, isDisplay);
        if (mathML) {
            container.innerHTML = mathML;
        } else {
            container.textContent = match;
        }

        return container;
    }

    function processNode(node) {
        if (!node || node.nodeType !== Node.TEXT_NODE || isInCodeBlock(node)) {
            return;
        }

        const adjacentNodes = getAdjacentTextNodes(node);
        let combinedText = '';

        adjacentNodes.forEach(n => {
            if (n.type === 'newline') {
                combinedText += '\n';
            } else {
                combinedText += n.textContent;
            }
        });

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
                    segment.content,
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
        return nodes;
    }

    function processMath() {
        const nodes = findTextNodes();
        if (nodes.length > 0) {
            processNodes(nodes);
        }
    }

    // Initialize the extension
    async function initialize() {
        try {
            await loadTeXZilla();
            injectStyles();
            processMath();

            // Set up mutation observer for dynamic content
            const observer = new MutationObserver(mutations => {
                let shouldProcess = false;
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length > 0) {
                        shouldProcess = true;
                        break;
                    }
                }
                if (shouldProcess) {
                    requestIdleCallback(processMath);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        } catch (error) {
            console.error('Error initializing LaTeX converter:', error);
        }
    }

    // Start the extension
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
