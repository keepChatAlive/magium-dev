'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ejs = require('../tools/offline-build/node_modules/ejs');
const root = path.resolve(__dirname, '..');

// Compile the upstream templates, preserving their markup and existing controls.
// Rendering on Android then needs neither a server nor a runtime compiler.
function buildUI(data) {
    const output = path.join(root, 'offline');
    for (const directory of ['scripts','styles','images','icons','fonts']) {
        const destination=path.join(output,directory);
        fs.rmSync(destination,{recursive:true,force:true});
        fs.cpSync(path.join(root,'public',directory),destination,{recursive:true});
    }
    fs.copyFileSync(path.join(root,'LICENSE'),path.join(output,'LICENSE.txt'));
    const savesPath=path.join(output,'scripts/saves.js');
    fs.writeFileSync(savesPath,fs.readFileSync(savesPath,'utf8').replace(/^migrateAchievements\(\)\s*$/m,''));
    const templates = [];
    const snippets = new Map();
    for (const name of fs.readdirSync(path.join(root,'templates')).filter(name=>name.endsWith('.ejs'))) {
        let source = fs.readFileSync(path.join(root,'templates',name),'utf8');
        // The offline engine has already applied scene effects exactly once.
        source = source.replace(/<script>[\s\S]*?<\/script>/g,'');
        templates.push(JSON.stringify(name.replace('.ejs',''))+':'+ejs.compile(source,{client:true,compileDebug:false}).toString());
    }
    for (const locale of ['en','fr','zh-CN']) for (const value of Object.values(data[locale].ui)) if (typeof value === 'string' && value.includes('<%')) snippets.set(value,ejs.compile(value,{client:true,compileDebug:false}).toString());
    fs.writeFileSync(path.join(output,'data/templates.js'),'/* Generated directly from templates/*.ejs. */\nglobalThis.MAGIUM_TEMPLATES={'+templates.join(',\n')+'};\nglobalThis.MAGIUM_SNIPPETS={'+Array.from(snippets,([key,value])=>JSON.stringify(key)+':'+value).join(',\n')+'};\n');
    let html=ejs.render(fs.readFileSync(path.join(root,'templates/outline.ejs'),'utf8'),{...data.en.ui,path:'/',header:''});
    html=html.replace('https://unpkg.com/hyperscript.org@0.9.12','/scripts/_hyperscript.min.js.js');
    html=html.replace('<script src="/scripts/htmx.min.js"></script>','<script src="offline-prelude.js"></script>\n<script src="/scripts/htmx.min.js"></script>');
    html=html.replace('</head>', ['engine.js','data/en.js','data/fr.js','data/zh-CN.js','data/readingEnhancements.js','data/semanticReadingEnhancements.js','data/documentTypography.js','data/templates.js','original-ui.js'].map(src=>'<script src="'+src+'"></script>').join('\n')+'\n</head>');
    html=html.replace(/(href|src)="\/(styles|scripts|images)\//g,'$1="$2/');
    // Remove initial server request from the empty content container only.
    html=html.replace(/<div id="content"[^>]*>/,'<div id="content" class="content">');
    // Content hashes keep localhost previews and Android WebView updates from
    // reusing a stale script or stylesheet after an app rebuild.
    html=html.replace(/(href|src)="([^"?#]+)"/g,(match,attribute,reference)=>{
        if (/^[a-z]+:/i.test(reference)) return match;
        const asset=path.join(output,reference);
        if (!fs.existsSync(asset)||!fs.statSync(asset).isFile()) return match;
        const version=crypto.createHash('sha256').update(fs.readFileSync(asset)).digest('hex').slice(0,12);
        return attribute+'="'+reference+'?v='+version+'"';
    });
    fs.writeFileSync(path.join(output,'index.html'),html);
}
module.exports=buildUI;
