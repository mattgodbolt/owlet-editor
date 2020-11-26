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
    console.log(decodeURI(await response.text()));
    const json = JSON.parse(decodeURI(await response.text()));
    const author = document.getElementById('author');
    author.innerHTML = `Code tweeted by ${json.author} on ${new Date(json.date).toUTCString().substring(0,16)}`;

    return response.status === 200 ? json: `REM BBC BASIC program ${id} not found\n`;
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
    const initialProgram = load ? cached.program  : null;
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
