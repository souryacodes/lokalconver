// A plain (non-module) script, so it can run even when modules are blocked.
//
// It handles two cases where the page would otherwise sit on
// "Getting the converter ready..." forever:
//   1. The page was opened by double-clicking index.html (file://). Browsers
//      block ES modules there, so the site cannot start. We say how to fix it.
//   2. The page did not start within 10 seconds for any other reason.
// js/app.js sets data-ready on <html> when the Convert page has started.
(function () {
  function show(lines) {
    var root = document.getElementById('convert-root');
    if (!root || document.documentElement.hasAttribute('data-ready')) return;
    root.textContent = '';
    var box = document.createElement('div');
    box.className = 'convert-problem';
    box.setAttribute('role', 'alert');
    lines.forEach(function (line) {
      var p = document.createElement(line.tag || 'p');
      p.textContent = line.text;
      if (line.tag === 'code') p.className = 'convert-problem__cmd';
      box.appendChild(p);
    });
    root.appendChild(box);
  }

  function run() {
    if (location.protocol === 'file:') {
      show([
        { tag: 'h2', text: 'Open LokalConver from a local address' },
        { text: 'Your browser does not run this site when the file is opened by double-click. Nothing is wrong with your files.' },
        { text: 'Windows: double-click start.bat in the project folder. Mac or Linux: run ./start.sh. Or run this in a terminal inside the folder:' },
        { tag: 'code', text: 'python tools/serve.py' },
        { text: 'Your browser will open http://localhost:8000. Nothing is uploaded: the server only runs on this computer.' },
      ]);
      return;
    }
    setTimeout(function () {
      show([
        { tag: 'h2', text: 'The converter could not start' },
        { text: 'Please reload the page. If this keeps happening, open the browser console (F12) and look for a red message.' },
      ]);
    }, 10000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
