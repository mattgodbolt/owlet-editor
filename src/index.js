import $ from "jquery";
import {registerBbcBasicLanguage} from "./bbcbasic";
import rootHtml from "./root.html?raw";
import {OwletEditor} from "./owlet";
import {backwardCompat} from "./tokens";
import "@fortawesome/fontawesome-free/js/all.js";
import "@fortawesome/fontawesome-free/css/all.css";
import logo from "/assets/images/monster.png";
import "./owlet-editor.less";

const LastProgramKey = "program";

function programUrl(id) {
    //if (window.location.hostname !== "localhost")
    return `https://bbcmic.ro/state/${id}`;
    //return `../assets/${id}`;
}

function updateUiForProgram(id, json, v) {
    // Twitter
    if (v === 1) {
        $("#like").html(
            `<span class="heart">♥</span>code originally posted by ${json.author} on Twitter`,
        );
    }

    // Mastodon
    if (v === 3) {
        let author = /@\w+/g.exec(json.src);
        $("#like").html(
            `<a href='${json.src}'><span class="heart">♥</span> code posted by ${author} on Mastodon<a>`,
        );
    }
}

window.u = updateUiForProgram;

async function loadCachedProgram(id) {
    const response = await fetch(programUrl(id));
    if (response.status === 200) {
        const json = await response.json();
        json.program = json.toot;
        if (json.mode > 1) {
            console.log("experimental features enabled");
            const rocket = document.getElementById("rocket");
            rocket.style.display = "block";
        }
        updateUiForProgram(id, json, 3);
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
        return result;
    }

    // Try decoding state from the location hash.
    let maybeState = OwletEditor.decodeStateString(window.location.hash.substring(1));

    if (maybeState !== null) {
        if (maybeState.v === 1) {
            consumeHash();
            if (maybeState.date < 1590994800) {
                maybeState.program = backwardCompat(maybeState.program);
            }
            if (maybeState.id) updateUiForProgram(maybeState.id, maybeState, 1);
            return maybeState;
        }

        if (maybeState.v === 3) {
            consumeHash();
            if (maybeState.src) updateUiForProgram(maybeState.src, maybeState, 3);

            return maybeState;
        }
    }

    // If there's no state in the URL, look at the last program the user had in their browser.
    const lastProgram = localStorage.getItem(LastProgramKey);
    if (lastProgram) return OwletEditor.stateForBasicProgram(lastProgram);

    // // Try loading an example program - TODO we will cache in s3
    // const ExampleProgramId = "toot.bas"; // This is the only way I toot now
    // const example = await state(ExampleProgramId);
    // if (example) return OwletEditor.stateForBasicProgram(example.program);

    // Failing loading an example program (e.g. running a local server, or some other
    // error), then use a boring built-in program.
    const FallbackDefaultProgram = [
        "MODE 2",
        "COLOUR RND(7)",
        'PRINT "HELLO WORLD"',
        "GOTO 20",
    ].join("\n");

    return OwletEditor.stateForBasicProgram(FallbackDefaultProgram);
}

async function initialise() {
    function setTheme(themeName) {
        localStorage.setItem("theme", themeName);
        document.documentElement.className = themeName;
    }

    setTheme("theme-classic");

    $("body").append(rootHtml);

    // if the t parameter is set
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const t = urlParams.get("t");
    if (t) {
        const $logo = $("#logo");
        $logo.attr("src", logo);
        $logo.attr("height", "48px");
        $logo.attr("alt", "BBC Microbot gallery");
        const link = document.querySelector("link[rel*='icon']") || document.createElement("link");
        link.type = "image/x-icon";
        link.rel = "shortcut icon";
        link.href = logo;
        document.title = "BBC Microbot - Owlet Editor";
        $logo.click(() => {
            window.location.href = "https://www.bbcmicrobot.com";
        });
    }

    registerBbcBasicLanguage();

    // Check if we reference a cached tweet on first load and convert it to URL hash

    const owletEditor = new OwletEditor(changedText =>
        localStorage.setItem(LastProgramKey, changedText),
    );

    await owletEditor.initialise(await getInitialState(urlParams.get("t")));
    window.onhashchange = () => {
        const state = OwletEditor.decodeStateString(window.location.hash.substring(1));
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
