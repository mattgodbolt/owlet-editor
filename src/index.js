import $ from 'jquery';
import {registerBbcBasicLanguage} from './bbcbasic';
import rootHtml from './root.html';
import {OwletEditor} from "./owlet";

function programUrl(id) {
    if (window.location.hostname !== 'localhost')
        return `https://bbcmic.ro/assets/programs/${id}`;
    return `../assets/programs/${id}`;
}

async function loadCachedProgram(id) {
    const response = await fetch(programUrl(id));
    if (response.status === 200) {
        const json = await response.json();
        const author = document.getElementById('author');
        const like = document.getElementById('like');
        const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 72"><path d="M38.723,12c-7.187,0-11.16,7.306-11.723,8.131C26.437,19.306,22.504,12,15.277,12C8.791,12,3.533,18.163,3.533,24.647 C3.533,39.964,21.891,55.907,27,56c5.109-0.093,23.467-16.036,23.467-31.353C50.467,18.163,45.209,12,38.723,12z"/></svg>'
        author.innerHTML = `Code tweeted by ${json.author} on ${new Date(json.date).toUTCString().substring(0,16)}`;
        like.href = `https://twitter.com/intent/like?tweet_id=${id}`;
        like.innerHTML = `<span id=\"heart\"></span> like the original post on Twitter`;
        return json;
    }
    return {program: `REM BBC BASIC program ${id} not found\n`};
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
    const cached = load ? await loadCachedProgram(load) : null;
    const initialProgram = load ? cached.program : null;
    const owletEditor = new OwletEditor(initialProgram);
    await owletEditor.initialise();

    owletEditor.LineNumbers = false;

    // 'Share' pop-up
    const modal = document.getElementById("share");
    const span = document.getElementsByClassName("close")[0];
    span.onclick = () => modal.style.display = "none";
    window.onclick = event => {
        if (event.target === modal) {
            modal.style.display = "none";
        }
    };
}

initialise().then(() => {
    // And we're ready to go here.
});
