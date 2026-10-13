@echo off
rem Publica los cambios de la pagina AR (ar.animavenastudio.com).
rem Doble clic: guarda todo en git y lo sube a GitHub; GitHub Pages lo publica en ~1 minuto.
cd /d "%~dp0"
git add -A
set "MSG="
set /p MSG=Que cambiaste? (Enter = "Update"): 
if "%MSG%"=="" set "MSG=Update"
git commit -m "%MSG%"
git push
echo.
echo Listo. En 1-2 minutos se ve en https://ar.animavenastudio.com
pause
