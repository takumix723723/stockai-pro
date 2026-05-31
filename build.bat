@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   StockAI Pro - EXE Build
echo   Entry: desktop.py (Flask + pywebview)
echo ========================================
echo.

echo [1/4] Installing dependencies...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
  echo ERROR: pip install failed
  exit /b 1
)

echo [2/4] Generating app.ico...
python tools\make_icon.py
if not exist "static\icons\app.ico" (
  echo WARNING: static\icons\app.ico not found - exe will use default icon
)

echo [3/4] Cleaning previous build...
if exist build rmdir /s /q build 2>nul
if exist dist\StockAIPro.exe del /f /q dist\StockAIPro.exe 2>nul

echo [4/4] PyInstaller (StockAIPro.spec)...
python -m PyInstaller StockAIPro.spec --noconfirm
if errorlevel 1 (
  echo ERROR: PyInstaller build failed
  exit /b 1
)

if exist "dist\StockAIPro.exe" (
  echo.
  echo ========================================
  echo   SUCCESS: dist\StockAIPro.exe
  echo   - Flask + pywebview (no browser)
  echo   - Bundled: templates, static, icons,
  echo     manifest.json, sw.js
  echo ========================================
  echo.
  echo Open the dist folder and run StockAIPro.exe
) else (
  echo ERROR: dist\StockAIPro.exe not found
  exit /b 1
)
