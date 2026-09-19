/* Magium's offline runtime. No DOM, server, eval, or network is required. */
(function (root, factory) {
    const Engine = factory();
    if (typeof module === 'object' && module.exports) module.exports = Engine;
    else root.MagiumEngine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const START = 'Ch1-Intro1';
    const BASE_STATS = ['strength', 'toughness', 'agility', 'reflexes', 'hearing', 'perception', 'ancient_languages', 'combat_technique', 'premonition'];
    const EXTRA_STATS = ['bluff', 'magical_sense', 'aura_hardening'];
    const ALL_STATS = BASE_STATS.concat(EXTRA_STATS, ['magical_power', 'magical_knowledge']);
    const SPECIALS = ['stats', 'saves', 'restart', 'checkpoint_save', 'checkpoint_load'];
    const copy = value => JSON.parse(JSON.stringify(value));
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    function condition(expression, values) {
        if (!expression || expression === 'True') return true;
        if (expression === 'False') return false;
        const match = /^(\w+)\s+(>=|<=|==|!=|>|<)\s+(-?\d+)$/.exec(expression.trim());
        if (!match) throw new Error('Unsupported condition: ' + expression);
        const left = Number(values[match[1]] || 0), right = Number(match[3]);
        switch (match[2]) {
            case '>=': return left >= right;
            case '<=': return left <= right;
            case '==': return left === right;
            case '!=': return left !== right;
            case '>': return left > right;
            case '<': return left < right;
            default: return false;
        }
    }
    function conditions(groups, values) {
        return !groups || groups.some(group => group.every(expression => condition(expression, values)));
    }
    function chapter(id) {
        const match = /^(?:B(\d+)-)?Ch(\d+)[a-c]?-/.exec(id);
        return { book: match && match[1] ? Number(match[1]) : 1, chapter: match ? Number(match[2]) : 1 };
    }
    function statLabel(key, ui) {
        const name = key === 'agility' ? 'Speed' : key === 'perception' ? 'Observation' : key.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('');
        return ui['stats' + name + 'Text'] || key.replace(/_/g, ' ');
    }
    function cleanVariables(input, achievements) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid save variables.');
        const output = {};
        for (const [key, value] of Object.entries(input)) {
            if (!/^v_\w+$/.test(key) || key.startsWith('v_ac_') !== achievements) continue;
            if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid value in save: ' + key);
            if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid number in save.');
            output[key] = value;
        }
        return output;
    }

    class MagiumEngine {
        constructor(data, options) {
            options = options || {};
            if (!data || !data.en || !data.en.scenes || !data.en.scenes[START]) throw new Error('English story data is missing.');
            this.data = data;
            this.locale = options.locale || 'en';
            this.achievements = {};
            this.history = [];
            this.checkpoint = null;
            this.pendingScene = null;
            this._unlocked = [];
            if (options.snapshot) this.restore(options.snapshot);
            else this.reset();
        }
        _localeData() { return this.data[this.locale] && this.data[this.locale].scenes ? this.data[this.locale] : this.data.en; }
        _ui() { return (this.data[this.locale] || {}).ui || this._localeData().ui || {}; }
        _scene(id) {
            const scene = this._localeData().scenes[id];
            if (!scene) throw new Error('Unknown scene: ' + id);
            return scene;
        }
        _values() { return Object.assign({}, this.state, this.achievements); }
        _defaults() {
            for (const key of ALL_STATS.concat('available_points')) if (this.state['v_' + key] === undefined) this.state['v_' + key] = 0;
            if (this.state.v_max_stat === undefined) this.state.v_max_stat = 3;
        }
        _assign(key, raw) {
            if (!/^v_\w+$/.test(key)) throw new Error('Invalid story variable: ' + key);
            const target = key.startsWith('v_ac_') ? this.achievements : this.state;
            // The consolation counter is progress, not a binary unlocked award.
            if (target === this.achievements && key !== 'v_ac_b3_ch9_consolation' && Number(target[key]) === 2) return;
            const value = String(raw).trim();
            target[key] = /^[+-]\d+$/.test(value) ? Number(target[key] || 0) + Number(value) : /^\d+$/.test(value) ? Number(value) : value;
            if (key === 'v_ac_b3_ch9_consolation' && Number(target[key]) === 5 && Number(this.achievements.v_ac_b3_ch9_prize) !== 2) this.achievements.v_ac_b3_ch9_prize = 1;
        }
        _unlock(scene) {
            this._unlocked = [];
            const awards = scene.achievements.slice();
            if (Number(this.achievements.v_ac_b3_ch9_prize) === 1) awards.push({text: 'Consolation prize', variable: 'v_ac_b3_ch9_prize'});
            for (const award of awards) if (Number(this.achievements[award.variable]) === 1) {
                this.achievements[award.variable] = 2;
                this._unlocked.push(award);
            }
        }
        initialize(snapshot) { return snapshot ? this.restore(snapshot) : this.reset(); }
        reset() {
            this.state = {v_current_scene: START};
            this._defaults();
            this.history = [];
            this.checkpoint = null;
            this.pendingScene = null;
            return this.enter(START);
        }
        setLocale(locale) {
            if (!this.data[locale]) throw new Error('Language is unavailable: ' + locale);
            this.locale = locale;
            return this.view();
        }
        translate(text) {
            if (this.locale !== 'zh-CN') return text;
            const translations = (this.data['zh-CN'] || {}).translations || {};
            if (own(translations, text)) return translations[text];
            return text.split(/(<br\s*\/?\s*>|\r?\n)/i).map(part => {
                if (own(translations, part)) return translations[part];
                const trimmed = part.trim();
                return trimmed && own(translations, trimmed) ? translations[trimmed] : part;
            }).join('');
        }
        enter(id) {
            const scene = this._scene(id);
            this.state.v_current_scene = id;
            this.pendingScene = null;
            // All entry conditions see the state before any entry assignment.
            const before = this._values();
            this._entryEffects = scene.setVariables.filter(effect => conditions(effect.conditions, before));
            for (const effect of this._entryEffects) this._assign(effect.name, effect.value);
            this._unlock(scene);
            return this.view();
        }
        _checks(elements, values, id) {
            if (id === 'B3-Ch04a-Introduction2') return [];
            const found = new Map();
            for (const element of elements) for (const group of element.conditions || []) {
                if (!group.every(expression => condition(expression, values))) continue;
                for (const expression of group) {
                    const match = /^(v_\w+) (>=|<=|==|!=|>|<) (\d+)$/.exec(expression);
                    if (!match) continue;
                    let variable = match[1], operator = match[2], value = Number(match[3]), success;
                    if (variable === 'v_b3_ch1_unlock' && operator === '==' && value === 2) {
                        if (id !== 'B3-Ch01a-Crossbow') found.set('locked', {variable, label: variable, value, success: false, locked: true});
                        continue;
                    }
                    const key = variable.slice(2);
                    if (!ALL_STATS.includes(key)) continue;
                    if (operator === '<') success = false;
                    else if (operator === '<=') { success = false; value += 1; }
                    else if (operator === '==' && value === 0) { success = false; value = 1; }
                    else if (operator === '>=' || operator === '==') success = true;
                    else if (operator === '>') { success = true; value += 1; }
                    else continue;
                    const check = {variable, key, label: this.translate(statLabel(key, this._ui())), value, success};
                    found.set(variable + ':' + value + ':' + success, check);
                }
            }
            return found.has('locked') ? [found.get('locked')] : Array.from(found.values());
        }
        view() {
            const id = this.state.v_current_scene;
            const scene = this._scene(id), values = this._values();
            let nextReadingLine = 0;
            const indexedParagraphs = scene.paragraphs.map(item => {
                const readingLineIndices = [];
                for (const part of item.text.split(/<br\s*\/?\s*>|\r?\n/i)) {
                    if (part.trim()) readingLineIndices.push(nextReadingLine++);
                }
                return {item, readingLineIndices};
            });
            const visibleParagraphs = indexedParagraphs.filter(entry => conditions(entry.item.conditions, values));
            const paragraphs = visibleParagraphs.map(entry => entry.item);
            const choices = scene.choices.filter(item => conditions(item.conditions, values));
            return Object.assign({
                id,
                paragraphs: visibleParagraphs.map(entry => Object.assign({}, entry.item, {
                    text: this.translate(entry.item.text),
                    readingLineIndices: entry.readingLineIndices,
                })),
                choices: choices.map((item, index) => Object.assign({}, item, {index, text: this.translate(item.text)})),
                statChecks: this._checks((this._entryEffects || []).concat(paragraphs, choices), values, id),
                unlocked: this._unlocked.map(item => Object.assign({}, item, {text: this.translate(item.text)})),
                checkpoint: choices.some(item => String(item.setVariables.v_checkpoint_rich) === '0'),
                pendingStats: Boolean(this.pendingScene)
            }, chapter(id));
        }
        choose(index) {
            if (this.pendingScene) throw new Error('Return from the stat screen before making a choice.');
            const choice = this.view().choices[index];
            if (!Number.isInteger(index) || !choice) throw new Error('That choice is unavailable.');
            if (choice.special && !SPECIALS.includes(choice.special)) throw new Error('Unknown special choice: ' + choice.special);
            const previous = this.state.v_current_scene;
            this.history.push({id: previous, choice: index, text: choice.text});
            if (this.history.length > 3000) this.history.shift();
            for (const [key, value] of Object.entries(choice.setVariables || {})) this._assign(key, value);
            this._unlocked = [];
            if (choice.special === 'restart') return {action: 'story', view: this.reset()};
            if (choice.special === 'saves') return {action: 'saves', view: this.view()};
            if (choice.special === 'checkpoint_load') {
                if (!this.checkpoint) throw new Error('No checkpoint has been reached yet.');
                return {action: 'story', view: this.loadCheckpoint()};
            }
            const target = choice.target || this.state.v_current_scene;
            this._scene(target);
            this.state.v_current_scene = target;
            this.pendingScene = target;
            if (choice.special === 'checkpoint_save') this.checkpoint = {state: copy(this.state), pendingScene: target};
            if (choice.special === 'stats') {
                this.openStats();
                return {action: 'stats', view: this.view()};
            }
            return {action: 'story', view: this.enter(target)};
        }
        resume() { return this.pendingScene ? this.enter(this.pendingScene) : this.view(); }
        stats() {
            const position = chapter(this.state.v_current_scene);
            const keys = BASE_STATS.concat(position.book === 3 && position.chapter >= 4 ? EXTRA_STATS : []);
            const max = Number(this.state.v_max_stat || 3);
            return keys.map(key => ({key, variable: 'v_' + key, label: this.translate(statLabel(key, this._ui())), value: Number(this.state['v_' + key] || 0), max, canIncrease: Number(this.state.v_available_points) > 0 && Number(this.state['v_' + key] || 0) < max}));
        }
        openStats() {
            const maximized = this.state.v_current_scene === 'Ch6-Eiden-vs-dragon' && Number(this.state.v_maximized_stats_used) === 1;
            if (maximized && !Number(this.achievements.v_ac_ch6_immersion)) {
                this.achievements.v_ac_ch6_immersion = 2;
                this._unlocked = [{variable: 'v_ac_ch6_immersion', text: 'Full immersion'}];
            }
            return this.stats();
        }
        allocateStat(key, amount) {
            amount = amount === undefined ? 1 : amount;
            key = key.replace(/^v_/, '');
            const item = this.stats().find(stat => stat.key === key);
            if (!item || !Number.isInteger(amount) || amount < 1 || item.value + amount > item.max || Number(this.state.v_available_points) < amount) throw new Error('Stat allocation is not allowed.');
            this.state[item.variable] = item.value + amount;
            this.state.v_available_points = Number(this.state.v_available_points) - amount;
            return this.stats();
        }
        loadCheckpoint() {
            if (!this.checkpoint) throw new Error('No checkpoint has been reached yet.');
            this.state = copy(this.checkpoint.state);
            this._defaults();
            return this.enter(this.checkpoint.pendingScene || this.state.v_current_scene);
        }
        snapshot() {
            return copy({version: 1, state: this.state, achievements: this.achievements, checkpoint: this.checkpoint, history: this.history, pendingScene: this.pendingScene, entryEffects: this._entryEffects || []});
        }
        restore(snapshot) {
            if (!snapshot || snapshot.version !== 1) throw new Error('Unsupported save format.');
            const state = cleanVariables(snapshot.state, false);
            this._scene(state.v_current_scene);
            const awards = cleanVariables(snapshot.achievements || {}, true);
            let checkpoint = null;
            if (snapshot.checkpoint) {
                const checkpointState = cleanVariables(snapshot.checkpoint.state, false);
                this._scene(checkpointState.v_current_scene);
                checkpoint = {state: checkpointState, pendingScene: checkpointState.v_current_scene};
            }
            const pendingScene = snapshot.pendingScene || null;
            if (pendingScene) { this._scene(pendingScene); if (pendingScene !== state.v_current_scene) throw new Error('Invalid pending scene.'); }
            this.state = state;
            this._defaults();
            // Unlocked achievements survive loading an older manual save.
            for (const [key, value] of Object.entries(this.achievements || {})) if (key !== 'v_ac_b3_ch9_consolation' && Number(value) === 2) awards[key] = 2;
            this.achievements = awards;
            this.checkpoint = checkpoint;
            this.pendingScene = pendingScene;
            this.history = Array.isArray(snapshot.history) ? copy(snapshot.history.slice(-3000)) : [];
            const savedEffects = Array.isArray(snapshot.entryEffects) ? snapshot.entryEffects : [];
            this._entryEffects = this._scene(state.v_current_scene).setVariables.filter(effect => savedEffects.some(saved => saved && saved.name === effect.name && saved.value === effect.value));
            this._unlocked = [];
            return this.view();
        }
    }
    MagiumEngine.condition = condition;
    MagiumEngine.conditions = conditions;
    MagiumEngine.chapter = chapter;
    MagiumEngine.START = START;
    MagiumEngine.STATS = ALL_STATS.slice();
    return MagiumEngine;
});
