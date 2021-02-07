import $ from "jquery";
import {registerBbcBasicLanguage} from "./bbcbasic";
import rootHtml from "./root.html";
import {OwletEditor} from "./owlet";

const LastProgramKey = "program";

function programUrl(id) {
    if (window.location.hostname !== "localhost") return `https://bbcmic.ro/assets/programs/${id}`;
    return `../assets/programs/${id}`;
}

function updateUiForProgram(id, json) {
    $("#like")
        .html(`<span class="heart">♥</span>code originally posted by @${json.author} on Twitter`)
        .attr("href", `https://twitter.com/intent/like?tweet_id=${id}`);
}

window.u = updateUiForProgram;

async function loadCachedProgram(id) {
    const response = await fetch(programUrl(id));
    if (response.status === 200) {
        const json = await response.json();
        updateUiForProgram(id, json);
        return json;
    }
    return null;
}

function consumeHash() {
    // "consume" the hash so as not to confuse users. If they need the hash
    // they should click share.
    window.location.hash = "";
}

async function getInitialState(id) {
    if (id) {
        // If we were given a direct id, load that. And put up an error if there was a problem.
        const result = await loadCachedProgram(id);
        if (!result)
            return OwletEditor.stateForBasicProgram(`REM BBC BASIC program ${id} not found\n`);
        return OwletEditor.stateForBasicProgram(result.program);
    }

    // Try decoding state from the location hash.
    const maybeState = OwletEditor.decodeStateString(window.location.hash.substr(1));
    if (maybeState) {
        consumeHash();
        return maybeState;
    }

    // If there's no state in the URL, look at the last program the user had in their browser.
    const lastProgram = localStorage.getItem(LastProgramKey);
    if (lastProgram) return OwletEditor.stateForBasicProgram(lastProgram);

    // Try loading an example program.
    const ExampleProgramId = "1228377194210189312"; // This is the only way I tweet now
    const example = await loadCachedProgram(ExampleProgramId);
    if (example) return OwletEditor.stateForBasicProgram(example.program);

    // Failing loading an example program (e.g. running a local server, or some other
    // error), then use a boring built-in program.
    const FallbackDefaultProgram = ['PRINT "HELLO WORLD"', "GOTO 10"].join("\n");

    return OwletEditor.stateForBasicProgram(FallbackDefaultProgram);
}

async function initialise() {
    function setTheme(themeName) {
        localStorage.setItem("theme", themeName);
        document.documentElement.className = themeName;
    }

    setTheme("theme-classic");

    $("body").append(rootHtml);
    registerBbcBasicLanguage();

    // Check if we reference a cached tweet on first load and convert it to URL hash
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const owletEditor = new OwletEditor(changedText =>
        localStorage.setItem(LastProgramKey, changedText)
    );
    await owletEditor.initialise(await getInitialState(urlParams.get("load")));
    window.onhashchange = () => {
        const state = OwletEditor.decodeStateString(window.location.hash.substr(1));
        if (state) {
            owletEditor.setState(state);
            consumeHash();
        }
    };

    if (urlParams.get("experimental")) {
        console.log("experimental features enabled");
        const rocket = document.getElementById("rocket");
        rocket.style.display = "block";
    }
}

initialise().then(() => {
    // And we're ready to go here.
});
