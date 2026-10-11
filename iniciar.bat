@echo off
cd /d "%~dp0"
echo Iniciando Banco 4.0 en http://localhost:3000
start "" http://localhost:3000
node server.js
