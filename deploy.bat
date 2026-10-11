@echo off
REM ============================================================
REM  Desplegar la web de writeups a GitHub Pages.
REM  Doble clic: va a la carpeta del repo, guarda, integra lo
REM  del remoto y sube. Da igual desde donde lo ejecutes.
REM ============================================================
cd /d "C:\Users\alexl\Desktop\WriteUps Page"

if not exist ".git" (
  echo.
  echo  ERROR: no encuentro el repositorio en:
  echo    C:\Users\alexl\Desktop\WriteUps Page
  echo  Si lo moviste, edita la ruta de este .bat.
  echo.
  pause
  exit /b 1
)

echo.
echo === Cambios pendientes ===
git status --short

echo.
echo === Guardando (commit) ===
git add -A
git commit -m "Actualizar sitio de writeups"

echo.
echo === Trayendo cambios del remoto (merge) ===
git pull --no-rebase --no-edit

echo.
echo === Subiendo a GitHub (push) ===
git push

echo.
echo ============================================================
echo  Si arriba NO ves errores en rojo, ya esta subido.
echo  Espera 1-2 min y abre la web en INCOGNITO (o Ctrl+F5).
echo  Si ves CONFLICT, no toques nada y pega la salida al chat.
echo ============================================================
echo.
pause
