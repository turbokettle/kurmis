@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=C:\Users\example\AppData\Local\pnpm\global\5\node_modules\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=C:\Users\example\AppData\Local\pnpm\global\5\node_modules\.pnpm\node_modules;%NODE_PATH%"
)
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\global\5\node_modules\@anthropic-ai\claude-code\cli.js" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\global\5\node_modules\@anthropic-ai\claude-code\cli.js" %*
)
