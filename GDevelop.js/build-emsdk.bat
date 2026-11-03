@echo off
call A:\emsdk\emsdk_env.bat >nul 2>&1
set PATH=%PATH%;A:\emsdk\python\3.13.3_64bit
node_modules\.bin\grunt.cmd build > A:\GDevelop-webgpu\build-libgd.log 2>&1
exit /b %ERRORLEVEL%
