/* Offline route/storage adapter for the original Magium EJS interface. */
(function () {
    'use strict';
    const data=globalThis.MAGIUM_DATA;
    const LOCALES=['en','fr','zh-CN'];
    function preferredLocale(){
        const saved=getCookie('locale');
        if(LOCALES.includes(saved))return saved;
        const languages=(typeof navigator!=='undefined'&&Array.isArray(navigator.languages)&&navigator.languages.length)?navigator.languages:[(typeof navigator!=='undefined'&&navigator.language)||''];
        for(const tag of languages){const lower=String(tag).toLowerCase();if(lower==='zh'||lower.startsWith('zh-'))return 'zh-CN';}
        return 'en';
    }
    const locale=preferredLocale();
    const engine=new MagiumEngine(data,{locale});
    let route='/', choicePending=false, recovery=false;
    const messages={
        en:{overwrite:'Do you want to overwrite your save?',restart:'Start a new game?',invalid:'The given string is not a valid save!',copied:'Save copied to clipboard!',storage:'Unable to save on this device. Export your progress before closing the app.',corrupt:'The current save could not be loaded. It has been preserved. Import a valid save or choose New game to start again.',checkpoint:'No checkpoint has been reached yet.',restoreAll:'Replace all game saves and achievements with this backup?',restoreAchievements:'Replace your achievements with this backup?'},
        fr:{overwrite:'Écraser cette sauvegarde ?',restart:'Commencer une nouvelle partie ?',invalid:'Cette sauvegarde est invalide !',copied:'Sauvegarde copiée !',storage:'Impossible de sauvegarder sur cet appareil. Exportez votre progression avant de fermer.',corrupt:'La sauvegarde actuelle est illisible et a été conservée. Importez une sauvegarde valide ou recommencez.',checkpoint:'Aucun point de contrôle atteint.',restoreAll:'Remplacer toutes les sauvegardes et les succès ?',restoreAchievements:'Remplacer vos succès ?'},
        'zh-CN':{overwrite:'要覆盖这个存档吗？',restart:'要开始新游戏吗？',invalid:'存档内容无效！',copied:'存档已复制到剪贴板！',storage:'无法保存到此设备。关闭应用前，请导出游戏进度。',corrupt:'当前存档无法读取，原数据已保留。请导入有效存档，或选择“新游戏”重新开始。',checkpoint:'尚未到达检查点。',restoreAll:'要用此备份替换所有游戏存档和成就吗？',restoreAchievements:'要用此备份替换现有成就吗？'}
    };
    const message=key=>messages[engine.locale][key];
    const gameKey=key=>/^(?:currentState|achievements|checkpoint|save(?:[0-9]|[1-4][0-9]))$/.test(key);
    const decode=text=>{
        if(typeof text!=='string'||text.length>8*1024*1024) throw new Error('Invalid save size.');
        const value=JSON.parse(LZString.decompressFromBase64(text));
        if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Invalid save object.');
        return value;
    };
    window.readSaveFromLocalStorage=function(key){ const text=localStorage.getItem(key); return text?decode(text):{}; };
    const write=window.writeSaveToLocalStorage;
    function snapshotFromSave(save) {
        return save._offlineSnapshot||{version:1,state:save,achievements:readSaveFromLocalStorage('achievements'),checkpoint:engine.checkpoint,history:[]};
    }
    function validateSave(save) {
        const check=new MagiumEngine(data,{locale:engine.locale});
        check.restore(snapshotFromSave(save));
        return save;
    }
    try {
        const saved=readSaveFromLocalStorage('currentState');
        if(saved.v_current_scene) engine.restore(snapshotFromSave(saved));
        else if(Object.keys(saved).length) throw new Error('Missing scene.');
        const awards=readSaveFromLocalStorage('achievements');
        for(const [key,value] of Object.entries({...saved,...awards})) if(/^v_ac_\w+$/.test(key)) engine.achievements[key]=value;
        if(!engine.checkpoint&&localStorage.getItem('checkpoint')) {
            const checkpoint=readSaveFromLocalStorage('checkpoint');
            if(data.en.scenes[checkpoint.v_current_scene]) engine.checkpoint={state:checkpoint,pendingScene:checkpoint.v_current_scene};
        }
    } catch(error) { recovery=true; }
    function persist() {
        if(recovery) return false;
        try {
            write('currentState',{...engine.state,_offlineSnapshot:engine.snapshot()});
            write('achievements',engine.achievements);
            if(engine.checkpoint) write('checkpoint',engine.checkpoint.state);
            return true;
        } catch(error) { alert(message('storage')); return false; }
    }
    window.storeVariable=function(key,value){ engine._assign(key,value); persist(); };
    window.clearState=function(){
        if(!confirm(message('restart'))) return false;
        recovery=false; engine.reset(); localStorage.removeItem('checkpoint'); persist(); return true;
    };
    window.setResponseVariables=function(choice){
        engine.choose(choice.index); choicePending=true; persist();
    };
    window.saveGameToLocalStorage=function(key,overwrite){
        if(overwrite&&!confirm(message('overwrite'))) return false;
        if(!gameKey(key)||recovery) return false;
        const now=new Date().toUTCString();
        try { write(key,{...engine.state,_offlineSnapshot:engine.snapshot(),date:now,name:now}); return true; }
        catch(error){ alert(message('storage')); return false; }
    };
    window.loadGameFromLocalStorage=function(key){
        try {
            if(key==='checkpoint') { if(!engine.checkpoint) {alert(message('checkpoint'));return false;} engine.loadCheckpoint(); }
            else engine.restore(snapshotFromSave(validateSave(readSaveFromLocalStorage(key))));
            recovery=false; persist(); return true;
        } catch(error){ alert(message('invalid'));return false; }
    };
    window.confirmStats=function(){
        try {
            for(const stat of engine.stats()) {
                const element=document.getElementById(stat.key+'_value');
                const amount=element?Number(element.textContent)-stat.value:0;
                if(amount>0) engine.allocateStat(stat.key,amount);
            }
            persist(); render('/stats',false);
        } catch(error) { alert(message('invalid')); render('/stats',false); }
    };
    async function exportText(text) {
        try { await copyToClipboard(text); alert(message('copied')); }
        catch(error) { alert(message('storage')); }
    }
    window.downloadLocalStorageSave=function(key){ if(gameKey(key)) return exportText(localStorage.getItem(key)||''); };
    window.downloadAllLocalStorageSave=function(){
        const saves={}; for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(gameKey(key)) saves[key]=localStorage.getItem(key);}
        return exportText(LZString.compressToBase64(JSON.stringify(saves)));
    };
    function parseImport(text) {
        try {return decode(text.trim());}
        catch(error) {const value=JSON.parse(atob(text.trim()));if(!value||typeof value!=='object'||Array.isArray(value))throw error;return value;}
    }
    window.restoreLocalStorageSave=function(index,overwrite){
        if(overwrite&&!confirm(message('overwrite'))) return;
        try { const value=validateSave(parseImport(document.getElementById('file_'+index).value));write('save'+index,value);render(route,false); }
        catch(error){alert(message('invalid'));}
    };
    function validateAwards(value){
        if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,val])=>!/^v_ac_\w+$/.test(key)||!['number','string'].includes(typeof val))) throw new Error('Invalid achievements.');
        return value;
    }
    window.restoreAchievementsSave=function(){
        if(!confirm(message('restoreAchievements')))return;
        try {engine.achievements=validateAwards(parseImport(document.getElementById('file_achievements').value));persist();render(route,false);}
        catch(error){alert(message('invalid'));}
    };
    window.restoreAllSave=function(){
        if(!confirm(message('restoreAll')))return;
        try {
            const incoming=decode(document.getElementById('file_all').value.trim()), accepted={};
            for(const [key,value] of Object.entries(incoming)) if(gameKey(key)) {
                const unpacked=decode(value);
                if(key==='achievements')validateAwards(unpacked);else validateSave(unpacked);
                accepted[key]=value;
            }
            if(!Object.keys(accepted).length)throw new Error('Empty backup.');
            const previous={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(gameKey(key))previous[key]=localStorage.getItem(key);}
            try {
                for(const key of Object.keys(previous))localStorage.removeItem(key);
                for(const [key,value] of Object.entries(accepted))localStorage.setItem(key,value);
            }catch(error){for(const key of Object.keys(accepted))localStorage.removeItem(key);for(const [key,value] of Object.entries(previous))localStorage.setItem(key,value);throw error;}
            engine.achievements={};
            if(accepted.currentState)engine.restore(snapshotFromSave(readSaveFromLocalStorage('currentState')));else engine.reset();
            if(accepted.achievements)engine.achievements=readSaveFromLocalStorage('achievements');
            recovery=false;persist();render(route,false);
        }catch(error){alert(message('invalid'));}
    };
    function snippet(source,values){return MAGIUM_SNIPPETS[source](values);}
    function base(){return {...data.en.ui,...data[engine.locale].ui,...engine.state,...engine.achievements,ejs:{render:snippet},theme:localStorage.getItem('theme')};}
    function routeData(path){
        const values=base();let template;
        if(path==='/') {
            const view=engine.resume();persist();
            Object.assign(values,engine.state,engine.achievements);
            values.header=snippet(values.mainHeaderTemplate,view);
            values.scene={...view,setVariables:[],achievements:view.unlocked,statChecks:view.statChecks.map(check=>({...check,variable:check.locked?'v_b3_ch1_unlock':check.label}))};
            template='main';
        } else if(path==='/stats') {
            engine.openStats();persist();
            values.maximized=engine.state.v_current_scene==='Ch6-Eiden-vs-dragon'&&Number(engine.state.v_maximized_stats_used)===1;
            values.stats_intro_seen=getCookie('stats_intro_seen'); template='stats';
        } else if(path==='/language'){values.locales={en:'English',fr:'Français','zh-CN':'简体中文'};template='language';}
        else if(/^\/saves(?:\/[0-4])?$/.test(path)) {
            values.page=Number(path.split('/')[2]||0);values.saveData={};
            for(let i=0;i<50;i++) {const key='save'+i;if(localStorage.getItem(key))try{values.saveData[key]=readSaveFromLocalStorage(key);}catch(error){/* Corrupt slots remain untouched until explicitly overwritten. */}}
            template='saves';
        } else if(path==='/achievements'){values.bookCount=3;template='achievements_menu';}
        else if(/^\/achievements\/book\/[1-3](?:\/chapter\/\d+)?$/.test(path)){
            const parts=path.split('/'),book=parts[3],chapter=parts[5];
            const achievements=data[engine.locale==='fr'?'fr':'en'].achievements[book];
            if(chapter){
                if(!achievements['b'+book+'ch'+chapter])throw new Error('Invalid chapter.');
                values.achievements=achievements['b'+book+'ch'+chapter].map(item=>({...item,title:engine.translate(item.title),caption:engine.translate(item.caption)}));template='achievements_menu_chapter';
            }else{values.achievements=achievements;template='achievements_menu_book';}
        }else if(['/menu','/settings','/about'].includes(path))template=path.slice(1);
        else throw new Error('Unknown page.');
        return {template,values};
    }
    function render(path,push=true){
        if(route==='/settings'){
            const semanticCheckbox=document.getElementById('semanticDialogueColorsCheckbox');
            if(semanticCheckbox)setSemanticDialogueColors(semanticCheckbox.dataset.enabled==='true');
        }
        const {template,values}=routeData(path);
        const content=document.getElementById('content');
        const fragment=document.createElement('template');
        fragment.innerHTML=MAGIUM_TEMPLATES[template](values).replace(/(src|href)="\s*\/images\//g,'$1="images/');
        const header=fragment.content.querySelector('#header');
        if(header){document.getElementById('header').innerHTML=header.innerHTML;header.parentElement.remove();}
        content.replaceChildren(fragment.content);
        document.querySelector('.header-left').textContent=values.outlineMenuButtonText;
        document.querySelector('.header-right').textContent=values.outlineStatsButtonText;
        document.documentElement.lang=engine.locale;
        route=path;
        if(push&&location.hash!=='#'+path)history.pushState(null,'','#'+path);
        htmx.process(content); _hyperscript.processNode(content);
        if(path==='/settings'){initializeThemeText();initializeFontSizeSlider();initializeReadingModeText();initializeDialogueColorsText();initializeSemanticDialogueColorsText();initializeAnimationEffectsText();initializeContextualTypographyText();}
        window.scrollTo(0,0);
        document.dispatchEvent(new CustomEvent('magium:render',{detail:{
            route:path,
            sceneId:path==='/'&&values.scene?values.scene.id:'',
            locale:engine.locale,
            unitIndices:path==='/'&&values.scene?values.scene.paragraphs.flatMap(paragraph=>paragraph.readingLineIndices||[]):[]
        }}));
    }
    function hook(source){
        if(!source)return true;
        const match=/^\s*(clearState|loadGameFromLocalStorage|saveGameToLocalStorage|renameLocalStorageSave)\s*\(([\s\S]*)\)\s*$/.exec(source);
        if(!match)throw new Error('Unknown local action.');
        const args=match[2].trim()?match[2].split(',').map(value=>{value=value.trim();if(value==='true')return true;if(value==='false')return false;const quoted=/^'([^']*)'$/.exec(value);if(quoted)return quoted[1];throw new Error('Invalid action arguments.');}):[];
        return window[match[1]](...args)!==false;
    }
    // Capture before the upstream per-button request hooks. No XHR is sent.
    document.addEventListener('htmx:beforeRequest',function(event){
        event.preventDefault();event.stopImmediatePropagation();
        const element=event.detail.elt;
        try {
            if(choicePending)choicePending=false;
            else if(!hook(element.getAttribute('hx-on::before-request')))return;
            const path=element.getAttribute('hx-post')||element.getAttribute('hx-get')||route;
            // Finish the current HTMX event before replacing its source node.
            queueMicrotask(()=>render(path));
        }catch(error){alert(message('invalid'));}
    },true);
    document.addEventListener('click',function(event){
        const control=event.target&&event.target.closest&&event.target.closest('#semanticDialogueColorsCheckbox');
        if(!control)return;
        event.preventDefault();
        toggleSemanticDialogueColors(control);
    },true);
    window.MagiumApp={onBack:function(){if(route!=='/'){render('/');return true;}return false;}};
    window.addEventListener('popstate',()=>render(location.hash.slice(1)||'/',false));
    document.addEventListener('DOMContentLoaded',function(){
        MagiumReadingEnhancements.initialize({container:document.getElementById('content'),metadata:data.readingEnhancements,semanticMetadata:data.semanticReadingEnhancements,getLocale:()=>engine.locale});
        MagiumPresentationEnhancements.initialize({container:document.getElementById('content'),metadata:data.documentTypography,getLocale:()=>engine.locale});
        try {render(location.hash.slice(1)||(engine.pendingScene?'/stats':'/'),false);if(recovery)alert(message('corrupt'));}
        catch(error){render('/',false);}
    });
})();
