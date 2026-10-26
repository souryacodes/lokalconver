@echo off
rem Double-click this file to run LokalConver on your computer.
rem It starts a small local server and opens the site in your browser.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 tools\serve.py & goto :eof)
where python >nul 2>nul && (python tools\serve.py & goto :eof)
echo Python 3 was not found. Install it from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH"), then double-click this file again.
pause
