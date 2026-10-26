@echo off
cd /d "%~dp0frontend"
echo [NOTE] Close the dev server (start-frontend.bat) first. Both use port 5173.
echo [NOTE] Start the backend (start-backend.bat) too, or login will fail.
echo.
echo [1/2] Building...
call npm run build
if errorlevel 1 (
  echo Build failed. Check the error above.
  pause
  exit /b 1
)
echo.
echo [2/2] Starting the install test server.
echo Open http://localhost:5173 in Chrome or Edge.
echo To stop: press Ctrl+C in this window, or close the window.
call npm run preview -- --port 5173 --strictPort
pause
