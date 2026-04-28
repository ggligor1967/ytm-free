@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
set "LIB=%LIB%;C:\Program Files (x86)\Windows Kits\10\Debuggers\lib\x64;C:\Program Files\Microsoft Visual Studio\2022\Community\SDK\ScopeCppSDK\vc15\SDK\lib"
cd /d "%~dp0..\src-tauri"
cargo build
exit /b %ERRORLEVEL%
