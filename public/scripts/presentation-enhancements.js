/* Optional motion and compile-time document typography. */
(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.MagiumPresentationEnhancements = api;
    root.setAnimationEffects = api.setAnimationEffects;
    root.initializeAnimationEffectsText = api.initializeAnimationEffectsText;
    // Compatibility for an existing saved page while an offline artifact is updating.
    root.setGentleTransitions = api.setAnimationEffects;
    root.initializeGentleTransitionsText = api.initializeAnimationEffectsText;
    root.setContextualTypography = api.setContextualTypography;
    root.initializeContextualTypographyText = api.initializeContextualTypographyText;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const MOTION_KEY = 'magium.preference.animation-effects';
    const LEGACY_MOTION_KEY = 'magium.preference.gentle-transitions';
    const TYPOGRAPHY_KEY = 'magium.preference.contextual-typography';
    const OWNED = 'data-magium-document-typography';
    const WORD_OWNED = 'data-magium-word-reveal';
    const ROLES = new Set(['handwritten', 'inscription', 'formal-document', 'verse']);
    const state = {container: null, metadata: null, getLocale: null, sceneId: '', locale: '', revealTimer: null, revealQueued: false};

    function storageGet(key) {
        try { return root.localStorage && root.localStorage.getItem(key); } catch (error) { return null; }
    }
    function storageSet(key, value) {
        try { root.localStorage && root.localStorage.setItem(key, value); } catch (error) { /* Presentation settings may fail closed. */ }
    }
    function motionPreference() {
        const saved = storageGet(MOTION_KEY);
        return saved == null ? storageGet(LEGACY_MOTION_KEY) : saved;
    }
    function enabled(value) {
        return value === true || /^(?:1|true|on|enabled)$/i.test(String(value || '').trim());
    }
    function updateSelect(id, value) {
        const element = root.document && root.document.getElementById(id);
        if (element) element.value = value ? 'on' : 'off';
    }
    function reducedMotion() {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function applyRootClasses() {
        if (!root.document) return;
        const motion = enabled(motionPreference()) && !reducedMotion();
        const typography = enabled(storageGet(TYPOGRAPHY_KEY));
        root.document.documentElement.classList.toggle('animation-effects-enabled', motion);
        root.document.documentElement.classList.toggle('contextual-typography-enabled', typography);
    }
    function setAnimationEffects(value) {
        storageSet(MOTION_KEY, enabled(value) ? 'on' : 'off');
        applyRootClasses();
        initializeAnimationEffectsText();
        if (!enabled(value)) finishWordReveal();
    }
    function setContextualTypography(value) {
        storageSet(TYPOGRAPHY_KEY, enabled(value) ? 'on' : 'off');
        applyRootClasses();
        initializeContextualTypographyText();
        queueApplyTypography();
    }
    function initializeAnimationEffectsText() {
        updateSelect('animationEffectsDropdown', enabled(motionPreference()));
    }
    function initializeContextualTypographyText() {
        updateSelect('contextualTypographyDropdown', enabled(storageGet(TYPOGRAPHY_KEY)));
    }

    function clearTypography() {
        if (!state.container) return;
        // Only unwrap the inline segment spans this module created. A full-line
        // record marks the existing reading-enhancements paragraph wrapper with
        // OWNED="paragraph"; unwrapping that span would destroy the story
        // paragraph and prevent the section from ever being styled again.
        for (const span of [...state.container.querySelectorAll(`span[${OWNED}="segment"]`)]) span.replaceWith(...span.childNodes);
        for (const element of state.container.querySelectorAll(`[${OWNED}]`)) {
            element.classList.remove('document-style-handwritten', 'document-style-inscription', 'document-style-formal-document', 'document-style-verse', 'document-style-full');
            element.removeAttribute('data-document-role');
            element.removeAttribute(OWNED);
        }
        state.container.normalize();
    }

    function textNodes(element) {
        const walker = root.document.createTreeWalker(element, root.NodeFilter.SHOW_TEXT);
        const nodes = [];
        let offset = 0, node;
        while ((node = walker.nextNode())) {
            const end = offset + node.data.length;
            nodes.push({node, start: offset, end});
            offset = end;
        }
        return nodes;
    }

    function wrapSegment(paragraph, segment) {
        const nodes = textNodes(paragraph);
        for (const item of nodes) {
            const start = Math.max(segment.start, item.start);
            const end = Math.min(segment.end, item.end);
            if (end <= start) continue;
            const range = root.document.createRange();
            range.setStart(item.node, start - item.start);
            range.setEnd(item.node, end - item.start);
            const span = root.document.createElement('span');
            span.className = `document-style-${segment.role}`;
            span.setAttribute(OWNED, 'segment');
            span.dataset.documentRole = segment.role;
            range.surroundContents(span);
        }
    }

    function applyTypography() {
        clearTypography();
        if (!state.container || !state.metadata || !enabled(storageGet(TYPOGRAPHY_KEY))) return false;
        if (!root.document.documentElement.classList.contains('reading-mode-book')) return false;
        const locale = state.locale || (state.getLocale && state.getLocale()) || root.document.documentElement.lang;
        if (locale !== 'en' && locale !== 'zh-CN') return false;
        const scene = state.metadata.locales && state.metadata.locales[locale] && state.metadata.locales[locale].scenes[state.sceneId];
        if (!scene) return false;
        let applied = false;
        for (const record of scene.paragraphs || []) {
            const paragraph = state.container.querySelector(`.story-paragraph[data-story-paragraph-index="${record.index}"]`);
            if (!paragraph || paragraph.textContent !== record.text) continue;
            const segments = (record.segments || []).filter(segment => ROLES.has(segment.role) && Number.isInteger(segment.start) && Number.isInteger(segment.end) && segment.start >= 0 && segment.end > segment.start && segment.end <= record.text.length);
            if (!segments.length) continue;
            const one = segments.length === 1 && segments[0].start === 0 && segments[0].end === record.text.length;
            if (one) {
                paragraph.classList.add(`document-style-${segments[0].role}`, 'document-style-full');
                paragraph.setAttribute(OWNED, 'paragraph');
                paragraph.dataset.documentRole = segments[0].role;
            } else {
                for (const segment of [...segments].sort((a, b) => b.start - a.start || b.end - a.end)) wrapSegment(paragraph, segment);
            }
            applied = true;
        }
        return applied;
    }

    function queueApplyTypography() {
        const schedule = root.queueMicrotask || (callback => Promise.resolve().then(callback));
        schedule(applyTypography);
    }

    function finishWordReveal() {
        if (state.revealTimer != null && typeof root.clearTimeout === 'function') root.clearTimeout(state.revealTimer);
        state.revealTimer = null;
        if (!state.container) return;
        const parents = new Set();
        for (const span of [...state.container.querySelectorAll(`[${WORD_OWNED}]`)]) {
            if (span.parentNode) parents.add(span.parentNode);
            span.replaceWith(...span.childNodes);
        }
        for (const parent of parents) if (parent && typeof parent.normalize === 'function') parent.normalize();
    }

    function storyTextNodes() {
        if (!state.container) return [];
        const paragraphs = [...state.container.querySelectorAll('.story-paragraph')];
        const roots = paragraphs.length ? paragraphs : [state.container];
        const output = [];
        for (const target of roots) {
            const walker = root.document.createTreeWalker(target, root.NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (!node.data || !/\S/.test(node.data)) continue;
                const parent = node.parentElement;
                if (!parent || parent.closest('.response,.stat_success,.stat_fail,.achievement-modal,button,select,option,script,style')) continue;
                output.push(node);
            }
        }
        return output;
    }

    function revealParts(text, locale, segmenter) {
        if (locale === 'zh-CN') {
            if (segmenter) return [...segmenter.segment(text)].map(part => part.segment);
            // Older WebViews without Intl.Segmenter must retain normal CJK line
            // breaking instead of treating an entire coloured run as one word.
            return Array.from(text);
        }
        return text.split(/(\s+)/);
    }

    function animateStoryWords() {
        finishWordReveal();
        if (!state.container || !state.sceneId || !enabled(motionPreference()) || reducedMotion()) return false;
        const nodes = storyTextNodes();
        const locale = state.locale || (state.getLocale && state.getLocale()) || root.document.documentElement.lang;
        let segmenter = null;
        if (locale === 'zh-CN' && root.Intl && typeof root.Intl.Segmenter === 'function') {
            try { segmenter = new root.Intl.Segmenter('zh-CN', {granularity: 'word'}); } catch (error) { segmenter = null; }
        }
        const nodeParts = nodes.map(node => revealParts(node.data, locale, segmenter));
        const wordCount = nodeParts.reduce((count, parts) => count + parts.filter(part => /\S/.test(part)).length, 0);
        if (!wordCount) return false;
        // Preserve a visible one-by-one cadence for short passages while
        // bounding long scenes so choices are never held behind a long reveal.
        const step = wordCount > 1 ? Math.min(52, 2400 / (wordCount - 1)) : 0;
        let wordIndex = 0;
        for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
            const node = nodes[nodeIndex];
            const fragment = root.document.createDocumentFragment();
            for (const part of nodeParts[nodeIndex]) {
                if (!part) continue;
                if (/^\s+$/.test(part)) {
                    fragment.append(root.document.createTextNode(part));
                    continue;
                }
                const span = root.document.createElement('span');
                span.className = 'magium-word-reveal';
                span.setAttribute(WORD_OWNED, 'word');
                span.style.setProperty('--magium-word-delay', `${Math.round(wordIndex * step)}ms`);
                span.textContent = part;
                fragment.append(span);
                wordIndex++;
            }
            node.replaceWith(fragment);
        }
        if (typeof root.setTimeout === 'function') state.revealTimer = root.setTimeout(finishWordReveal, Math.round((wordCount - 1) * step) + 180);
        return true;
    }

    function queueStoryPresentation() {
        if (state.revealQueued) return;
        state.revealQueued = true;
        const schedule = root.queueMicrotask || (callback => Promise.resolve().then(callback));
        schedule(() => {
            state.revealQueued = false;
            applyTypography();
            animateStoryWords();
        });
    }

    function onRender(event) {
        const detail = event && event.detail || {};
        state.sceneId = detail.sceneId || '';
        state.locale = detail.locale || '';
        queueStoryPresentation();
        initializeAnimationEffectsText();
        initializeContextualTypographyText();
    }

    function initialize(options) {
        options = options || {};
        state.container = options.container || (root.document && root.document.getElementById('content'));
        state.metadata = options.metadata || null;
        state.getLocale = typeof options.getLocale === 'function' ? options.getLocale : null;
        applyRootClasses();
        initializeAnimationEffectsText();
        initializeContextualTypographyText();
        return api;
    }

    if (root.document) {
        root.document.addEventListener('DOMContentLoaded', () => {
            if (!state.container) state.container = root.document.getElementById('content');
            applyRootClasses(); initializeAnimationEffectsText(); initializeContextualTypographyText();
        });
        root.document.addEventListener('magium:render', onRender);
        root.document.addEventListener('magium:reading-preference-change', () => { finishWordReveal(); queueApplyTypography(); });
        root.document.addEventListener('click', finishWordReveal, true);
        root.document.addEventListener('htmx:afterSwap', event => {
            if (!event.detail || !event.detail.target || event.detail.target.id === 'content') {
                if (!state.container) state.container = root.document.getElementById('content');
                state.sceneId = state.container && state.container.querySelector('.response button[hx-post="/"]') ? 'server-story' : '';
                queueStoryPresentation();
            }
            initializeAnimationEffectsText();
            initializeContextualTypographyText();
        });
    }

    const api = {initialize, setAnimationEffects, initializeAnimationEffectsText, setContextualTypography, initializeContextualTypographyText, applyTypography, clearTypography, animateStoryWords, finishWordReveal};
    return api;
});
