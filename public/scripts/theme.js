const Theme = {
    LIGHT: "original-light",
    DARK: "original-dark",
    CAT_LIGHT: "catppuccin-light",
    CAT_DARK: "catppuccin-dark",
    MATERIAL_YOU: "material-you",
};

function normalizeTheme(selectedValue) {
    return Object.values(Theme).includes(selectedValue) ? selectedValue : Theme.MATERIAL_YOU;
}

const UIStyle = Object.freeze({
    CLASSIC: "classic",
    SQUARE: "square",
});
const UI_STYLE_STORAGE_KEY = "magium.preference.ui-style";
const MATERIAL_PALETTE_KEYS = Object.freeze([
    "surface", "onSurface", "surfaceContainer", "surfaceContainerHigh",
    "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
    "secondaryContainer", "onSecondaryContainer", "outline",
    "errorContainer", "onErrorContainer",
]);

const ReadingMode = Object.freeze({
    ORIGINAL: "original",
    BOOK: "book",
});
const READING_MODE_STORAGE_KEY = "magium.preference.reading-mode";

function getReadingMode() {
    const savedMode = localStorage.getItem(READING_MODE_STORAGE_KEY);
    return Object.values(ReadingMode).includes(savedMode) ? savedMode : ReadingMode.ORIGINAL;
}

function applyReadingMode(selectedValue, persist = false) {
    const readingMode = Object.values(ReadingMode).includes(selectedValue)
        ? selectedValue
        : ReadingMode.ORIGINAL;
    const bookTypography = readingMode === ReadingMode.BOOK;

    document.documentElement.classList.toggle("reading-mode-book", bookTypography);
    if (!bookTypography) document.documentElement.classList.remove("chapter-opening-active");
    if (persist) localStorage.setItem(READING_MODE_STORAGE_KEY, readingMode);

    document.dispatchEvent(new CustomEvent("magium:reading-preference-change", {
        detail: { readingMode, bookTypography },
    }));
    return readingMode;
}

function handleReadingModeChange(selectedValue) {
    return applyReadingMode(selectedValue, true);
}

function initializeReadingModeText() {
    const dropdown = document.getElementById("readingModeDropdown");
    if (dropdown) dropdown.value = getReadingMode();
}

function initializeReadingMode() {
    applyReadingMode(getReadingMode());
    initializeReadingModeText();
}

function checkIsDarkSchemePreferred() {
    return window?.matchMedia?.('(prefers-color-scheme:dark)')?.matches ?? false;
}

function setColour(selectedValue) {
    const root = document.querySelector(':root');
    var newMode;
    if (selectedValue === Theme.MATERIAL_YOU) {
        newMode = globalThis.MAGIUM_SYSTEM_PALETTE?.dark === true ||
            (!globalThis.MAGIUM_SYSTEM_PALETTE && checkIsDarkSchemePreferred()) ? "dark" : "light";
    } else if (selectedValue.endsWith('-dark')) {
        newMode = "dark";
    } else if (selectedValue.endsWith('-light')) {
        newMode = "light";
    } else {
        throw new Error("Theme not specified");
    }
    root.style.setProperty("color-scheme", newMode);
}

function getUIStyle() {
    const saved = localStorage.getItem(UI_STYLE_STORAGE_KEY);
    return Object.values(UIStyle).includes(saved) ? saved : UIStyle.SQUARE;
}

function applyUIStyle(selectedValue, persist = false) {
    const style = Object.values(UIStyle).includes(selectedValue) ? selectedValue : UIStyle.SQUARE;
    document.documentElement.dataset.uiStyle = style;
    if (persist) localStorage.setItem(UI_STYLE_STORAGE_KEY, style);
    return style;
}

function handleUIStyleChange(selectedValue) {
    return applyUIStyle(selectedValue, true);
}

function initializeUIStyleText() {
    const dropdown = document.getElementById("uiStyleDropdown");
    if (dropdown) dropdown.value = getUIStyle();
}

function applySystemPalette(palette) {
    if (!palette || typeof palette !== "object" ||
        !MATERIAL_PALETTE_KEYS.every(key => /^#[0-9a-f]{6}$/i.test(palette[key] || "")) ||
        typeof palette.dark !== "boolean") return false;
    const root = document.documentElement;
    globalThis.MAGIUM_SYSTEM_PALETTE = Object.freeze({...palette});
    for (const key of MATERIAL_PALETTE_KEYS) {
        const cssName = key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());
        root.style.setProperty("--material-" + cssName, palette[key]);
    }
    if (root.dataset.theme === Theme.MATERIAL_YOU) {
        root.style.setProperty("color-scheme", palette.dark ? "dark" : "light");
        notifyNativeTheme(Theme.MATERIAL_YOU);
    }
    return true;
}

function setTheme(selectedValue) {
    const root = document.documentElement;
    
    // const isActive = root.classList.contains("theme-catppuccin");
    
    if (selectedValue === Theme.LIGHT || selectedValue === Theme.DARK) {
        if (root.classList.contains("theme-catppuccin"))
            root.classList.remove("theme-catppuccin");
    } else if (selectedValue === Theme.CAT_LIGHT || selectedValue === Theme.CAT_DARK) {
        if (!root.classList.contains("theme-catppuccin"))
            root.classList.add("theme-catppuccin");
    } else {
        root.classList.remove("theme-catppuccin");
    }
    root.dataset.theme = selectedValue;
}

function handleThemeChange(selectedValue) {
    selectedValue = normalizeTheme(selectedValue);
    setColour(selectedValue);
    setTheme(selectedValue);

    localStorage.setItem("theme", selectedValue);
    notifyNativeTheme(selectedValue);
}

function notifyNativeTheme(selectedValue) {
    if (window.MagiumNative && document.body) {
        const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
        const background = rgb && rgb.length >= 3 ? '#' + rgb.slice(0,3).map(value=>Number(value).toString(16).padStart(2,'0')).join('') : '';
        const dark = selectedValue === Theme.MATERIAL_YOU
            ? globalThis.MAGIUM_SYSTEM_PALETTE?.dark === true
            : selectedValue.endsWith('-dark');
        if (/^#[0-9a-f]{6}$/i.test(background)) window.MagiumNative.postMessage(JSON.stringify({type:'theme', background, dark}));
    }
}


htmx.defineExtension('submittheme', {
    onEvent: function (name, evt) {
        if (name === "htmx:configRequest") {
            evt.detail.headers['Content-Type'] = "application/json"
        }
    },
    encodeParameters: function(xhr, parameters, elt) {
        xhr.overrideMimeType('text/json') // override default mime type
        const theme = localStorage.getItem("theme");
        return JSON.stringify({"theme": theme});
    }
})

document.addEventListener("DOMContentLoaded", () => {
    applyUIStyle(getUIStyle());
    if (globalThis.MAGIUM_SYSTEM_PALETTE) applySystemPalette(globalThis.MAGIUM_SYSTEM_PALETTE);
    initializeReadingMode();
});
document.addEventListener("htmx:afterSwap", () => {
    initializeReadingModeText();
    initializeUIStyleText();
});
document.addEventListener("magium:render", () => {
    initializeReadingModeText();
    initializeUIStyleText();
});
