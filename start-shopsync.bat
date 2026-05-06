@echo off
title ShopSync - Starting...
color 0A

echo.
echo ========================================
echo    SHOPSYNC - Vehicle Tracking System
echo ========================================
echo.
echo Starting backend server...
echo.

cd backend
call venv\Scripts\activate.bat
start "ShopSync Backend" cmd /k "python main.py"

timeout /t 3 /nobreak > nul

echo.
echo Starting frontend...
echo.

cd ..\frontend
start "ShopSync Frontend" cmd /k "npm run dev"

timeout /t 5 /nobreak > nul

echo.
echo ========================================
echo    ShopSync is now running!
echo ========================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Opening browser in 3 seconds...
echo.

timeout /t 3 /nobreak > nul

start http://localhost:5173/advisor

echo.
echo Press any key to close this window...
echo (Backend and Frontend will keep running)
pause > nul