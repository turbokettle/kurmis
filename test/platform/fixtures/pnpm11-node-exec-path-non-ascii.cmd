@SETLOCAL
@SET "_PNPM_CODEPAGE="
@FOR /F "tokens=2 delims=:" %%a IN ('"%SystemRoot%\System32\chcp.com"') DO @SET "_PNPM_CODEPAGE=%%a"
@"%SystemRoot%\System32\chcp.com" 65001 >NUL
@SET "ERRORLEVEL="
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=C:\Users\exämple\AppData\Local\pnpm\global\v11\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\node_modules\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=C:\Users\exämple\AppData\Local\pnpm\global\v11\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\node_modules\.pnpm\node_modules;%NODE_PATH%"
)
@"C:\Users\exämple\AppData\Local\pnpm\nodejs\24.11.0\node.exe"  "%~dp0\global\v11\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\node_modules\@anthropic-ai\claude-code\cli.js" %*
@SET "_PNPM_EXIT_CODE=%ERRORLEVEL%"
@IF DEFINED _PNPM_CODEPAGE @"%SystemRoot%\System32\chcp.com" %_PNPM_CODEPAGE% >NUL
@EXIT /B %_PNPM_EXIT_CODE%
