@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
call "venv\Scripts\activate.bat"
uvicorn main:app --port 8000 --reload
pause
