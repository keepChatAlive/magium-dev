/*
 * Presentation-only reading enhancements for precomputed Magium metadata.
 *
 * This module deliberately performs no speaker detection. A story fragment is
 * decorated only after its locale, scene id, ordered line index, exact text,
 * and every supplied range have matched the build-time metadata.
 */
(function (root, factory) {
    'use strict';

    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.MagiumReadingEnhancements = api;

    // Keep small compatibility entry points for EJS settings controls. Do not
    // replace an application-provided handler when one already exists.
    if (!root.initializeReadingEnhancements) root.initializeReadingEnhancements = api.initialize;
    if (!root.initializeDialogueColorsText) root.initializeDialogueColorsText = api.initializeDialogueColorsText;
    if (!root.initializeSemanticDialogueColorsText) root.initializeSemanticDialogueColorsText = api.initializeSemanticDialogueColorsText;
    if (!root.setDialogueColors) root.setDialogueColors = api.setDialogueColors;
    if (!root.setSemanticDialogueColors) root.setSemanticDialogueColors = api.setSemanticDialogueColors;
    if (!root.toggleSemanticDialogueColors) root.toggleSemanticDialogueColors = api.toggleSemanticDialogueColors;
    if (!root.setReadingMode) root.setReadingMode = api.setReadingMode;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const DIALOGUE_STORAGE_KEY = 'magium.preference.dialogue-colors';
    const SEMANTIC_DIALOGUE_STORAGE_KEY = 'magium.preference.semantic-dialogue-colors';
    const READING_MODE_STORAGE_KEY = 'magium.preference.reading-mode';
    const OWNED_ATTRIBUTE = 'data-magium-reading-enhancement';
    const SPEAKER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
    const COLOR_TOKEN = /^[a-z][a-z0-9-]{0,31}$/i;
    const ALLOWED_KINDS = new Set(['dialogue', 'speaker']);
    const state = {
        initialized: false,
        container: null,
        metadata: null,
        semanticMetadata: null,
        sceneId: '',
        locale: '',
        unitIndices: null,
        getSceneId: null,
        getLocale: null,
    };

    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    function storage() {
        try {
            return root.localStorage || null;
        } catch (error) {
            return null;
        }
    }

    function readStored(key) {
        const target = storage();
        if (!target) return null;
        try {
            return target.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function writeStored(key, value) {
        const target = storage();
        if (!target) return false;
        try {
            target.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function dialogueEnabled(value) {
        if (value === true) return true;
        if (value === false || value == null) return false;
        return /^(?:1|true|on|enabled)$/i.test(String(value).trim());
    }

    function readingMode(value) {
        return String(value || '').toLowerCase() === 'book' ? 'book' : 'original';
    }

    function preferences(overrides) {
        overrides = overrides || {};
        return {
            dialogueColors: own(overrides, 'dialogueColors')
                ? dialogueEnabled(overrides.dialogueColors)
                : dialogueEnabled(readStored(DIALOGUE_STORAGE_KEY)),
            semanticDialogueColors: own(overrides, 'semanticDialogueColors')
                ? dialogueEnabled(overrides.semanticDialogueColors)
                : dialogueEnabled(readStored(SEMANTIC_DIALOGUE_STORAGE_KEY)),
            readingMode: own(overrides, 'readingMode')
                ? readingMode(overrides.readingMode)
                : readingMode(readStored(READING_MODE_STORAGE_KEY)),
        };
    }

    function defaultMetadata() {
        return root.MAGIUM_READING_METADATA
            || (root.MAGIUM_DATA && (root.MAGIUM_DATA.readingEnhancements || root.MAGIUM_DATA.readingMetadata))
            || null;
    }

    function defaultSemanticMetadata() {
        return root.MAGIUM_SEMANTIC_READING_METADATA
            || (root.MAGIUM_DATA && root.MAGIUM_DATA.semanticReadingEnhancements)
            || null;
    }

    function localeScenes(metadata, locale) {
        if (!metadata || metadata.version !== 1 || !metadata.locales || !own(metadata.locales, locale)) return null;
        const localeData = metadata.locales[locale];
        return localeData && localeData.scenes && typeof localeData.scenes === 'object' ? localeData.scenes : null;
    }

    function sceneMetadata(metadata, locale, sceneId) {
        const scenes = localeScenes(metadata, locale);
        if (!scenes || !sceneId || !own(scenes, sceneId)) return null;
        const scene = scenes[sceneId];
        return scene && Array.isArray(scene.paragraphs) ? scene : null;
    }

    function speakerRegistry(metadata, locale) {
        if (!metadata || !metadata.speakers) return null;
        if (metadata.speakers && typeof metadata.speakers === 'object' && !Array.isArray(metadata.speakers)) {
            if (metadata.speakers[locale] && typeof metadata.speakers[locale] === 'object') return metadata.speakers[locale];
            return metadata.speakers;
        }
        return null;
    }

    function validateRecord(record, registry) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
        if (!Number.isSafeInteger(record.index) || record.index < 0 || typeof record.text !== 'string' || !record.text.length) return null;
        if (!Array.isArray(record.segments)) return null;

        const segments = [];
        for (let position = 0; position < record.segments.length; position += 1) {
            const segment = record.segments[position];
            if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return null;
            const kind = segment.kind == null ? 'dialogue' : segment.kind;
            if (!ALLOWED_KINDS.has(kind)
                || !Number.isSafeInteger(segment.start)
                || !Number.isSafeInteger(segment.end)
                || segment.start < 0
                || segment.end <= segment.start
                || segment.end > record.text.length
                || typeof segment.speaker !== 'string'
                || !SPEAKER_ID.test(segment.speaker)) return null;
            if (registry && !own(registry, segment.speaker)) return null;
            if (own(segment, 'text') && segment.text !== record.text.slice(segment.start, segment.end)) return null;
            segments.push({
                start: segment.start,
                end: segment.end,
                speaker: segment.speaker,
                kind,
                position,
            });
        }

        segments.sort((left, right) => left.start - right.start || left.end - right.end);
        for (let index = 1; index < segments.length; index += 1) {
            if (segments[index].start < segments[index - 1].end) return null;
        }
        return {index: record.index, text: record.text, segments};
    }

    function validatedRecords(scene, registry) {
        const records = new Map(), duplicateIndexes = new Set();
        for (const raw of scene.paragraphs) {
            const record = validateRecord(raw, registry);
            if (!record) continue;
            if (records.has(record.index)) {
                records.delete(record.index);
                duplicateIndexes.add(record.index);
            } else if (!duplicateIndexes.has(record.index)) {
                records.set(record.index, record);
            }
        }
        return records;
    }

    function directStoryUnits(container, sourceIndices) {
        const units = [];
        if (!container || !container.childNodes) return units;
        for (const node of Array.from(container.childNodes)) {
            if (node.nodeType === 1 && node.classList && node.classList.contains('response')) break;
            if (node.nodeType !== 3) continue;
            const raw = node.data;
            const text = raw.trim();
            if (!text) continue;
            const start = raw.length - raw.trimStart().length;
            const end = raw.length - (raw.length - raw.trimEnd().length);
            units.push({node, raw, text, start, end, index: units.length});
        }
        if (Array.isArray(sourceIndices)) {
            const valid = sourceIndices.length === units.length
                && sourceIndices.every(index => Number.isSafeInteger(index) && index >= 0)
                && new Set(sourceIndices).size === sourceIndices.length;
            for (let position = 0; position < units.length; position += 1) {
                units[position].index = valid ? sourceIndices[position] : null;
            }
        }
        return units;
    }

    function unwrap(element) {
        const parent = element && element.parentNode;
        if (!parent) return;
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        parent.removeChild(element);
        parent.normalize();
    }

    function clear(container) {
        if (!container) return;
        for (const span of Array.from(container.querySelectorAll('[' + OWNED_ATTRIBUTE + '="speaker"]'))) unwrap(span);
        for (const paragraph of Array.from(container.querySelectorAll('[' + OWNED_ATTRIBUTE + '="paragraph"]'))) unwrap(paragraph);
        for (const separator of Array.from(container.querySelectorAll('[' + OWNED_ATTRIBUTE + '="paragraph-break"]'))) {
            separator.classList.remove('story-paragraph-break');
            if (!separator.getAttribute('class')) separator.removeAttribute('class');
            separator.removeAttribute(OWNED_ATTRIBUTE);
        }
        container.classList.remove('story-view', 'chapter-opening');
        container.removeAttribute('data-reading-scene');
        const documentElement = container.ownerDocument && container.ownerDocument.documentElement;
        if (documentElement) documentElement.classList.remove('chapter-opening-active');
    }

    function isolateText(unit, className, attributes) {
        let node = unit.node;
        if (unit.end < node.data.length) node.splitText(unit.end);
        if (unit.start > 0) node = node.splitText(unit.start);
        const document = node.ownerDocument;
        const wrapper = document.createElement('span');
        wrapper.className = className;
        for (const [name, value] of Object.entries(attributes || {})) wrapper.setAttribute(name, String(value));
        node.parentNode.replaceChild(wrapper, node);
        wrapper.appendChild(node);
        return {wrapper, node};
    }

    function isolateTrimmedText(unit) {
        let node = unit.node;
        if (unit.end < node.data.length) node.splitText(unit.end);
        if (unit.start > 0) node = node.splitText(unit.start);
        return node;
    }

    function wrapSegment(textNode, segment, registry) {
        let selected = textNode;
        if (segment.end < selected.data.length) selected.splitText(segment.end);
        if (segment.start > 0) selected = selected.splitText(segment.start);
        const wrapper = selected.ownerDocument.createElement('span');
        wrapper.className = segment.kind === 'speaker' ? 'speaker-name' : 'speaker-dialogue';
        wrapper.setAttribute(OWNED_ATTRIBUTE, 'speaker');
        wrapper.setAttribute('data-speaker', segment.speaker);
        wrapper.setAttribute('data-speaker-kind', segment.kind);
        wrapper.setAttribute('data-speaker-segment', String(segment.position));
        const definition = registry && registry[segment.speaker];
        if (definition && COLOR_TOKEN.test(definition.colorToken || '')) {
            wrapper.setAttribute('data-speaker-color', definition.colorToken);
        }
        selected.parentNode.replaceChild(wrapper, selected);
        wrapper.appendChild(selected);
        return wrapper;
    }

    function markFollowingBreaks(wrapper) {
        let node = wrapper.nextSibling;
        while (node) {
            if (node.nodeType === 3 && !node.data.trim()) {
                node = node.nextSibling;
                continue;
            }
            if (node.nodeType === 1 && node.tagName === 'BR') {
                node.classList.add('story-paragraph-break');
                node.setAttribute(OWNED_ATTRIBUTE, 'paragraph-break');
                node = node.nextSibling;
                continue;
            }
            break;
        }
    }

    function chapterOpeningCandidates(metadata, scene, sceneId, locale) {
        if (metadata && metadata.chapterOpenings && !Array.isArray(metadata.chapterOpenings)) {
            const byScene = metadata.chapterOpenings[sceneId];
            const record = byScene && byScene[locale];
            if (record && Array.isArray(record.candidates)) {
                const candidates = [], seen = new Set();
                for (const candidate of record.candidates) {
                    if (!candidate
                        || !Number.isSafeInteger(candidate.paragraphIndex)
                        || candidate.paragraphIndex < 0
                        || seen.has(candidate.paragraphIndex)
                        || (candidate.dropCap !== undefined && typeof candidate.dropCap !== 'boolean')) return [];
                    seen.add(candidate.paragraphIndex);
                    candidates.push({paragraphIndex: candidate.paragraphIndex, dropCap: candidate.dropCap === true});
                }
                return candidates;
            }
            if (record
                && Number.isSafeInteger(record.paragraphIndex)
                && record.paragraphIndex >= 0
                && (record.dropCap === undefined || typeof record.dropCap === 'boolean')) {
                return [{paragraphIndex: record.paragraphIndex, dropCap: record.dropCap === true}];
            }
            return [];
        }
        // Backward-compatible support for early generated metadata drafts.
        if (scene.chapterOpening === true
            || (Array.isArray(metadata.chapterOpenings) && metadata.chapterOpenings.includes(sceneId))) {
            const first = scene.paragraphs.find(record => record && record.index === 0);
            return [{paragraphIndex: 0, dropCap: scene.dropCap === true || Boolean(first && first.dropCap === true)}];
        }
        return [];
    }

    function context(options) {
        options = options || {};
        const container = options.container || state.container || (root.document && root.document.getElementById('content')) || null;
        const metadata = options.metadata || state.metadata || defaultMetadata();
        const semanticMetadata = options.semanticMetadata || state.semanticMetadata || defaultSemanticMetadata();
        const sceneId = own(options, 'sceneId')
            ? options.sceneId
            : ((container && container.dataset && container.dataset.sceneId)
                || (typeof state.getSceneId === 'function' && state.getSceneId())
                || state.sceneId
                || '');
        const locale = own(options, 'locale')
            ? options.locale
            : ((typeof state.getLocale === 'function' && state.getLocale())
                || (container && container.ownerDocument && container.ownerDocument.documentElement.lang)
                || state.locale
                || 'en');
        const unitIndices = own(options, 'unitIndices') ? options.unitIndices : state.unitIndices;
        state.container = container;
        state.metadata = metadata;
        state.semanticMetadata = semanticMetadata;
        state.sceneId = sceneId;
        state.locale = locale;
        state.unitIndices = unitIndices;
        return {container, metadata, semanticMetadata, sceneId, locale, unitIndices};
    }

    function apply(container, options) {
        if (container && !container.nodeType && typeof container === 'object') {
            options = container;
            container = options.container;
        }
        options = options || {};
        const current = context(Object.assign({}, options, container ? {container} : null));
        const selected = preferences(options);
        const report = {matched: 0, decorated: 0, skipped: 0, chapterOpening: false};

        // Reapplication and disabling both start from the original story nodes.
        clear(current.container);
        if (!current.container || (!selected.dialogueColors && selected.readingMode !== 'book')) return report;

        const scene = sceneMetadata(current.metadata, current.locale, current.sceneId);
        if (!scene) return report;
        const registry = speakerRegistry(current.metadata, current.locale);
        const records = validatedRecords(scene, registry);
        const semanticScene = selected.semanticDialogueColors
            ? sceneMetadata(current.semanticMetadata, current.locale, current.sceneId)
            : null;
        const semanticRecords = semanticScene ? validatedRecords(semanticScene, registry) : new Map();
        const units = directStoryUnits(current.container, current.unitIndices);
        const matched = new Map();

        for (const unit of units) {
            const record = records.get(unit.index) || semanticRecords.get(unit.index);
            if (!record || unit.text !== record.text) {
                report.skipped += 1;
                continue;
            }
            matched.set(unit.index, record);
            report.matched += 1;
        }

        const book = selected.readingMode === 'book';
        for (const unit of units) {
            const record = matched.get(unit.index);
            let textNode = unit.node, paragraph = null;
            if (book) {
                const paragraphAttributes = {[OWNED_ATTRIBUTE]: 'paragraph'};
                if (Number.isSafeInteger(unit.index)) paragraphAttributes['data-story-paragraph-index'] = unit.index;
                const isolated = isolateText(unit, 'story-paragraph', paragraphAttributes);
                paragraph = isolated.wrapper;
                textNode = isolated.node;
                markFollowingBreaks(paragraph);
            } else if (selected.dialogueColors && record) {
                // Metadata offsets are relative to the exact trimmed record,
                // never to EJS's surrounding indentation whitespace.
                textNode = isolateTrimmedText(unit);
            }
            if (selected.dialogueColors && record) {
                for (const segment of record.segments.slice().sort((left, right) => right.start - left.start || right.end - left.end)) {
                    wrapSegment(textNode, segment, registry);
                    report.decorated += 1;
                }
            }
        }

        if (book && units.length) {
            current.container.classList.add('story-view');
            current.container.setAttribute('data-reading-scene', current.sceneId);
            const openings = chapterOpeningCandidates(current.metadata, scene, current.sceneId, current.locale);
            const opening = openings.find(candidate => matched.has(candidate.paragraphIndex)
                && current.container.querySelector('[' + OWNED_ATTRIBUTE + '="paragraph"][data-story-paragraph-index="' + candidate.paragraphIndex + '"]'));
            const first = opening && current.container.querySelector('[' + OWNED_ATTRIBUTE + '="paragraph"][data-story-paragraph-index="' + opening.paragraphIndex + '"]');
            if (first) {
                first.classList.add('chapter-opening-text');
                if (opening.dropCap) first.classList.add('chapter-drop-cap');
                current.container.classList.add('chapter-opening');
                const documentElement = current.container.ownerDocument.documentElement;
                if (documentElement) documentElement.classList.add('chapter-opening-active');
                report.chapterOpening = true;
            }
        }
        return report;
    }

    function reapply(detail) {
        detail = detail || {};
        const options = {
            metadata: detail.metadata || state.metadata,
            semanticMetadata: detail.semanticMetadata || state.semanticMetadata,
            sceneId: own(detail, 'sceneId') ? detail.sceneId : state.sceneId,
            locale: own(detail, 'locale') ? detail.locale : state.locale,
            unitIndices: own(detail, 'unitIndices') ? detail.unitIndices : state.unitIndices,
        };
        if (own(detail, 'dialogueColors')) options.dialogueColors = detail.dialogueColors;
        if (own(detail, 'semanticDialogueColors')) options.semanticDialogueColors = detail.semanticDialogueColors;
        if (own(detail, 'readingMode')) options.readingMode = detail.readingMode;
        return apply(state.container, options);
    }

    function dispatchPreference(detail) {
        if (!root.document || typeof root.CustomEvent !== 'function') return;
        root.document.dispatchEvent(new root.CustomEvent('magium:reading-preference-change', {detail}));
    }

    function setDialogueColors(value) {
        const enabled = dialogueEnabled(value);
        writeStored(DIALOGUE_STORAGE_KEY, enabled ? 'on' : 'off');
        const detail = {dialogueColors: enabled};
        if (!enabled) {
            writeStored(SEMANTIC_DIALOGUE_STORAGE_KEY, 'off');
            syncSemanticDialogueControl(false);
            detail.semanticDialogueColors = false;
        }
        dispatchPreference(detail);
        if (!state.initialized) reapply(detail);
        return enabled;
    }

    function initializeDialogueColorsText() {
        if (!root.document) return;
        const dropdown = root.document.getElementById('dialogueColorsDropdown');
        if (dropdown) dropdown.value = preferences().dialogueColors ? 'on' : 'off';
    }

    function syncSemanticDialogueControl(enabled) {
        if (root.document) {
            const control = root.document.getElementById('semanticDialogueColorsCheckbox');
            if (control) {
                control.dataset.enabled = enabled ? 'true' : 'false';
                control.setAttribute('aria-label', (control.dataset.label || 'Include context-inferred dialogue colors') + (enabled ? ': on' : ': off'));
                const status = control.querySelector('.semantic-checkbox-state');
                if (status) status.textContent = enabled ? (control.dataset.onLabel || 'On') : (control.dataset.offLabel || 'Off');
            }
        }
    }

    function setSemanticDialogueColors(value) {
        const enabled = dialogueEnabled(value);
        writeStored(SEMANTIC_DIALOGUE_STORAGE_KEY, enabled ? 'on' : 'off');
        syncSemanticDialogueControl(enabled);
        const detail = {semanticDialogueColors: enabled};
        // Inferred dialogue is an additional metadata layer. Enabling it also
        // enables the base dialogue renderer so the setting has an immediate,
        // visible effect instead of storing an active but inert preference.
        if (enabled) {
            writeStored(DIALOGUE_STORAGE_KEY, 'on');
            const dropdown = root.document && root.document.getElementById('dialogueColorsDropdown');
            if (dropdown) dropdown.value = 'on';
            detail.dialogueColors = true;
        }
        dispatchPreference(detail);
        if (!state.initialized) reapply(detail);
        return enabled;
    }

    function initializeSemanticDialogueColorsText() {
        if (!root.document) return;
        const control = root.document.getElementById('semanticDialogueColorsCheckbox');
        if (control) {
            const enabled = preferences().semanticDialogueColors;
            syncSemanticDialogueControl(enabled);
        }
    }

    function toggleSemanticDialogueColors(control) {
        if (!control || typeof control.getAttribute !== 'function') return false;
        return setSemanticDialogueColors(!preferences().semanticDialogueColors);
    }

    function setReadingMode(value) {
        const mode = readingMode(value);
        writeStored(READING_MODE_STORAGE_KEY, mode);
        if (root.document && root.document.documentElement) root.document.documentElement.classList.toggle('reading-mode-book', mode === 'book');
        dispatchPreference({readingMode: mode, bookTypography: mode === 'book'});
        if (!state.initialized) reapply({readingMode: mode});
        return mode;
    }

    function initialize(options) {
        options = options || {};
        if (options.container) state.container = options.container;
        if (options.metadata) state.metadata = options.metadata;
        if (options.semanticMetadata) state.semanticMetadata = options.semanticMetadata;
        if (options.sceneId) state.sceneId = options.sceneId;
        if (options.locale) state.locale = options.locale;
        if (own(options, 'unitIndices')) state.unitIndices = options.unitIndices;
        if (typeof options.getSceneId === 'function') state.getSceneId = options.getSceneId;
        if (typeof options.getLocale === 'function') state.getLocale = options.getLocale;

        if (!state.initialized && root.document) {
            root.document.addEventListener('magium:render', event => reapply(event.detail || {}));
            root.document.addEventListener('magium:reading-preference-change', event => reapply(event.detail || {}));
            state.initialized = true;
        }
        return reapply(options);
    }

    return Object.freeze({
        DIALOGUE_STORAGE_KEY,
        SEMANTIC_DIALOGUE_STORAGE_KEY,
        READING_MODE_STORAGE_KEY,
        apply,
        clear,
        initialize,
        initializeDialogueColorsText,
        initializeSemanticDialogueColorsText,
        setDialogueColors,
        setSemanticDialogueColors,
        toggleSemanticDialogueColors,
        setReadingMode,
        getPreferences: preferences,
        validateRecord,
    });
});
