/* Upstream preferences use cookies. Persist those same values without a server. */
(function () {
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: function () { return ['locale','fontsize','stats_intro_seen'].map(key => key+'='+(localStorage.getItem('magium.preference.'+key)||'')).join('; '); },
        set: function (value) {
            const pair=String(value).split(';')[0], equal=pair.indexOf('='), key=pair.slice(0,equal).trim();
            if (['locale','fontsize','stats_intro_seen'].includes(key)) localStorage.setItem('magium.preference.'+key,pair.slice(equal+1));
        }
    });
})();
