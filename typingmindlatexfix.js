(() => {
    const DELIMITERS = {
        DISPLAY_DOLLARS: { start: '$$', end: '$$', display: true },
        INLINE_DOLLARS: { start: '$', end: '$', display: false },
        DISPLAY_BRACKETS: { start: '\\[', end: '\\]', display: true },
        INLINE_PARENS: { start: '\\(', end: '\\)', display: false },
    };

    let state = {
        teXZillaLoaded: false,
    };

    function isInCodeBlock(element) {
        // Check for code blocks
        let parent = element;
        while (parent) {
            if (parent.tagName === 'PRE' || parent.tagName === 'CODE') {
                return true;
            }
            parent = parent.parentElement;
        }

        // Strict JSON detection
        const content = element.textContent.trim();
        if (
            (content.startsWith('[{') && content.endsWith('}]')) ||
            (content.startsWith('{') && content.endsWith('}'))
        ) {
            try {
                JSON.parse(content);
                return true;
            } catch {
                const jsonChars = (content.match(/[{}\[\]",:]/g) || []).length;
                return jsonChars / content.length > 0.1;
            }
        }

        return false;
    }

    function isLikelyLatex(content) {
    if (/^\s*\d+\s*$/.test(content)) {
        return false;
    }

    return (
        /[_^{}\\]/.test(content) ||                    // LaTeX syntax chars
        /\\[a-zA-Z]+/.test(content) ||                 // Actual LaTeX commands (\alpha, \frac)
        /[∫∑∏√∞±≤≥≠≈∝∂∇]/.test(content) ||           // Math symbols
        /[α-ωΑ-Ω]/.test(content) ||                    // Greek letters
        /\b(sin|cos|tan|log|ln|exp|lim|int|sum|prod)\b/.test(content) || // Math functions
        /\^[^a-zA-Z\s]/.test(content) ||               // Superscripts with symbols
        /_[^a-zA-Z\s]/.test(content)                   // Subscripts with symbols
    );
}


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
    function getAdjacentTextNodes(node) {
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

        return { nodes, text };
    }

    function findMatchingDelimiter(text, startPos) {
        // Helper function to find matching bracket considering nesting
        function findMatchingBracket(openBracket, closeBracket, pos) {
            let depth = 1;
            let i = pos + 1;
            while (i < text.length) {
                if (text[i] === openBracket && text[i - 1] !== '\\') {
                    depth++;
                } else if (text[i] === closeBracket && text[i - 1] !== '\\') {
                    depth--;
                    if (depth === 0) {
                        return i;
                    }
                }
                i++;
            }
            return -1;
        }

        // Check if content contains a valid dollar-sign expression
        function containsDollarExpression(content) {
            return /\$[^\$]+\$/.test(content);
        }

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

        // Handle escaped delimiters
        if (text.startsWith('\\[', startPos)) {
            const endPos = text.indexOf('\\]', startPos + 2);
            if (endPos !== -1) {
                const content = text.slice(startPos + 2, endPos);
                if (containsDollarExpression(content)) {
                    return null;
                }
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.DISPLAY_BRACKETS,
                    type: 'escaped',
                };
            }
        }

        if (text.startsWith('\\(', startPos)) {
            const endPos = text.indexOf('\\)', startPos + 2);
            if (endPos !== -1) {
                const content = text.slice(startPos + 2, endPos);
                if (containsDollarExpression(content)) {
                    return null;
                }
                return {
                    start: startPos,
                    end: endPos + 2,
                    delimiter: DELIMITERS.INLINE_PARENS,
                    type: 'escaped',
                };
            }
        }

        // Handle unescaped brackets that should be LaTeX
        if (text[startPos] === '[') {
            const endPos = findMatchingBracket('[', ']', startPos);
            if (endPos !== -1) {
                const content = text.slice(startPos + 1, endPos);
                // Don't process as LaTeX if it contains dollar expressions
                if (containsDollarExpression(content)) {
                    return null;
                }
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
            const endPos = findMatchingBracket('(', ')', startPos);
            if (endPos !== -1) {
                const content = text.slice(startPos + 1, endPos);
                // Don't process as LaTeX if it contains dollar expressions
                if (containsDollarExpression(content)) {
                    return null;
                }
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

        return segments;
    }

    function processMathExpression(match) {
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
            match.content.startsWith('\\[') &&
            match.content.endsWith('\\]')
        ) {
            latex = match.content.slice(2, -2).trim();
        } else if (
            match.content.startsWith('\\(') &&
            match.content.endsWith('\\)')
        ) {
            latex = match.content.slice(2, -2).trim();
        } else if (
            match.content.startsWith('[') &&
            match.content.endsWith(']')
        ) {
            latex = match.content.slice(1, -1).trim();
        } else if (
            match.content.startsWith('(') &&
            match.content.endsWith(')')
        ) {
            latex = match.content.slice(1, -1).trim();
        }

        if (!latex) {
            container.textContent = match.content;
            return container;
        }

        const mathML = TeXZilla.toMathML(latex, match.display);
        if (mathML) {
            container.innerHTML = new XMLSerializer().serializeToString(mathML);
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

        let hasDelimiter = false;
        if (
            text.includes('$') ||
            text.includes('\\[') ||
            text.includes('\\(') ||
            /\[[^\]]*[_^{}\\]/.test(text) ||
            /\([^)]*[_^{}\\]/.test(text)
        ) {
            hasDelimiter = true;
        }

        if (!hasDelimiter) {
            return;
        }

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
                if (n.node && n.node.parentNode) {
                    n.node.parentNode.removeChild(n.node);
                }
            });

            parent.appendChild(wrapper);
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
        await loadTeXZilla();
        injectStyles();
        processMath();

        const observer = new MutationObserver(mutations => {
            let shouldProcess = false;
            let newNodes = [];

            mutations.forEach(mutation => {
                if (mutation.type === 'characterData') {
                    const node = mutation.target;
                    if (
                        !node.parentElement?.closest('.math-processed') &&
                        !isInCodeBlock(node)
                    ) {
                        shouldProcess = true;
                        newNodes.push(node);
                    }
                }

                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (
                            !node.closest('.math-processed') &&
                            !isInCodeBlock(node)
                        ) {
                            shouldProcess = true;
                            newNodes.push(node);
                        }
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        if (
                            !node.parentElement?.closest('.math-processed') &&
                            !isInCodeBlock(node)
                        ) {
                            shouldProcess = true;
                            newNodes.push(node);
                        }
                    }
                });
            });

            if (shouldProcess) {
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
    }

    const LaTeXProcessor = {
        reprocess: function () {
            processMath();
        },

        processElement: function (element) {
            if (!element) {
                return;
            }

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
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    if (typeof window !== 'undefined') {
        window.LaTeXProcessor = LaTeXProcessor;
    }
})();
