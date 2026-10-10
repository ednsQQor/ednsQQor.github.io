@echo off
REM ============================================================
REM  Desplegar la web de writeups a GitHub Pages.
REM  Doble clic en este archivo: sube todos los cambios y
REM  GitHub reconstruye el sitio en 1-2 minutos.
REM ============================================================
cd /d "%~dp0"

echo.
echo === Cambios pendientes ===
git status --short

echo.
echo === Subiendo a GitHub ===
git add -A
git commit -m "Actualizar sitio de writeups"
git push

echo.
echo ============================================================
echo  Listo. Espera 1-2 min y abre la web en INCOGNITO
echo  (o pulsa Ctrl+F5) para esquivar la cache del navegador.
echo ============================================================
echo.
pause
