@echo off
title Local File Hub - Arth Purohit
echo ========================================================
echo   LOCAL FILE HUB - SHARED STORAGE
echo   Created by Arth Purohit (https://arth-hub.vercel.app/)
echo   GitHub: https://github.com/ArthOfficial
echo ========================================================
echo.
if exist "%~dp0KryinLocalFile.exe" (
    echo Starting KryinLocalFile.exe standalone binary...
    start "" "%~dp0KryinLocalFile.exe"
) else (
    echo Starting local file server via Node.js...
    node server.js
    pause
)
