import $ from 'jquery';
import {registerBbcBasicLanguage} from './bbcbasic';
import rootHtml from './root.html';
import {OwletEditor} from "./owlet";

import './owlet-editor.less';

function programUrl(id) {
    if (window.location.hostname === 'localhost')
        return `https://bbcmic.ro/assets/${id}`
    return `../assets/${id}`;
}

async function loadCachedProgram(id) {
    const response = await fetch(programUrl(id));
    const basicText = await response.text();
    return response.status === 200 ? basicText : `REM BBC BASIC program ${id} not found\n`;
}

async function initialise() {
    function setTheme(themeName) {
        localStorage.setItem('theme', themeName);
        document.documentElement.className = themeName;
    }

    setTheme("theme-classic");

    $('body').append(rootHtml);
    registerBbcBasicLanguage();

    // Check if we reference a cached tweet on first load and convert it to URL hash
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const load = urlParams.get('load');
    const initialProgram = load ? await loadCachedProgram(load) : null;
    const owletEditor = new OwletEditor(initialProgram);
    await owletEditor.initialise();

    owletEditor.LineNumbers = false;

    // 'Share' pop-up
    const modal = document.getElementById("share");
    const span = document.getElementsByClassName("close")[0];
    span.onclick = function () {
        modal.style.display = "none";
    }
    window.onclick = function (event) {
        if (event.target === modal) {
            modal.style.display = "none";
        }
    }
}

initialise().then(() => {
    // And we're ready to go here.
});
