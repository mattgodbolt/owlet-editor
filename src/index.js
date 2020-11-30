import $ from 'jquery';
import {registerBbcBasicLanguage} from './bbcbasic';
import rootHtml from './root.html';
import {OwletEditor} from "./owlet";

function programUrl(id) {
    if (window.location.hostname !== 'localhost')
        return `https://bbcmic.ro/assets/programs/${id}`;
    return `../assets/programs/${id}`;
}

function updateUiForProgram(id, json) {
    $('#like').html(`<span class="heart">♥</span>code originally posted by @${json.author} on Twitter`)
    .attr('href', `https://twitter.com/intent/like?tweet_id=${id}`);
}

window.u = updateUiForProgram;

async function loadCachedProgram(id) {
    const response = await fetch(programUrl(id));
    if (response.status === 200) {
        const json = await response.json();
        updateUiForProgram(id, json);
        return json;
    }
    return {program: `REM BBC BASIC program ${id} not found\n`};
}

function consumeHash() {
    // "consume" the hash so as not to confuse users. If they need the hash
    // they should click share.
    window.location.hash = '';
}

async function getInitialState(id) {
    if (!id) {
        const maybeState = OwletEditor.decodeStateString(window.location.hash.substr(1));
        if (maybeState) {
            consumeHash();
            return maybeState;
        }
        // No state, let the editor pick its own default state.
        return null;
    }
    const result = await loadCachedProgram(id);
    return OwletEditor.stateForBasicProgram(result.program);
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
    const owletEditor = new OwletEditor();
    await owletEditor.initialise(await getInitialState(urlParams.get('load')));
    window.onhashchange = () => {
        const state = OwletEditor.decodeStateString(window.location.hash.substr(1));
        if (state) {
            owletEditor.setState(state);
            consumeHash();
        }
    };
}

initialise().then(() => {
    // And we're ready to go here.
});
