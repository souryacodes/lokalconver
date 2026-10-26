# lokalconver
Local File Converter. Convert Anything. Upload Nothing

## Live Demo

[Open LokalConver](https://souryacodes.github.io/lokalconver/)

## Run it on your computer

Do not double-click `index.html`. Browsers block JavaScript modules on `file://`
addresses, so the page would stay on "Getting the converter ready...".

- Windows: double-click `start.bat`
- Mac or Linux: run `./start.sh`
- Any system: `python tools/serve.py` (or `npm start`)

It opens http://localhost:8000. The server only listens on this computer and
nothing is uploaded.
