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

    function reconstructDelimiters(text) {
        // First, handle existing dollar delimiters (preserve them)
        const segments = [];
        let pos = 0;
        let lastPos = 0;

        while (pos < text.length) {
            if (text[pos] === '$') {
                if (pos + 1 < text.length && text[pos + 1] === '$') {
                    // Found $$, skip to end
                    const endPos = text.indexOf('$$', pos + 2);
                    if (endPos !== -1) {
                        if (pos > lastPos)
                            segments.push(text.slice(lastPos, pos));
                        segments.push(text.slice(pos, endPos + 2));
                        pos = endPos + 2;
                        lastPos = pos;
                        continue;
                    }
                } else {
                    // Found single $, skip to end
                    const endPos = text.indexOf('$', pos + 1);
                    if (endPos !== -1) {
                        if (pos > lastPos)
                            segments.push(text.slice(lastPos, pos));
                        segments.push(text.slice(pos, endPos + 1));
                        pos = endPos + 1;
                        lastPos = pos;
                        continue;
                    }
                }
            }
            pos++;
        }

        if (lastPos < text.length) {
            segments.push(text.slice(lastPos));
        }

        // Now process each non-dollar segment for brackets and parentheses
        return segments
            .map(segment => {
                if (segment.startsWith('$')) {
                    return segment; // Preserve dollar segments as-is
                }

                // Handle display brackets
                segment = segment.replace(
                    /\[([\s\S]*?)\]/g,
                    (match, content) => {
                        // Verify this isn't part of a command or other LaTeX construct
                        if (
                            content.includes('\n') ||
                            /^[^{}\[\]]*$/.test(content)
                        ) {
                            return `\\[${content}\\]`;
                        }
                        return match;
                    }
                );

                // Handle inline parentheses
                segment = segment.replace(
                    /\(([\s\S]*?)\)/g,
                    (match, content) => {
                        // Verify this isn't part of a command or other LaTeX construct
                        if (
                            content.includes('\n') ||
                            /^[^{}\[\]]*$/.test(content)
                        ) {
                            return `\\(${content}\\)`;
                        }
                        return match;
                    }
                );

                return segment;
            })
            .join('');
    }

    function getAdjacentTextNodes(node) {
        const nodes = [];
        let current = node;
        let text = '';

        // Collect preceding text nodes
        while (current.previousSibling) {
            if (current.previousSibling.nodeType === Node.TEXT_NODE) {
                text = current.previousSibling.textContent + text;
                nodes.unshift(current.previousSibling);
            } else if (
                current.previousSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.previousSibling.tagName)
            ) {
                text = '\n' + text;
                nodes.unshift(current.previousSibling);
            } else {
                break;
            }
            current = current.previousSibling;
        }

        // Add current node
        text += node.textContent;
        nodes.push(node);

        // Collect following text nodes
        current = node;
        while (current.nextSibling) {
            if (current.nextSibling.nodeType === Node.TEXT_NODE) {
                text += current.nextSibling.textContent;
                nodes.push(current.nextSibling);
            } else if (
                current.nextSibling.nodeType === Node.ELEMENT_NODE &&
                ['BR', 'DIV', 'P'].includes(current.nextSibling.tagName)
            ) {
                text += '\n';
                nodes.push(current.nextSibling);
            } else {
                break;
            }
            current = current.nextSibling;
        }

        // Reconstruct delimiters in the combined text
        const reconstructedText = reconstructDelimiters(text);

        return {
            nodes: nodes,
            text: reconstructedText,
        };
    }

    function findMatchingDelimiter(text, startPos) {
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

    function processMathExpression(match) {
        const container = document.createElement('span');
        container.className = 'math-container math-processed';
        if (match.display) {
            container.setAttribute('data-display', 'block');
        }

        let latex;
        if (match.content.startsWith('$$') && match.content.endsWith('$$')) {
            latex = match.content.slice(2, -2);
        } else if (
            match.content.startsWith('$') &&
            match.content.endsWith('$')
        ) {
            latex = match.content.slice(1, -1);
        } else if (
            match.content.startsWith('\\[') &&
            match.content.endsWith('\\]')
        ) {
            latex = match.content.slice(2, -2);
        } else if (
            match.content.startsWith('\\(') &&
            match.content.endsWith('\\)')
        ) {
            latex = match.content.slice(2, -2);
        }

        if (!latex) {
            container.textContent = match.content;
            return container;
        }

        const mathML = convertToMathML(latex.trim(), match.display);
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

        const { nodes, text } = getAdjacentTextNodes(node);

        // Check for any math delimiters
        let hasDelimiter = false;
        for (const del of Object.values(DELIMITERS)) {
            if (text.includes(del.start)) {
                hasDelimiter = true;
                break;
            }
        }

        if (!hasDelimiter) return;

        const segments = findMathDelimiters(text);
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
                const mathElement = processMathExpression(segment);
                if (mathElement) {
                    wrapper.appendChild(mathElement);
                }
            }
        });

        const parent = node.parentNode;
        if (parent) {
            nodes.forEach(n => {
                if (n.parentNode) {
                    n.parentNode.removeChild(n);
                }
            });
            parent.insertBefore(wrapper, nodes[0]);
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

    async function initialize() {
        try {
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
