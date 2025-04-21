## Owlet Editor🦉 ![Owlet CI and CD](https://github.com/mattgodbolt/owlet-editor/workflows/Owlet%20CI%20and%20CD/badge.svg)
A simple, intuitive creative coding tool for BBC BASIC inspired by [BBC Micro Bot](https://mastodon.me.uk/@bbcmicrobot)


Try the beta now at [bbcmic.ro](https://bbcmic.ro) and get coding!

## A modern editor for a classic language

* Fast, intuitive web-based editor (autocomplete, highlighting)
* Linked to 1000 BBC BASIC code examples from the [bbcmicrobot community](https://www.bbcmicrobot.com/)
* Based on Monaco editor

## BBC Micro emulator for instant feedback

* Integrated with JSbeeb emulator
* Share your entire program as a URL
* Export to external emulator for interactive use

## Share your creations with the BBC Micro Bot Mastodon community

* One button tweet to share code (not yet updated for Mastodon)
* Automatic code golfing tools - byte token encode/decode



## To develop

```
$ make run   # Starts the Vite development server
$ npm run build   # Build for production
$ npm run preview   # Preview the production build locally
```

Then visit http://localhost:8080

## Build System

Owlet Editor uses Vite as its build system. The project was migrated from webpack to Vite to align with the jsbeeb dependency, which also uses Vite.

## Known Issues

- When running tests, you may see warnings about missing source maps for Monaco Editor. This is a [known issue with Monaco Editor 0.52.0+](https://github.com/microsoft/monaco-editor/issues/4712) and doesn't affect functionality.
